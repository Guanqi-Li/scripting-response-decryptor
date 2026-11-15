import { createHash } from "node:crypto"
import { decryptResponse } from "./decrypt"

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

export async function requestAndDecrypt(input: string, token: string, signal: AbortSignal): Promise<{ status: number, value: unknown }> {
  const target = parseApiURL(input)
  let response: Response
  let body: string
  try {
    response = await fetch(target.url, {
      method: "GET",
      headers: { ...makeHeaders(target.apiPath, "GET", token), "Cache-Control": "no-cache, no-store" },
      timeout: 15,
      signal,
      // 换路径后的签名会失效，不携带 token 自动跳转。
      handleRedirect: async () => null,
    })
    body = await response.text()
  } catch (error) {
    if (signal.aborted) throw new Error("请求已取消")
    throw new Error("网络请求失败或超过 15 秒，请检查网址和网络连接。" + (error instanceof Error ? " " + error.message : ""))
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}：${body.slice(0, 300) || "服务器未返回内容"}`)
  if (!body.trim()) throw new Error(`HTTP ${response.status}：响应为空`)
  try {
    const value = decryptResponse(body)
    const envelope: unknown = JSON.parse(body)
    if (typeof envelope === "object" && envelope !== null && "code" in envelope && typeof envelope.code === "number" && envelope.code >= 400) {
      const message = "msg" in envelope && typeof envelope.msg === "string" ? envelope.msg : "接口返回错误"
      throw new Error(`接口 ${envelope.code}：${message}`)
    }
    return { status: response.status, value }
  }
  catch (error) { throw new Error(`HTTP ${response.status}：${error instanceof Error ? error.message : String(error)}`) }
}
