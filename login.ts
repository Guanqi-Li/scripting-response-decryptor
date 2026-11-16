import { isAuthenticationError, requestAndDecrypt, SITE_ORIGIN } from "./request"

const SESSION_KEY = "aimanhua-login-v1"
type Credentials = { username: string; password: string }
type LoginSession = Credentials & { token: string }
type Renewal = { revision: number; token: Promise<string>; readers: number }

let revision = 0
let renewal: Renewal | undefined

function isToken(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !/[\s\u0000-\u001f\u007f]/.test(value)
}

export function readLogin(): LoginSession | null {
  const value = Storage.get<unknown>(SESSION_KEY)
  if (value === null || value === undefined) return null
  if (typeof value !== "object" || !("username" in value) || typeof value.username !== "string"
    || !("password" in value) || typeof value.password !== "string"
    || !("token" in value) || !isToken(value.token)) {
    return null
  }
  return { username: value.username, password: value.password, token: value.token }
}

function saveLogin(session: LoginSession) {
  if (!Storage.set(SESSION_KEY, session)) throw new Error("无法保存本机登录信息。")
  revision++
}

export function requestWithSavedToken(input: string, signal: AbortSignal) {
  return requestAndDecrypt(input, readLogin()?.token ?? "", signal)
}

async function requestToken({ username, password }: Credentials, signal: AbortSignal): Promise<string> {
  const { value } = await requestAndDecrypt(SITE_ORIGIN + "/api/newLogins", "", signal, { username, password, type: 0 })
  if (typeof value !== "object" || value === null || !("token" in value) || !isToken(value.token)) {
    throw new Error("登录响应缺少有效 token。")
  }
  return value.token
}

export async function signIn(credentials: Credentials, signal: AbortSignal) {
  const token = await requestToken(credentials, signal)
  if (signal.aborted) throw new Error("登录已取消。")
  saveLogin({ ...credentials, token })
}

export async function withChapterToken<T>(request: (token: string) => Promise<T>, signal: AbortSignal): Promise<T> {
  const session = readLogin()
  const originalRevision = revision
  try {
    return await request(session?.token ?? "")
  } catch (error) {
    if (signal.aborted || !isAuthenticationError(error)) throw error
  }

  if (revision !== originalRevision) return request(readLogin()?.token ?? "")
  if (!session) throw new Error("请前往「我的」登录后重试章节。")
  if (!renewal || renewal.revision !== originalRevision) {
    // 同时打开和预加载章节时，共用登录请求，不绑定其中某一个章节的取消信号。
    renewal = { revision: originalRevision, token: requestToken(session, new AbortController().signal), readers: 0 }
  }
  const current = renewal
  current.readers++
  try {
    const token = await current.token
    if (signal.aborted) throw new Error("章节请求已取消。")
    if (revision !== originalRevision) return request(readLogin()?.token ?? "")
    const result = await request(token)
    if (!signal.aborted && revision === originalRevision) saveLogin({ ...session, token })
    return result
  } finally {
    current.readers--
    if (current.readers === 0 && renewal === current) renewal = undefined
  }
}
