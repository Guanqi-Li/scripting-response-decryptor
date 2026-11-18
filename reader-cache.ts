import { fetchReaderChapter, type Chapter, type ReaderChapter } from "./catalog"

type ReaderImage = { image: UIImage; estimatedBytes: number }
export type ImageTiming = {
  queuedAt: number
  startedAt?: number
  receivedAt?: number
  processingAt?: number
  finishedAt?: number
  outcome?: "ready" | "failed" | "cancelled"
}
const MAX_DOWNLOADS = 5

type ImageDownload = { controller: AbortController; finished?: Promise<void> }
type ImageSource = { path: string } | { data: Data }

export class ReaderCache {
  readonly chapters = new Map<number, ReaderChapter>()
  readonly images = new Map<string, ReaderImage>()
  readonly ratios = new Map<string, number>()
  private estimatedBytes = 0

  store(url: string, image: UIImage) {
    const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 1.5
    const bytes = image.width * image.height * (image.scale || 1) ** 2 * 4
    this.estimatedBytes += bytes - (this.images.get(url)?.estimatedBytes ?? 0)
    this.images.delete(url)
    this.images.set(url, { image, estimatedBytes: bytes })
    this.ratios.set(url, ratio)
  }

  touch(url: string) {
    const image = this.images.get(url)
    if (image) {
      this.images.delete(url)
      this.images.set(url, image)
    }
  }

  trim(protectedURLs: ReadonlySet<string>): string[] {
    const evicted: string[] = []
    for (const [url, entry] of this.images) {
      if (this.images.size <= 18 && this.estimatedBytes <= 96 * 1024 * 1024) break
      if (!protectedURLs.has(url)) {
        this.images.delete(url)
        this.estimatedBytes -= entry.estimatedBytes
        evicted.push(url)
      }
    }
    return evicted
  }
}

export class ReaderRequests {
  readonly failed = new Set<string>()
  private readonly pendingChapters = new Map<number, Promise<ReaderChapter>>()
  private readonly sources = new Map<string, ImageSource>()
  private order: string[] = []
  private orderSet = new Set<string>()
  private focus = ""
  private readonly urgent = new Set<string>()
  private readonly downloadJobs = new Map<string, ImageDownload>()
  private decodeJob: Promise<void> | undefined
  private directory: Promise<string | null> | undefined
  private nextFile = 0
  private readonly timings = new Map<string, ImageTiming>()
  private readonly lifetime = new AbortController()
  private wanted: string[] = []
  private readonly observers = new Map<string, Set<() => void>>()
  changed: (url: string) => void = () => {}

  constructor(private readonly cache: ReaderCache, private readonly bookID: number) {}

  chapter(chapter: Chapter): Promise<ReaderChapter> {
    const cached = this.cache.chapters.get(chapter.id)
    if (cached) return Promise.resolve(cached)
    const pending = this.pendingChapters.get(chapter.id)
    if (pending) return pending
    const { signal } = this.lifetime
    const request = fetchReaderChapter(this.bookID, chapter, signal).then(result => {
      if (signal.aborted) throw new Error("阅读已关闭。")
      this.cache.chapters.set(chapter.id, result)
      return result
    }).finally(() => {
      this.pendingChapters.delete(chapter.id)
    })
    this.pendingChapters.set(chapter.id, request)
    return request
  }

  imageTiming(url: string): Readonly<ImageTiming> | undefined {
    return this.timings.get(url)
  }

  private markQueued(url: string): ImageTiming {
    const existing = this.timings.get(url)
    if (existing && existing.startedAt === undefined) return existing

    const timing: ImageTiming = { queuedAt: Date.now() }
    this.timings.set(url, timing)
    return timing
  }

  observe(url: string, update: () => void): () => void {
    const listeners = this.observers.get(url) ?? new Set<() => void>()
    this.observers.set(url, listeners)
    listeners.add(update)
    return () => {
      listeners.delete(update)
      if (listeners.size === 0) this.observers.delete(url)
    }
  }

  private notify(url: string) {
    this.observers.get(url)?.forEach(update => update())
  }

  queueImages(urls: string[], focus?: string) {
    if (this.lifetime.signal.aborted) return
    const next = [...new Set(urls.filter(Boolean))]
    if (focus) this.focus = focus
    if (next.length === this.order.length && next.every((url, index) => url === this.order[index])) {
      this.pumpDownloads()
      return
    }
    this.order = next
    this.orderSet = new Set(next)
    for (const [url, job] of this.downloadJobs) {
      if (!this.orderSet.has(url)) job.controller.abort()
    }
    for (const [url, source] of this.sources) {
      if (this.orderSet.has(url)) continue
      this.sources.delete(url)
      this.removeSource(source)
    }
    for (const url of this.timings.keys()) {
      if (this.orderSet.has(url)) continue
      this.timings.delete(url)
      this.failed.delete(url)
      this.urgent.delete(url)
    }
    for (const url of next) {
      if (!this.sources.has(url) && !this.cache.images.has(url) && !this.failed.has(url) && !this.timings.has(url)) {
        this.markQueued(url)
      }
    }
    this.pumpDownloads()
  }

  prioritize(urls: string[], visible: string[] = []) {
    this.wanted = [...new Set([...visible, ...urls])]
    for (const url of this.wanted) this.cache.touch(url)
    if (visible[0]) this.focus = visible[0]
    this.pumpDownloads()
    this.pumpDecoding()
  }

  retry(url: string) {
    if (!this.orderSet.has(url)) return
    this.failed.delete(url)
    this.urgent.add(url)
    if (!this.downloadJobs.has(url)) this.markQueued(url)
    if (this.downloadJobs.size >= MAX_DOWNLOADS && !this.downloadJobs.has(url)) {
      const focus = this.order.indexOf(this.focus)
      const candidates = [...this.downloadJobs.entries()].filter(([item]) => !this.urgent.has(item))
      candidates.sort(([left], [right]) =>
        Math.abs(this.order.indexOf(right) - focus) - Math.abs(this.order.indexOf(left) - focus))
      candidates[0]?.[1].controller.abort()
    }
    this.prioritize([url, ...this.wanted])
    this.notify(url)
  }

  close() {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort()
    for (const job of this.downloadJobs.values()) job.controller.abort()
    this.wanted = []
    this.order = []
    this.orderSet.clear()
    this.urgent.clear()
    this.observers.clear()
    this.timings.clear()
    this.sources.clear()
    void this.removeDirectory()
  }

  private async removeDirectory() {
    const directory = this.directory
    if (!directory) return
    await Promise.allSettled([...this.downloadJobs.values()].map(job => job.finished).concat(this.decodeJob))
    const path = await directory
    if (path) {
      try { await FileManager.remove(path) }
      catch {} // The system can clear the temporary directory independently.
    }
  }

  private removeSource(source: ImageSource) {
    if ("path" in source) void FileManager.remove(source.path).catch(() => {})
  }

  private async saveSource(data: Data): Promise<ImageSource> {
    if (typeof FileManager === "undefined" || !FileManager.temporaryDirectory) return { data }
    this.directory ??= (async () => {
      const path = FileManager.temporaryDirectory + "/aimanhua-reader-" + Date.now() + "-" + Math.random().toString(36).slice(2)
      try {
        await FileManager.createDirectory(path, true)
        return path
      } catch {
        return null
      }
    })()
    const folder = await this.directory
    if (!folder) return { data }
    const path = folder + "/" + ++this.nextFile
    try {
      await FileManager.writeAsData(path, data)
      return { path }
    } catch {
      return { data }
    }
  }

  private downloadOrder(): string[] {
    const index = this.order.indexOf(this.focus)
    if (index < 0) return [...this.urgent, ...this.order]
    const nearby = [
      ...this.order.slice(index, index + 3),
      ...this.order.slice(Math.max(0, index - 2), index),
    ]
    // Keep the rest of the active chapter ahead of chapters that were only prefetched.
    const pending = [...this.order.slice(index + 3), ...this.order.slice(0, Math.max(0, index - 2))]
    return [...new Set([...this.urgent, ...nearby, ...pending])]
  }

  private pumpDownloads() {
    if (this.lifetime.signal.aborted) return
    for (const url of this.downloadOrder()) {
      if (this.downloadJobs.size >= MAX_DOWNLOADS) break
      if (!this.orderSet.has(url) || this.downloadJobs.has(url) || this.sources.has(url)
        || this.cache.images.has(url) || this.failed.has(url)) continue
      const timing = this.markQueued(url)
      timing.startedAt = Date.now()
      const job: ImageDownload = { controller: new AbortController() }
      this.downloadJobs.set(url, job)
      job.finished = this.download(url, timing, job.controller.signal)
    }
  }

  private async fetchImage(url: string, signal: AbortSignal): Promise<Data> {
    for (let attempt = 0; ; attempt++) {
      let retryable = true
      try {
        const response = await fetch(url, {
          headers: { "Cache-Control": "no-cache, no-store" },
          timeout: 25,
          signal,
        })
        if (!response.ok) {
          retryable = response.status === 408 || response.status >= 500
          throw new Error("图片加载失败。")
        }
        if (signal.aborted) throw new Error("图片下载已取消。")
        return await response.data()
      } catch (error) {
        if (signal.aborted || !retryable || attempt > 0) throw error
        await new Promise<void>(resolve => setTimeout(resolve, 350))
        if (signal.aborted) throw error
      }
    }
  }

  private async download(url: string, timing: ImageTiming, signal: AbortSignal) {
    try {
      const data = await this.fetchImage(url, signal)
      if (signal.aborted) return
      timing.receivedAt = Date.now()
      const source = await this.saveSource(data)
      if (signal.aborted || this.lifetime.signal.aborted) {
        this.removeSource(source)
        return
      }
      this.sources.set(url, source)
      this.pumpDecoding()
    } catch {
      if (!signal.aborted) {
        timing.finishedAt = Date.now()
        timing.outcome = "failed"
        this.failed.add(url)
        this.notify(url)
        this.changed(url)
      }
    } finally {
      if (signal.aborted) {
        timing.finishedAt = Date.now()
        timing.outcome = "cancelled"
      }
      if (!signal.aborted) this.urgent.delete(url)
      this.downloadJobs.delete(url)
      this.pumpDownloads()
    }
  }

  private pumpDecoding() {
    if (this.lifetime.signal.aborted || this.decodeJob) return
    const url = this.wanted.find(item =>
      this.sources.has(item) && !this.cache.images.has(item) && !this.failed.has(item))
    if (!url) return
    const source = this.sources.get(url)!
    const timing = this.timings.get(url)
    // Schedule decoding separately so it doesn’t hold the network queue.
    this.decodeJob = Promise.resolve().then(() => this.decode(url, source, timing)).finally(() => {
      this.decodeJob = undefined
      this.pumpDecoding()
    })
  }

  private async decode(url: string, source: ImageSource, timing?: ImageTiming) {
    if (this.lifetime.signal.aborted || !this.wanted.includes(url) || this.sources.get(url) !== source) return
    if (timing) {
      timing.processingAt = Date.now()
      timing.finishedAt = undefined
      timing.outcome = undefined
    }
    try {
      const data = "path" in source ? await FileManager.readAsData(source.path) : source.data
      if (this.lifetime.signal.aborted || this.sources.get(url) !== source) return
      if (!data) throw new Error("图片缓存已丢失。")
      const image = UIImage.fromData(data)
      if (!image) throw new Error("图片解码失败。")
      const inset = 2 / image.scale
      const cropped = image.width > inset * 2
        ? image.croppedTo?.({ x: inset, y: 0, width: image.width - inset * 2, height: image.height })
        : null
      this.cache.store(url, cropped ?? image)
      if (timing) timing.outcome = "ready"
      for (const evicted of this.cache.trim(new Set(this.wanted))) this.notify(evicted)
    } catch {
      if (this.lifetime.signal.aborted || this.sources.get(url) !== source) return
      this.sources.delete(url)
      this.removeSource(source)
      this.failed.add(url)
      if (timing) timing.outcome = "failed"
    }
    if (timing) timing.finishedAt = Date.now()
    this.notify(url)
    this.changed(url)
  }
}
