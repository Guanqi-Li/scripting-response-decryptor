import { Button, Divider, HStack, LazyVStack, ProgressView, Text, VStack, useEffect, useRef, useState } from "scripting"
import { fetchChapterPage, type Chapter } from "./catalog"

type ChapterDirectory = {
  totalPage: number
  pages: Map<number, Chapter[]>
  chapters: Chapter[]
  index: Map<number, { offset: number; page: number }>
}
export type ChapterDirectoryCache = Map<number, ChapterDirectory>

const MAX_CONCURRENT_PAGES = 3

function updateDirectoryIndex(directory: ChapterDirectory) {
  const chapters: Chapter[] = []
  const index: ChapterDirectory["index"] = new Map()
  const pages = [...directory.pages.entries()].sort(([left], [right]) => left - right)
  for (const [page, rows] of pages) {
    for (const row of rows) {
      if (index.has(row.id)) continue
      index.set(row.id, { offset: chapters.length, page })
      chapters.push(row)
    }
  }
  directory.chapters = chapters
  directory.index = index
}

export function getChapters(bookID: number, cache: ChapterDirectoryCache): Chapter[] {
  return cache.get(bookID)?.chapters ?? []
}

export function getAdjacentChapter(
  bookID: number, cache: ChapterDirectoryCache, current: Chapter, direction: -1 | 1,
): Chapter | undefined {
  const directory = cache.get(bookID)
  const currentIndex = directory?.index.get(current.id)
  if (!directory || !currentIndex) return undefined
  const next = directory.chapters[currentIndex.offset + direction]
  const nextIndex = next && directory.index.get(next.id)
  if (!nextIndex) return undefined
  for (let page = Math.min(currentIndex.page, nextIndex.page) + 1; page < Math.max(currentIndex.page, nextIndex.page); page++) {
    if (!directory.pages.has(page)) return undefined
  }
  return next
}

export function getPendingNextPage(bookID: number, cache: ChapterDirectoryCache, chapter: Chapter): number | undefined {
  const directory = cache.get(bookID)
  if (!directory) return 1
  if (getAdjacentChapter(bookID, cache, chapter, 1)) return undefined
  const page = directory.index.get(chapter.id)?.page
  for (let missing = page === undefined ? 1 : page + 1; missing <= directory.totalPage; missing++) {
    if (!directory.pages.has(missing)) return missing
  }
  return undefined
}

export async function readDirectoryPage(
  bookID: number, cache: ChapterDirectoryCache, page: number, signal: AbortSignal,
) {
  const { totalPage, chapters } = await fetchChapterPage(bookID, page, signal)
  if (signal.aborted) return
  let directory = cache.get(bookID)
  if (!directory) {
    directory = { totalPage, pages: new Map(), chapters: [], index: new Map() }
    cache.set(bookID, directory)
  }
  directory.pages.set(page, chapters)
  updateDirectoryIndex(directory)
}

export function ChapterDirectoryRows({ chapters, openChapter, selectedChapterID, openingChapterID }: {
  chapters: Chapter[]
  openChapter: (chapter: Chapter) => void
  selectedChapterID?: number
  openingChapterID?: number | null
}) {
  return (
    <LazyVStack alignment="leading" spacing={0} scrollTargetLayout>
      {chapters.map((chapter, index) => (
        <VStack key={chapter.id} alignment="leading" spacing={0}>
          <Button buttonStyle="plain" accessibilityAddTraits={chapter.id === selectedChapterID ? "isSelected" : undefined}
            disabled={openingChapterID != null}
            action={() => openChapter(chapter)}>
            <HStack spacing={10} padding={{ vertical: 10 }}
              frame={{ maxWidth: "infinity", minHeight: 52, alignment: "leading" }} contentShape="rect">
              <Text foregroundStyle={chapter.id === selectedChapterID ? "systemBlue" : "label"}>{chapter.title}</Text>
              {chapter.id === openingChapterID ? <ProgressView /> : null}
            </HStack>
          </Button>
          {index < chapters.length - 1 ? <Divider /> : null}
        </VStack>
      ))}
    </LazyVStack>
  )
}

export function ChapterDirectoryView({ bookID, cache, openChapter, onFirstChapter, onLatestChapter, selectedChapterID, openingChapterID, directoryRevision }: {
  bookID: number
  cache: ChapterDirectoryCache
  openChapter: (chapter: Chapter) => void
  onFirstChapter: (chapter: Chapter | null) => void
  onLatestChapter: (number: number | null) => void
  selectedChapterID?: number
  openingChapterID?: number | null
  directoryRevision: number
}) {
  const [chapters, setChapters] = useState(getChapters(bookID, cache))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const active = useRef<AbortController | null>(null)

  useEffect(() => {
    publishDirectory()
  }, [bookID, directoryRevision])

  useEffect(() => {
    void loadDirectory()
    return () => {
      active.current?.abort()
      active.current = null
    }
  }, [bookID])

  function publishDirectory() {
    const directory = cache.get(bookID)
    if (!directory) return
    setChapters(directory.chapters)
    onFirstChapter(directory.pages.get(1)?.[0] ?? null)
    if (directory.pages.size >= Math.max(1, directory.totalPage)) {
      onLatestChapter(directory.chapters[directory.chapters.length - 1]?.number ?? null)
    }
  }

  async function loadDirectory() {
    const cached = cache.get(bookID)
    if (active.current || (cached && cached.pages.size >= Math.max(1, cached.totalPage))) return

    const controller = new AbortController()
    active.current = controller
    const { signal } = controller
    setLoading(true)
    setError("")
    try {
      if (!cached) {
        await readDirectoryPage(bookID, cache, 1, signal)
        if (signal.aborted) return
        publishDirectory()
      }
      const directory = cache.get(bookID)!
      const pending: number[] = []
      for (let page = 2; page <= directory.totalPage; page++) {
        if (!directory.pages.has(page)) pending.push(page)
      }
      const failed: number[] = []
      for (let offset = 0; offset < pending.length && !signal.aborted; offset += MAX_CONCURRENT_PAGES) {
        const batch = pending.slice(offset, offset + MAX_CONCURRENT_PAGES).filter(page => !directory.pages.has(page))
        const results = await Promise.allSettled(batch.map(page => fetchChapterPage(bookID, page, signal)))
        if (signal.aborted) return
        results.forEach((result, index) => {
          const page = batch[index]
          if (result.status === "fulfilled") directory.pages.set(page, result.value.chapters)
          else if (!directory.pages.has(page)) failed.push(page)
        })
        updateDirectoryIndex(directory)
        publishDirectory()
      }
      if (failed.length) setError(`第 ${failed.join("、")} 页加载失败。`)
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
        <ChapterDirectoryRows chapters={chapters} openChapter={openChapter} selectedChapterID={selectedChapterID} openingChapterID={openingChapterID} />
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
