import { Button, LazyVStack, ProgressView, Text, VStack, useEffect, useRef, useState } from "scripting"
import { fetchChapterPage, type Chapter } from "./catalog"

type ChapterDirectory = { totalPage: number; pages: Map<number, Chapter[]> }
export type ChapterDirectoryCache = Map<number, ChapterDirectory>

const MAX_CONCURRENT_PAGES = 3

function orderedChapters(directory: ChapterDirectory | undefined): Chapter[] {
  if (!directory) return []
  const chapters = new Map<number, Chapter>()
  const pages = [...directory.pages.entries()].sort(([left], [right]) => left - right)
  for (const [, rows] of pages) {
    for (const row of rows) {
      if (!chapters.has(row.id)) chapters.set(row.id, row)
    }
  }
  return [...chapters.values()]
}

export function ChapterDirectoryView({ bookID, cache }: { bookID: number; cache: ChapterDirectoryCache }) {
  const [chapters, setChapters] = useState(orderedChapters(cache.get(bookID)))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const active = useRef<AbortController | null>(null)

  useEffect(() => {
    void loadDirectory()
    return () => {
      active.current?.abort()
      active.current = null
    }
  }, [bookID])

  async function loadDirectory() {
    const cached = cache.get(bookID)
    if (active.current || (cached && cached.pages.size >= Math.max(1, cached.totalPage))) return

    const controller = new AbortController()
    active.current = controller
    const { signal } = controller
    setLoading(true)
    setError("")
    try {
      let directory = cached
      if (!directory) {
        const first = await fetchChapterPage(bookID, 1, signal)
        if (signal.aborted) return
        directory = { totalPage: first.totalPage, pages: new Map([[1, first.chapters]]) }
        cache.set(bookID, directory)
        setChapters(orderedChapters(directory))
      }

      const { totalPage, pages } = directory
      const pending: number[] = []
      for (let page = 2; page <= totalPage; page++) {
        if (!pages.has(page)) pending.push(page)
      }
      let next = 0
      const failed: number[] = []
      const worker = async () => {
        while (!signal.aborted && next < pending.length) {
          const page = pending[next++]
          try {
            const result = await fetchChapterPage(bookID, page, signal)
            if (signal.aborted) return
            pages.set(page, result.chapters)
            setChapters(orderedChapters(directory))
          } catch {
            if (!signal.aborted) failed.push(page)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PAGES, pending.length) }, worker))
      if (!signal.aborted && failed.length) {
        const pageNumbers = failed.sort((a, b) => a - b).join("、")
        setError(`第 ${pageNumbers} 页加载失败。`)
      }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (active.current === controller) {
        active.current = null
        if (!signal.aborted) setLoading(false)
      }
    }
  }

  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="headline">章节目录</Text>
      {chapters.length > 0 ? (
        <LazyVStack alignment="leading" spacing={0}>
          {chapters.map(chapter => (
            <Text
              key={chapter.id}
              padding={{ vertical: 10 }}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >{chapter.title}</Text>
          ))}
        </LazyVStack>
      ) : null}
      {loading ? <ProgressView /> : null}
      {error ? (
        <VStack alignment="leading" spacing={6}>
          <Text>{error}</Text>
          <Button title="重试目录" action={loadDirectory} />
        </VStack>
      ) : !loading && chapters.length === 0 && cache.has(bookID) ? <Text>暂无章节</Text> : null}
    </VStack>
  )
}
