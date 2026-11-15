import type { Chapter, Comic } from "./catalog"

export type ReadingRecord = {
  book: Comic
  chapter: Chapter
  page: number
  pageCount: number
  readAt: number
}
const HISTORY_KEY = "reading-history-v1"

function isReadingRecord(value: unknown): value is ReadingRecord {
  if (!value || typeof value !== "object") return false
  const { book, chapter, page, pageCount, readAt } = value as Partial<ReadingRecord>
  return !!book && Number.isSafeInteger(book.bookID)
    && typeof book.title === "string" && typeof book.author === "string"
    && typeof book.coverURL === "string" && typeof book.updatedAt === "string"
    && (book.latestChapter === null || Number.isSafeInteger(book.latestChapter))
    && !!chapter && Number.isSafeInteger(chapter.id) && typeof chapter.title === "string"
    && (chapter.number === undefined || Number.isSafeInteger(chapter.number))
    && typeof page === "number" && typeof pageCount === "number"
    && Number.isSafeInteger(page) && Number.isSafeInteger(pageCount) && page > 0 && page <= pageCount
    && typeof readAt === "number" && Number.isFinite(readAt)
}

function readRecords(): ReadingRecord[] {
  const value = Storage.get<unknown>(HISTORY_KEY)
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error("本地阅读记录格式有误。")
  return value.filter(isReadingRecord)
}

export function getReadingHistory(): ReadingRecord[] {
  return readRecords().sort((a, b) => b.readAt - a.readAt)
}

export function saveReadingRecord(record: ReadingRecord) {
  const records = readRecords().filter(item => item.book.bookID !== record.book.bookID)
  const { book, chapter, page, pageCount, readAt } = record
  const storedChapter = chapter.number === undefined ? { id: chapter.id, title: chapter.title } : chapter
  if (!Storage.set(HISTORY_KEY, [{ book, chapter: storedChapter, page, pageCount, readAt }, ...records])) throw new Error("无法保存阅读记录。")
}

export function chapterLabel(chapter: Chapter): string {
  const number = chapter.number ?? chapter.title.match(/^第\s*(\d+)\s*[话話]/)?.[1]
  return number === undefined ? chapter.title : `第${number}话`
}
