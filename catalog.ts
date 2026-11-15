import { requestAndDecrypt } from "./request"

export const SITE_ORIGIN = "https://www.18akmanhua.com"
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
