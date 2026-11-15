import {
  Button, Image, LazyVGrid, ProgressView, RoundedRectangle, ScrollView, Text, VStack,
  useEffect, useRef, useState, type GridItem, type ScrollGeometry,
} from "scripting"
import type { Catalog, Comic } from "./catalog"

export type CatalogEntry = { data?: Catalog; loading?: boolean; error?: string }

export class CoverCache {
  private readonly images = new Map<string, Promise<UIImage | null>>()
  private controller: AbortController | null = null

  load(url: string): Promise<UIImage | null> {
    const cached = this.images.get(url)
    if (cached) return cached

    const controller = this.controller ?? (this.controller = new AbortController())
    const pending = this.fetchCover(url, controller.signal).then(image => {
      if (!image && this.images.get(url) === pending) this.images.delete(url)
      return image
    })
    this.images.set(url, pending)
    return pending
  }

  clear() {
    this.controller?.abort()
    this.controller = null
    this.images.clear()
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
  const [loaded, setLoaded] = useState<{ url: string; image: UIImage } | null>(null)

  useEffect(() => {
    if (!url) return
    let active = true
    void covers.load(url).then(image => {
      if (active && image) setLoaded({ url, image })
    })
    return () => { active = false }
  }, [url, covers])

  return (
    <RoundedRectangle
      cornerRadius={7}
      fill="secondarySystemBackground"
      aspectRatio={{ value: 2 / 3, contentMode: "fit" }}
      frame={width === undefined ? undefined : { width, height: width * 1.5 }}
      overlay={loaded?.url === url ? <Image image={loaded.image} resizable scaleToFill /> : undefined}
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

export function ComicGrid({ entry, covers, loadPage, openBook }: {
  entry?: CatalogEntry
  covers: CoverCache
  loadPage: () => void
  openBook: (book: Comic) => void
}) {
  const drag = useRef({ startedAtBottom: false, interacting: false })
  const data = entry?.data
  const hasMore = data !== undefined && data.page < data.totalPage

  return (
    <ScrollView
      scrollBounceBehavior="always"
      onScrollPhaseChange={(previous, next, { geometry }) => {
        if (next === "tracking" || (next === "interacting" && previous !== "tracking")) {
          drag.current.startedAtBottom = distanceFromBottom(geometry) <= 3
        }
        drag.current.interacting = next === "interacting"
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
          <LazyVGrid columns={columns} spacing={14}>
            {data.books.map(book => <ComicCard key={book.bookID} book={book} covers={covers} openBook={openBook} />)}
          </LazyVGrid>
        ) : data ? <Text>暂无漫画</Text> : null}
        {entry?.loading ? <ProgressView /> : null}
        {entry?.error ? (
          <VStack spacing={6}>
            <Text>漫画加载失败。{entry.error}</Text>
            <Button title="重试" action={loadPage} />
          </VStack>
        ) : hasMore && !entry?.loading ? (
          <Button title="加载更多" action={loadPage} />
        ) : null}
      </VStack>
    </ScrollView>
  )
}
