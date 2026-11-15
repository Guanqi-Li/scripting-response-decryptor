import {
  Button, Dialog, HStack, Navigation, ProgressView, ScrollView, Text, VStack,
  useEffect, useRef, useState,
} from "scripting"
import { ComicCover, type CoverCache } from "./ComicGrid"
import { ChapterDirectoryView, getAdjacentChapter, getChapters, getPendingNextPage, readDirectoryPage, type ChapterDirectoryCache } from "./ChapterDirectoryView"
import { fetchBookDetails, type Chapter, type Comic } from "./catalog"
import { ChapterReader, type ReaderOpening } from "./ChapterReader"
import { ReaderRequests, type ReaderCache } from "./reader-cache"
import { ApiError } from "./request"
import { chapterLabel, type ReadingRecord } from "./reading-history"

export function ComicDetailView({ book, covers, cache, directories, readerCache, progress, refreshHistory }: {
  book: Comic
  covers: CoverCache
  cache: Map<number, Comic>
  directories: ChapterDirectoryCache
  readerCache: ReaderCache
  progress?: ReadingRecord
  refreshHistory: () => void
}) {
  const [detail, setDetail] = useState<Comic | null>(cache.get(book.bookID) ?? null)
  const [error, setError] = useState("")
  const active = useRef<AbortController | null>(null)
  const [firstChapter, setFirstChapter] = useState<Chapter | null>(directories.get(book.bookID)?.pages.get(1)?.[0] ?? null)
  const [directoryLatest, setDirectoryLatest] = useState<number | null>(null)
  const [directoryRevision, setDirectoryRevision] = useState(0)
  const [openingChapterID, setOpeningChapterID] = useState<number | null>(null)
  const [openingError, setOpeningError] = useState("")
  const opening = useRef(false)
  const preparation = useRef<ReaderRequests | null>(null)

  useEffect(() => {
    if (!detail) void loadDetails()
    return () => {
      active.current?.abort()
      active.current = null
      preparation.current?.close()
      preparation.current = null
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

  async function openReader(chapter: Chapter, page = 1) {
    if (opening.current) return
    opening.current = true
    setOpeningChapterID(chapter.id)
    setOpeningError("")
    const requests = new ReaderRequests(readerCache, display.bookID)
    preparation.current = requests
    try {
      let result: ReaderOpening
      try {
        result = { data: await requests.chapter(chapter) }
      } catch (error) {
        if (preparation.current === requests && progress?.chapter.id === chapter.id &&
          error instanceof ApiError && (error.status === 404 || error.code === 404)) {
          setOpeningError("上次阅读的章节已不可用，请从目录选择一话。")
          return
        }
        result = { error }
      }
      if (preparation.current !== requests) return
      preparation.current = null
      requests.close()

      await Navigation.present({
        element: <ChapterReader book={display} chapter={chapter} initialPage={page} opening={result} cache={readerCache}
          getChapters={() => getChapters(book.bookID, directories)}
          getAdjacent={(current, direction) => getAdjacentChapter(book.bookID, directories, current, direction)}
          getMissingPage={current => getPendingNextPage(book.bookID, directories, current)}
          reloadDirectoryPage={async (page, signal) => {
            await readDirectoryPage(book.bookID, directories, page, signal)
            if (!signal.aborted) setDirectoryRevision(revision => revision + 1)
          }} />,
        modalPresentationStyle: "fullScreen",
      })
    } catch (error) {
      await Dialog.alert({ title: "无法打开阅读器", message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (preparation.current === requests) {
        preparation.current = null
        requests.close()
      }
      opening.current = false
      setOpeningChapterID(null)
      refreshHistory()
    }
  }

  const startChapter = progress?.chapter ?? firstChapter
  const latestChapter = directoryLatest ?? display.latestChapter
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
                {latestChapter !== null ? `最新章节 第 ${latestChapter} 话` : "最新章节 —"}
              </Text>
            </VStack>
            <Button
              title={openingChapterID === startChapter?.id ? "正在打开…" : progress ? `继续阅读 ${chapterLabel(progress.chapter)}` : "开始阅读"}
              buttonStyle="borderedProminent"
              disabled={!startChapter || openingChapterID !== null}
              action={() => { if (startChapter) void openReader(startChapter, progress?.page ?? 1) }}
            />
            {openingError ? <Text font="footnote" foregroundStyle="secondaryLabel">{openingError}</Text> : null}
          </VStack>
        </HStack>
        {error ? (
          <VStack alignment="leading" spacing={8}>
            <Text>详情加载失败。{error}</Text>
            <Button title="重试" action={loadDetails} />
          </VStack>
        ) : detail ? null : <ProgressView />}
        <ChapterDirectoryView key={book.bookID} bookID={book.bookID} cache={directories}
          openChapter={chapter => { void openReader(chapter) }} onFirstChapter={setFirstChapter}
          onLatestChapter={setDirectoryLatest} selectedChapterID={progress?.chapter.id}
          openingChapterID={openingChapterID} directoryRevision={directoryRevision} />
      </VStack>
    </ScrollView>
  )
}
