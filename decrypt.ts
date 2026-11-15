import { createDecipheriv } from "node:crypto"
import { Buffer } from "node:buffer"

// 按 UTF-8 编码使用，不是十六进制解码。
export const KEY = "9a2d65b4a693ad0e40e5b156df25e406"
export const IV_PREFIX = "9a62e6977b"

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 支持完整响应 {data:{suffix,data}} 或直接的 {suffix,data}。 */
export function decryptResponse(response: unknown, key = KEY): unknown {
  if (typeof response === "string") {
    try { response = JSON.parse(response) }
    catch { throw new Error("响应不是有效的 JSON") }
  }
  if (!isObject(response)) throw new Error("响应必须是 JSON 对象")
  const payload = isObject(response.data) ? response.data : response
  if (typeof payload.suffix !== "string" || typeof payload.data !== "string") {
    throw new Error("缺少字符串字段 suffix 或 data")
  }
  const keyBytes = Buffer.from(key, "utf8")
  const iv = Buffer.from(IV_PREFIX + payload.suffix, "utf8")
  if (keyBytes.length !== 32 || iv.length !== 16) {
    throw new Error("AES 密钥须为 32 字节，IV 前缀拼接 suffix 后须为 16 字节")
  }
  const encoded = payload.data.replace(/\s/g, "")
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("data 不是有效的 Base64 密文")
  }
  const ciphertext = Buffer.from(encoded, "base64")
  if (!ciphertext.length || ciphertext.length % 16 !== 0) {
    throw new Error("AES-CBC 密文长度必须是 16 字节的倍数")
  }
  let plaintext: Uint8Array
  try {
    const decipher = createDecipheriv("aes-256-cbc", keyBytes, iv)
    // 默认自动校验并移除 PKCS#7 填充，不要再手动 unpad。
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error("AES-CBC 解密失败：请检查 KEY、suffix 或密文是否完整")
  }
  let text: string
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext) }
  catch { throw new Error("解密结果不是有效的 UTF-8 文本") }
  try { return JSON.parse(text) }
  catch { throw new Error("解密成功，但明文不是有效的 JSON") }
}
