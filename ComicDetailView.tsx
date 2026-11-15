import {
  Button, HStack, ProgressView, ScrollView, Text, VStack,
  useEffect, useRef, useState,
} from "scripting"
import { ComicCover, type CoverCache } from "./ComicGrid"
import { fetchBookDetails, type Comic } from "./catalog"

export function ComicDetailView({ book, covers, cache }: {
  book: Comic
  covers: CoverCache
  cache: Map<number, Comic>
}) {
  const [detail, setDetail] = useState<Comic | null>(cache.get(book.bookID) ?? null)
  const [error, setError] = useState("")
  const active = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!detail) void loadDetails()
    return () => {
      active.current?.abort()
      active.current = null
    }
  }, [book.bookID])

  async function loadDetails() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setError("")
    try {
      const result = await fetchBookDetails(book, controller.signal)
      if (controller.signal.aborted) return
      cache.set(book.bookID, result)
      setDetail(result)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  const display = detail ?? book
  return (
    <ScrollView navigationTitle="漫画详情" navigationBarTitleDisplayMode="inline">
      <VStack alignment="leading" spacing={18} padding={16}>
        <HStack alignment="top" spacing={14}>
          <ComicCover url={display.coverURL} covers={covers} width={112} />
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="title2" fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }}>{display.title}</Text>
            {display.author ? <Text font="subheadline">{display.author}</Text> : null}
            <VStack alignment="leading" spacing={6}>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {display.updatedAt ? `最近更新时间 ${display.updatedAt}` : "最近更新时间 —"}
              </Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {display.latestChapter !== null ? `最新章节 第 ${display.latestChapter} 话` : "最新章节 —"}
              </Text>
            </VStack>

          </VStack>
        </HStack>
        {error ? (
          <VStack alignment="leading" spacing={8}>
            <Text>详情加载失败。{error}</Text>
            <Button title="重试" action={loadDetails} />
          </VStack>
        ) : detail ? null : <ProgressView />}
      </VStack>
    </ScrollView>
  )
}
