import { createHash } from "node:crypto"
import { decryptResponse } from "./decrypt"

export const SITE_ORIGIN = "https://www.18akmanhua.com"
export const SECRET = "6F7A4DF7000C045C636B9123B11E4EC7"

export function parseApiURL(input: string): { url: string, apiPath: string } {
  let url: URL
  try { url = new URL(input.trim()) }
  catch { throw new Error("请输入完整网址，例如 https://www.18akmanhua.com/api/banners") }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("网址必须以 https:// 或 http:// 开头")
  if (url.username || url.password) throw new Error("网址中不能包含账号密码")
  if (!url.pathname.startsWith("/api/")) throw new Error("接口网址路径必须以 /api/ 开头")
  url.hash = ""
  return { url: url.toString(), apiPath: url.pathname.slice(4) }
}

export function makeHeaders(apiPath: string, method = "GET", token?: string, now = Date.now()): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000))
  const raw = timestamp + "api" + apiPath + method.toUpperCase() + SECRET
  const sign = createHash("md5").update(raw, "utf8").digest("hex")
  const headers: Record<string, string> = { timestamp, sign, "User-Agent": "Mozilla/5.0" }
  if (token) headers.token = token
  return headers
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message)
    this.name = "ApiError"
  }
}

class NetworkError extends Error {}

const TOKEN_REJECTED = /token\s*(?:已?失效|已?过期|无效|不存在)|(?:invalid|expired)\s+token|token\s+(?:is\s+)?(?:invalid|expired)/i

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 401 || TOKEN_REJECTED.test(error.message))
}

export function isTransientRequestError(error: unknown): boolean {
  if (error instanceof NetworkError) return true
  if (!(error instanceof ApiError)) return false
  const code = error.code ?? error.status
  return code === 408 || code === 429 || code >= 500
}

export async function requestAndDecrypt(
  input: string, token: string, signal: AbortSignal, json?: Record<string, unknown>,
): Promise<{ status: number, value: unknown }> {
  const target = parseApiURL(input)
  const method = json === undefined ? "GET" : "POST"
  const headers = { ...makeHeaders(target.apiPath, method, token), "Cache-Control": "no-cache, no-store" }
  let response: Response
  let body: string
  try {
    response = await fetch(target.url, {
      method,
      headers: json === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
      timeout: 15,
      signal,
      // 换路径后的签名会失效，不携带 token 自动跳转。
      handleRedirect: async () => null,
    })
    body = await response.text()
  } catch (error) {
    if (signal.aborted) throw new Error("请求已取消")
    throw new NetworkError("网络请求失败或超过 15 秒，请检查网址和网络连接。" + (error instanceof Error ? " " + error.message : ""))
  }
  const status = `HTTP ${response.status}`
  const responseError = json === undefined ? body.slice(0, 300) : "登录接口返回错误"
  const text = body.trim()
  if (!text) throw new ApiError(`${status}：响应为空`, response.status)
  if (text.startsWith("<")) {
    const unavailable = /site unavailable|unable to access this site|service unavailable/i.test(text)
    throw new ApiError(unavailable ? "当前网络无法访问漫画站点，请稍后重试。" :
      `${status}：漫画站点返回了网页，接口需要 JSON。`, response.status, unavailable ? 503 : undefined)
  }

  let envelope: unknown
  try {
    envelope = JSON.parse(text)
  } catch {
    if (!response.ok) throw new ApiError(`${status}：${responseError}`, response.status)
    throw new Error(`${status}：响应不是有效的 JSON`)
  }

  if (typeof envelope === "object" && envelope !== null) {
    const rawCode = "code" in envelope ? envelope.code : undefined
    const code = typeof rawCode === "string" && /^\d+$/.test(rawCode) ? Number(rawCode) : rawCode
    const candidates = [
      "message" in envelope ? envelope.message : undefined,
      "msg" in envelope ? envelope.msg : undefined,
    ]
    const message = candidates.find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim()
    if (typeof code === "number" && (code >= 400 || (json !== undefined && code !== 200))) {
      const fallback = code === 401 ? "网站拒绝了当前请求，请检查登录状态或章节权限。" : "接口返回错误"
      throw new ApiError(`${status}：接口 ${code}：${message || fallback}`, response.status, code)
    }
    if (message && (!response.ok || (json === undefined && TOKEN_REJECTED.test(message)))) throw new ApiError(`${status}：${message}`, response.status)
  }
  if (!response.ok) throw new ApiError(`${status}：${responseError}`, response.status)

  try {
    return { status: response.status, value: decryptResponse(envelope) }
  } catch (error) {
    throw new Error(`${status}：${error instanceof Error ? error.message : String(error)}`)
  }
}
