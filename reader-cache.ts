import { fetchReaderChapter, type Chapter, type ReaderChapter } from "./catalog"

export type ReaderImage = { image: UIImage; ratio: number }
type Download = { url: string; controller: AbortController }

export class ReaderCache {
  readonly chapters = new Map<number, ReaderChapter>()
  readonly images = new Map<string, ReaderImage>()
  readonly ratios = new Map<string, number>()

  store(url: string, image: UIImage) {
    const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 1.5
    this.images.delete(url)
    this.images.set(url, { image, ratio })
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
    for (const url of this.images.keys()) {
      if (this.images.size <= 18) break
      if (!protectedURLs.has(url)) {
        this.images.delete(url)
        evicted.push(url)
      }
    }
    return evicted
  }
}

export class ReaderRequests {
  readonly failed = new Set<string>()
  private readonly pendingChapters = new Map<number, Promise<ReaderChapter>>()
  private readonly downloads = new Map<string, Download>()
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

  prioritize(urls: string[]) {
    const next = [...new Set(urls)]
    if (next.length === this.wanted.length && next.every((url, index) => url === this.wanted[index])) return
    this.wanted = next
    for (const url of next) this.cache.touch(url)
    this.pump()
  }

  retry(url: string) {
    this.failed.delete(url)
    this.prioritize([url, ...this.wanted])
    this.pump()
    this.notify(url)
  }

  close() {
    this.lifetime.abort()
    for (const download of this.downloads.values()) download.controller.abort()
    this.wanted = []
    this.observers.clear()
  }

  private pump() {
    if (this.lifetime.signal.aborted) return
    for (const url of this.wanted) {
      if (this.downloads.size >= 3) break
      if (!this.cache.images.has(url) && !this.downloads.has(url) && !this.failed.has(url)) {
        const download = { url, controller: new AbortController() }
        this.downloads.set(url, download)
        void this.download(download)
      }
    }
  }

  private async download({ url, controller }: Download) {
    const { signal } = controller
    try {
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache, no-store" },
        timeout: 25,
        signal,
      })
      if (!response.ok || signal.aborted) throw new Error("图片加载失败。")
      const data = await response.data()
      if (signal.aborted) return
      const image = UIImage.fromData(data)
      if (!image) throw new Error("图片解码失败。")
      const inset = 2 / image.scale
      const cropped = image.width > inset * 2
        ? image.croppedTo?.({ x: inset, y: 0, width: image.width - inset * 2, height: image.height })
        : null
      this.cache.store(url, cropped ?? image)
      for (const evicted of this.cache.trim(new Set(this.wanted))) this.notify(evicted)
    } catch {
      if (!signal.aborted) this.failed.add(url)
    } finally {
      this.downloads.delete(url)
      if (!this.lifetime.signal.aborted && !signal.aborted) {
        this.notify(url)
        this.changed(url)
      }
      this.pump()
    }
  }
}
