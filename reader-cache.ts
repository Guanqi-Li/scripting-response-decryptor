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

  trim(protectedURLs: ReadonlySet<string>) {
    for (const url of this.images.keys()) {
      if (this.images.size <= 18) break
      if (!protectedURLs.has(url)) this.images.delete(url)
    }
  }
}

export class ReaderRequests {
  readonly failed = new Set<string>()
  private readonly pendingChapters = new Map<number, Promise<ReaderChapter>>()
  private readonly downloads = new Map<string, Download>()
  private readonly lifetime = new AbortController()
  private wanted: string[] = []
  changed: () => void = () => {}

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

  prioritize(urls: string[]) {
    this.wanted = [...new Set(urls)]
    const wanted = new Set(this.wanted)
    for (const url of wanted) this.cache.touch(url)
    this.cache.trim(wanted)
    for (const download of this.downloads.values()) {
      if (!wanted.has(download.url)) download.controller.abort()
    }
    this.pump()
  }

  retry(url: string) {
    this.failed.delete(url)
    this.prioritize([url, ...this.wanted])
    this.changed()
  }

  close() {
    this.lifetime.abort()
    for (const download of this.downloads.values()) download.controller.abort()
    this.wanted = []
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
      const inset = 1 / image.scale
      const cropped = image.width > inset * 2
        ? image.croppedTo?.({ x: inset, y: 0, width: image.width - inset * 2, height: image.height })
        : null
      this.cache.store(url, cropped ?? image)
      this.cache.trim(new Set(this.wanted))
    } catch {
      if (!signal.aborted) this.failed.add(url)
    } finally {
      this.downloads.delete(url)
      if (!this.lifetime.signal.aborted && !signal.aborted) this.changed()
      this.pump()
    }
  }
}
