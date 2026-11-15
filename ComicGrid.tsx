import {
  Button, Image, LazyVGrid, ProgressView, RoundedRectangle, ScrollView, Text, VStack,
  useRef, type GridItem, type ScrollGeometry,
} from "scripting"
import type { Catalog, Comic } from "./catalog"

export type CatalogEntry = { data?: Catalog; loading?: boolean; error?: string }

const columns: GridItem[] = Array.from({ length: 3 }, () => ({
  size: { type: "flexible", min: 0 }, spacing: 10, alignment: "topLeading",
}))

function ComicCard({ book }: { book: Comic }) {
  return (
    <VStack alignment="leading" spacing={4}>
      <RoundedRectangle
        cornerRadius={7}
        fill="secondarySystemBackground"
        aspectRatio={{ value: 2 / 3, contentMode: "fit" }}
        overlay={book.coverURL ? <Image imageUrl={book.coverURL} resizable scaleToFill /> : undefined}
        clipShape={{ type: "rect", cornerRadius: 7 }}
      />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{book.title}</Text>
      {book.author ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{book.author}</Text> : null}
    </VStack>
  )
}

function distanceFromBottom(geometry: ScrollGeometry): number {
  const bottom = Math.max(-geometry.contentInsets.top,
    geometry.contentSize.height - geometry.containerSize.height + geometry.contentInsets.bottom)
  return bottom - geometry.contentOffset.y
}

export function ComicGrid({ entry, loadPage }: { entry?: CatalogEntry; loadPage: () => void }) {
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
      <VStack spacing={14} padding={{ horizontal: 16, top: 12, bottom: 16 }}>
        {data?.books.length ? (
          <LazyVGrid columns={columns} spacing={14}>
            {data.books.map(book => <ComicCard key={book.bookID} book={book} />)}
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
