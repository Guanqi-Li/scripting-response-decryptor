import { requestAndDecrypt } from "./request"

export const SITE_ORIGIN = "https://www.18akmanhua.com"
export const NEW_CATEGORY = { id: 0, name: "新作" }
const PAGE_SIZE = 15

export type Category = { id: number; name: string }
export type Comic = { bookID: number; title: string; author: string; coverURL: string }
export type Catalog = { page: number; totalPage: number; books: Comic[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isID(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isCategory(value: unknown): value is Category {
  return isRecord(value) && isID(value.id) && typeof value.name === "string" && value.name.trim().length > 0
}

function isComic(value: unknown): value is Comic {
  return isRecord(value) && isID(value.bookID) && typeof value.title === "string"
    && typeof value.author === "string" && typeof value.coverURL === "string"
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
  const chapterID = isRecord(value.last_chapter) ? value.last_chapter.book_id : undefined
  const bookID = isID(chapterID) ? chapterID : value.id
  if (!isID(bookID)) throw new Error("漫画资料缺少 book_id。")
  return {
    bookID,
    title: value.title,
    author: typeof value.author === "string" ? value.author : "",
    coverURL: coverURL(value.image),
  }
}

export async function fetchCategories(signal: AbortSignal): Promise<Category[]> {
  const { value } = await requestAndDecrypt(SITE_ORIGIN + "/api/stacksCategories", "", signal)
  if (!Array.isArray(value) || !value.every(isCategory)) {
    throw new Error("解密后的分类数据格式有误。")
  }
  const otherCategories = new Map(value.filter(category => category.id !== NEW_CATEGORY.id)
    .map(category => [category.id, category]))
  return [NEW_CATEGORY, ...otherCategories.values()]
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

export function appendCatalog(previous: Catalog | undefined, next: Catalog): Catalog {
  const books = new Map<number, Comic>()
  for (const book of previous?.books ?? []) books.set(book.bookID, book)
  for (const book of next.books) books.set(book.bookID, book)
  return { ...next, books: [...books.values()] }
}

function catalogKey(categoryID: number): string {
  return `stacks-v1:type1:size${PAGE_SIZE}:category${categoryID}`
}

export function readCatalog(categoryID: number): Catalog | undefined {
  try {
    const value = Storage.get<unknown>(catalogKey(categoryID))
    if (isRecord(value) && isID(value.page) && value.page > 0 && isID(value.totalPage)
      && Array.isArray(value.books) && value.books.every(isComic)) {
      return { page: value.page, totalPage: value.totalPage, books: value.books }
    }
  } catch (error) {
    console.warn("无法读取漫画缓存", error)
  }
  return undefined
}

export function saveCatalog(categoryID: number, value: Catalog) {
  try {
    if (!Storage.set(catalogKey(categoryID), value)) console.warn("无法保存漫画缓存")
  } catch (error) {
    console.warn("无法保存漫画缓存", error)
  }
}
