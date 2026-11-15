import {
  Button, Dialog, HStack, Navigation, ProgressView, ScrollView, Text, VStack,
  useEffect, useRef, useState,
} from "scripting"
import { ComicCover, type CoverCache } from "./ComicGrid"
import { ChapterDirectoryView, getAdjacentChapter, getChapters, type ChapterDirectoryCache } from "./ChapterDirectoryView"
import { fetchBookDetails, type Chapter, type Comic } from "./catalog"
import { ChapterReader, type ReaderOpening } from "./ChapterReader"
import { ReaderRequests, type ReaderCache } from "./reader-cache"
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
    const requests = new ReaderRequests(readerCache, display.bookID)
    preparation.current = requests
    try {
      let result: ReaderOpening
      try {
        result = { data: await requests.chapter(chapter) }
      } catch (error) {
        result = { error }
      }
      if (preparation.current !== requests) return
      preparation.current = null
      requests.close()

      await Navigation.present({
        element: <ChapterReader book={display} chapter={chapter} initialPage={page} opening={result} cache={readerCache}
          getChapters={() => getChapters(book.bookID, directories)}
          getAdjacent={(current, direction) => getAdjacentChapter(book.bookID, directories, current, direction)} />,
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
      refreshHistory()
    }
  }

  const startChapter = progress?.chapter ?? firstChapter
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
            <Button
              title={progress ? `继续阅读 ${chapterLabel(progress.chapter)}` : "开始阅读"}
              buttonStyle="borderedProminent"
              disabled={!startChapter}
              action={() => { if (startChapter) void openReader(startChapter, progress?.page ?? 1) }}
            />
          </VStack>
        </HStack>
        {error ? (
          <VStack alignment="leading" spacing={8}>
            <Text>详情加载失败。{error}</Text>
            <Button title="重试" action={loadDetails} />
          </VStack>
        ) : detail ? null : <ProgressView />}
        <ChapterDirectoryView key={book.bookID} bookID={book.bookID} cache={directories}
          openChapter={chapter => { void openReader(chapter) }} onFirstChapter={setFirstChapter} />
      </VStack>
    </ScrollView>
  )
}
