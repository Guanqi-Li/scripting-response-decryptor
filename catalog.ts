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

function parseComic(value: unknown): Comic {
  if (!isRecord(value) || typeof value.title !== "string") {
    throw new Error("漫画资料格式有误。")
  }
  const lastChapter = isRecord(value.last_chapter) ? value.last_chapter : null
  const chapterID = lastChapter?.book_id
  const bookID = isID(chapterID) ? chapterID : value.id
  if (!isID(bookID)) throw new Error("漫画资料缺少 book_id。")
  return {
    bookID,
    title: value.title,
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
  return { page, totalPage: value.totalPage, books: value.list.map(parseComic) }
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
    updatedAt: textValue(lastChapter?.updated_at) || textValue(detail.renew_time) || book.updatedAt,
    latestChapter: chapterNumber(chapter?.sumChapters) ?? book.latestChapter,
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
  const chapters = value.list.map((chapter: unknown): Chapter => {
    if (!isRecord(chapter) || !isID(chapter.id) || typeof chapter.title !== "string"
      || (chapter.book_id !== undefined && chapter.book_id !== bookID)) {
      throw new Error("章节资料格式有误。")
    }
    return { id: chapter.id, title: chapter.title, number: chapterNumber(chapter.sort) ?? undefined }
  })
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
  if (!images.length || images.some(url => !url)) throw new Error("这一话的图片列表为空或包含无效地址。")
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
    for (const key of Storage.keys()) {
      if (/^stacks-v1:type1:size15:category\d+$/.test(key)) Storage.remove(key)
    }
  } catch (error) {
    console.warn("无法清理旧版漫画缓存", error)
  }
}
