import { requestAndDecrypt } from "./request"

export const SITE_ORIGIN = "https://www.18akmanhua.com"
const PAGE_SIZE = 15

export type Category = { id: number; name: string }
export type Comic = {
  bookID: number
  title: string
  author: string
  coverURL: string
  updatedAt: string
  latestChapter: number | null
}
export type Catalog = { page: number; totalPage: number; books: Comic[] }
export type Chapter = { id: number; title: string; number?: number }
export type ChapterPage = { totalPage: number; chapters: Chapter[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isID(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function chapterNumber(value: unknown): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value
  return isID(number) && number > 0 ? number : null
}

function isCategory(value: unknown): value is Category {
  return isRecord(value) && isID(value.id) && typeof value.name === "string" && value.name.trim().length > 0
}

function coverURL(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) return ""
  try {
    const url = new URL(path, SITE_ORIGIN)
    return url.origin === SITE_ORIGIN ? url.href : ""
  } catch {
    return ""
  }
}

function parseComic(value: unknown): Comic | null {
  if (!isRecord(value) || !textValue(value.title)) {
    return null
  }
  const lastChapter = isRecord(value.last_chapter) ? value.last_chapter : null
  const chapterID = lastChapter?.book_id
  const bookID = isID(chapterID) ? chapterID : value.id
  if (!isID(bookID)) return null
  return {
    bookID,
    title: textValue(value.title),
    author: typeof value.author === "string" ? value.author : "",
    coverURL: coverURL(value.image),
    updatedAt: textValue(value.renew_time),
    latestChapter: chapterNumber(lastChapter?.sort),
  }
}

export async function fetchCategories(signal: AbortSignal): Promise<Category[]> {
  const { value } = await requestAndDecrypt(SITE_ORIGIN + "/api/stacksCategories", "", signal)
  if (!Array.isArray(value) || !value.every(isCategory)) {
    throw new Error("解密后的分类数据格式有误。")
  }
  return [...new Map(value.map(category => [category.id, category])).values()]
}

export async function fetchCatalog(categoryID: number, page: number, signal: AbortSignal): Promise<Catalog> {
  const url = new URL("/api/stacks", SITE_ORIGIN)
  url.searchParams.set("type", "1")
  url.searchParams.set("size", String(PAGE_SIZE))
  url.searchParams.set("page", String(page))
  url.searchParams.set("category", String(categoryID))
  const { value } = await requestAndDecrypt(url.href, "", signal)
  if (!isRecord(value) || value.page !== page || !isID(value.totalPage) || !Array.isArray(value.list)) {
    throw new Error("解密后的漫画列表格式有误。")
  }
  const books = value.list.map(parseComic).filter((book): book is Comic => book !== null)
  if (value.list.length && !books.length) throw new Error("这一页的漫画资料格式有误。")
  return { page, totalPage: value.totalPage, books }
}

export async function fetchBookDetails(book: Comic, signal: AbortSignal): Promise<Comic> {
  const url = new URL("/api/bookDetails", SITE_ORIGIN)
  url.searchParams.set("book_id", String(book.bookID))
  const { value } = await requestAndDecrypt(url.href, "", signal)
  if (!isRecord(value) || !isRecord(value.bookDetail) || value.bookDetail.id !== book.bookID) {
    throw new Error("解密后的漫画详情格式有误。")
  }

  const detail = value.bookDetail
  const lastChapter = isRecord(detail.last_chapter_obj) ? detail.last_chapter_obj : null
  const chapter = isRecord(lastChapter?.chapter_obj) ? lastChapter.chapter_obj : null
  return {
    bookID: book.bookID,
    title: typeof detail.title === "string" && detail.title.trim() ? detail.title : book.title,
    author: typeof detail.author === "string" && detail.author.trim() ? detail.author : book.author,
    coverURL: coverURL(detail.image) || book.coverURL,
    updatedAt: textValue(detail.renew_time) || book.updatedAt || textValue(lastChapter?.updated_at),
    latestChapter: book.latestChapter ?? chapterNumber(chapter?.sumChapters),
  }
}

export async function fetchChapterPage(bookID: number, page: number, signal: AbortSignal): Promise<ChapterPage> {
  const url = new URL("/api/chaptersDirectories", SITE_ORIGIN)
  url.searchParams.set("sort", "0")
  url.searchParams.set("page", String(page))
  url.searchParams.set("size", String(PAGE_SIZE))
  url.searchParams.set("book_id", String(bookID))
  const { value } = await requestAndDecrypt(url.href, "", signal)
  if (!isRecord(value) || value.page !== page || !isID(value.totalPage) || !Array.isArray(value.list)) {
    throw new Error("解密后的章节目录格式有误。")
  }
  const chapters: Chapter[] = []
  for (const row of value.list as unknown[]) {
    if (!isRecord(row) || !isID(row.id) || (row.book_id !== undefined && row.book_id !== bookID)) continue
    const number = chapterNumber(row.sort) ?? undefined
    chapters.push({ id: row.id, title: textValue(row.title) || (number ? `第${number}话` : "未命名章节"), number })
  }
  if (value.list.length && !chapters.length) throw new Error("这一页的章节资料格式有误。")
  return { totalPage: value.totalPage, chapters }
}

export type ReaderChapter = { chapter: Chapter; images: string[] }

let readerToken = ""

export function setReaderToken(token: string) {
  readerToken = token
}

export async function fetchReaderChapter(bookID: number, chapter: Chapter, signal: AbortSignal): Promise<ReaderChapter> {
  const url = new URL("/api/chaptersDetails", SITE_ORIGIN)
  url.searchParams.set("chapter_id", String(chapter.id))
  const { value } = await requestAndDecrypt(url.href, readerToken, signal)
  if (!isRecord(value) || !isRecord(value.chapterDetail)) throw new Error("章节详情格式有误。")
  const detail = value.chapterDetail
  if (detail.id !== chapter.id || detail.book_id !== bookID || !Array.isArray(detail.image_list)) {
    throw new Error("章节详情与当前漫画不匹配。")
  }
  const images = detail.image_list.map(coverURL)
  if (!images.some(Boolean)) throw new Error("这一话的图片列表为空或没有有效地址。")
  return {
    chapter: { id: chapter.id, title: textValue(detail.title) || chapter.title,
      number: chapterNumber(detail.sort) ?? chapter.number },
    images,
  }
}

export function appendCatalog(previous: Catalog | undefined, next: Catalog): Catalog {
  const books = new Map<number, Comic>()
  for (const book of previous?.books ?? []) books.set(book.bookID, book)
  for (const book of next.books) books.set(book.bookID, book)
  return { ...next, books: [...books.values()] }
}

export function clearLegacyCatalogCache() {
  try {
    if (Storage.get("legacy-catalog-cache-cleared-v1") === true) return
    for (const key of Storage.keys()) {
      if (/^stacks-v1:type1:size15:category\d+$/.test(key)) Storage.remove(key)
    }
    Storage.set("legacy-catalog-cache-cleared-v1", true)
  } catch (error) {
    console.warn("无法清理旧版漫画缓存", error)
  }
}
