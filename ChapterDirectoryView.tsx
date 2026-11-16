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
  if (page === 1) directory.totalPage = totalPage
  directory.pages.set(page, chapters)
  updateDirectoryIndex(directory)
}

function missingDirectoryPages(directory: ChapterDirectory): number[] {
  const pages: number[] = []
  for (let page = 1; page <= Math.max(1, directory.totalPage); page++) {
    if (!directory.pages.has(page)) pages.push(page)
  }
  return pages
}

type DirectoryLoad = {
  controller: AbortController
  observers: Set<() => void>
  finished: Promise<void>
}

const directoryLoads = new WeakMap<ChapterDirectoryCache, Map<number, DirectoryLoad>>()

async function loadAllPages(
  bookID: number, cache: ChapterDirectoryCache, signal: AbortSignal, publish: () => void,
) {
  if (signal.aborted) return
  if (!cache.get(bookID)?.pages.has(1)) {
    await readDirectoryPage(bookID, cache, 1, signal)
    if (signal.aborted) return
    publish()
  }

  const directory = cache.get(bookID)
  if (!directory) return
  const pending = missingDirectoryPages(directory)
  for (let offset = 0; offset < pending.length && !signal.aborted; offset += MAX_CONCURRENT_PAGES) {
    const batch = pending.slice(offset, offset + MAX_CONCURRENT_PAGES).filter(page => !directory.pages.has(page))
    const results = await Promise.allSettled(batch.map(page => fetchChapterPage(bookID, page, signal)))
    if (signal.aborted) return
    results.forEach((result, index) => {
      if (result.status === "fulfilled") directory.pages.set(batch[index], result.value.chapters)
    })
    updateDirectoryIndex(directory)
    publish()
  }
  if (signal.aborted) return
  const remaining = missingDirectoryPages(directory)
  if (remaining.length) throw new Error(`第 ${remaining.join("、")} 页加载失败。`)
}

export function observeDirectoryLoad(bookID: number, cache: ChapterDirectoryCache, publish: () => void) {
  let byBook = directoryLoads.get(cache)
  if (!byBook) {
    byBook = new Map()
    directoryLoads.set(cache, byBook)
  }
  const loads = byBook
  let load = loads.get(bookID)
  if (!load) {
    const controller = new AbortController()
    const observers = new Set<() => void>()
    const finished = Promise.resolve().then(() =>
      loadAllPages(bookID, cache, controller.signal, () => observers.forEach(update => update())),
    ).finally(() => {
      if (loads.get(bookID)?.controller === controller) loads.delete(bookID)
    })
    load = { controller, observers, finished }
    loads.set(bookID, load)
  }

  const joined = load
  joined.observers.add(publish)
  return {
    finished: joined.finished,
    release() {
      joined.observers.delete(publish)
      if (joined.observers.size === 0 && loads.get(bookID) === joined) {
        loads.delete(bookID)
        joined.controller.abort()
      }
    },
  }
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

export function ChapterDirectoryView({ bookID, cache, openChapter, onFirstChapter, onLatestChapter, selectedChapterID,
  openingChapterID, directoryRevision = 0, showHeading = true }: {
  bookID: number
  cache: ChapterDirectoryCache
  openChapter: (chapter: Chapter) => void
  onFirstChapter?: (chapter: Chapter | null) => void
  onLatestChapter?: (number: number | null) => void
  selectedChapterID?: number
  openingChapterID?: number | null
  directoryRevision?: number
  showHeading?: boolean
}) {
  const [chapters, setChapters] = useState(getChapters(bookID, cache))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const active = useRef<ReturnType<typeof observeDirectoryLoad> | null>(null)

  useEffect(() => {
    publishDirectory()
  }, [bookID, directoryRevision])

  useEffect(() => {
    void loadDirectory()
    return () => {
      active.current?.release()
      active.current = null
    }
  }, [bookID])

  function publishDirectory() {
    const directory = cache.get(bookID)
    if (!directory) return
    setChapters(directory.chapters)
    onFirstChapter?.(directory.pages.get(1)?.[0] ?? null)
    if (onLatestChapter && missingDirectoryPages(directory).length === 0) {
      onLatestChapter(directory.chapters[directory.chapters.length - 1]?.number ?? null)
    }
  }

  async function loadDirectory() {
    const cached = cache.get(bookID)
    if (active.current || (cached && missingDirectoryPages(cached).length === 0)) return

    const load = observeDirectoryLoad(bookID, cache, publishDirectory)
    active.current = load
    setLoading(true)
    setError("")
    try {
      await load.finished
    } catch (cause) {
      if (active.current === load) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      load.release()
      if (active.current === load) {
        active.current = null
        setLoading(false)
      }
    }
  }

  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {showHeading ? <Text font="headline">章节目录</Text> : null}
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
