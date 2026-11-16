import {
  Button, Image, LazyVGrid, ProgressView, RoundedRectangle, ScrollView, Text, VStack,
  useEffect, useObservable, useRef, useState, type GridItem, type ScrollGeometry,
} from "scripting"
import type { Catalog, Comic } from "./catalog"

export type CatalogEntry = { data?: Catalog; loading?: boolean; error?: string }

type CoverJob = {
  url: string
  subscribers: number
  promise: Promise<UIImage | null>
  finish: (image: UIImage | null) => void
  started: boolean
}

export class CoverCache {
  private readonly images = new Map<string, UIImage>()
  private readonly jobs = new Map<string, CoverJob>()
  private readonly waiting: CoverJob[] = []
  private running = 0
  private controller = new AbortController()

  watch(url: string) {
    const image = this.images.get(url)
    if (image) {
      this.images.delete(url)
      this.images.set(url, image)
      return { promise: Promise.resolve(image), release: () => {} }
    }

    let job = this.jobs.get(url)
    if (!job) {
      let finish: CoverJob["finish"] = () => {}
      const promise = new Promise<UIImage | null>(resolve => { finish = resolve })
      job = { url, subscribers: 0, promise, finish, started: false }
      this.jobs.set(url, job)
      this.waiting.push(job)
    }
    const watched = job
    watched.subscribers++
    this.pump()
    return {
      promise: watched.promise,
      release: () => {
        watched.subscribers--
        if (watched.subscribers === 0 && !watched.started && this.jobs.get(url) === watched) {
          this.jobs.delete(url)
          const index = this.waiting.indexOf(watched)
          if (index >= 0) this.waiting.splice(index, 1)
          watched.finish(null)
        }
      },
    }
  }

  clear() {
    this.controller.abort()
    this.controller = new AbortController()
    for (const job of this.waiting) job.finish(null)
    this.waiting.length = 0
    this.jobs.clear()
    this.images.clear()
  }

  private pump() {
    while (this.running < 4 && this.waiting.length) {
      const job = this.waiting.shift()!
      job.started = true
      this.running++
      const { signal } = this.controller
      void this.fetchCover(job.url, signal).then(image => {
        if (this.jobs.get(job.url) === job) this.jobs.delete(job.url)
        if (image && !signal.aborted) {
          this.images.set(job.url, image)
          if (this.images.size > 64) {
            const oldest = this.images.keys().next().value
            if (oldest !== undefined) this.images.delete(oldest)
          }
        }
        job.finish(image)
      }).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async fetchCover(url: string, signal: AbortSignal): Promise<UIImage | null> {
    try {
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache, no-store" },
        timeout: 15,
        signal,
      })
      if (!response.ok || signal.aborted) return null
      const data = await response.data()
      if (signal.aborted) return null
      const image = UIImage.fromData(data)
      if (!image || (image.width <= 360 && image.height <= 540)) return image
      return image.preparingThumbnail({ width: 360, height: 540 }) ?? image
    } catch {
      return null
    }
  }
}

const columns: GridItem[] = Array.from({ length: 3 }, () => ({
  size: { type: "flexible", min: 0 }, spacing: 10, alignment: "topLeading",
}))

export function ComicCover({ url, covers, width }: { url: string; covers: CoverCache; width?: number }) {
  const [loaded, setLoaded] = useState<{ url: string; image: UIImage | null } | null>(null)

  useEffect(() => {
    if (!url) return
    let active = true
    const request = covers.watch(url)
    void request.promise.then(image => {
      if (active) setLoaded({ url, image })
    })
    return () => { active = false; request.release() }
  }, [url, covers])

  const cover = loaded?.url === url ? loaded : null
  return (
    <RoundedRectangle
      cornerRadius={7}
      fill="secondarySystemBackground"
      aspectRatio={{ value: 2 / 3, contentMode: "fit" }}
      frame={width === undefined ? undefined : { width, height: width * 1.5 }}
      overlay={cover?.image ? <Image image={cover.image} resizable scaleToFill />
        : !url || cover ? <Image systemName="book.closed" foregroundStyle="tertiaryLabel" /> : undefined}
      clipShape={{ type: "rect", cornerRadius: 7 }}
      accessibilityHidden
    />
  )
}

function ComicCard({ book, covers, openBook }: { book: Comic; covers: CoverCache; openBook: (book: Comic) => void }) {
  return (
    <Button buttonStyle="plain" action={() => openBook(book)}>
      <VStack alignment="leading" spacing={4} contentShape="rect">
        <ComicCover url={book.coverURL} covers={covers} />
        <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{book.title}</Text>
        {book.author ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{book.author}</Text> : null}
      </VStack>
    </Button>
  )
}

function distanceFromBottom(geometry: ScrollGeometry): number {
  const bottom = Math.max(-geometry.contentInsets.top,
    geometry.contentSize.height - geometry.containerSize.height + geometry.contentInsets.bottom)
  return bottom - geometry.contentOffset.y
}

export function ComicGrid({ entry, covers, loadPage, openBook, initialPosition, savePosition, onInteraction }: {
  entry?: CatalogEntry
  covers: CoverCache
  loadPage: () => void
  openBook: (book: Comic) => void
  initialPosition: string | null
  savePosition: (id: string) => void
  onInteraction: () => void
}) {
  const position = useObservable<string | null>(initialPosition)
  const drag = useRef({ startedAtBottom: false, interacting: false })
  const data = entry?.data
  const hasMore = data !== undefined && data.page < data.totalPage

  useEffect(() => {
    const record = (id: string | null) => { if (id !== null) savePosition(id) }
    position.subscribe(record)
    return () => position.unsubscribe(record)
  }, [savePosition])

  return (
    <ScrollView
      scrollPosition={{ value: position, anchor: "top" }}
      scrollBounceBehavior="always"
      onScrollPhaseChange={(previous, next, { geometry }) => {
        if (next === "tracking" || (next === "interacting" && previous !== "tracking")) {
          drag.current.startedAtBottom = distanceFromBottom(geometry) <= 3
        }
        drag.current.interacting = next === "interacting"
        if (drag.current.interacting) onInteraction()
      }}
      onScrollGeometryChange={{
        of: "geometry",
        onChanged: (_, geometry) => {
          if (hasMore && !entry?.loading && !entry?.error && drag.current.startedAtBottom
            && drag.current.interacting && distanceFromBottom(geometry) <= -12) {
            drag.current.startedAtBottom = false
            loadPage()
          }
        },
      }}
    >
      <VStack spacing={14} padding={{ horizontal: 16, top: 12, bottom: 72 }}>
        {data?.books.length ? (
          <LazyVGrid columns={columns} spacing={14} scrollTargetLayout>
            {data.books.map(book => (
              <VStack key={String(book.bookID)} spacing={0}>
                <ComicCard book={book} covers={covers} openBook={openBook} />
              </VStack>
            ))}
          </LazyVGrid>
        ) : data ? <Text>暂无漫画</Text> : null}
        {entry?.loading ? <ProgressView /> : null}
        {entry?.error ? (
          <VStack spacing={6}>
            <Text>漫画加载失败。{entry.error}</Text>
            <Button title="重试" action={() => { onInteraction(); loadPage() }} />
          </VStack>
        ) : hasMore && !entry?.loading ? (
          <Button title="加载更多" action={() => { onInteraction(); loadPage() }} />
        ) : null}
      </VStack>
    </ScrollView>
  )
}
