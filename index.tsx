import { Button, Dialog, Navigation, Script, ScrollView, Text, VStack, useState, useRef, useEffect } from "scripting"
import { parseApiURL, requestAndDecrypt } from "./request"

function MainView() {
  const [url, setURL] = useState("")
  const [token, setToken] = useState("")
  const [result, setResult] = useState("")
  const [status, setStatus] = useState("先输入接口完整网址，再点击 GET 请求并解密。")
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; active.current?.abort() }
  }, [])

  async function enterURL() {
    const value = await Dialog.prompt({ title: "输入接口网址", message: "例如 https://www.18akmanhua.com/api/banners", defaultValue: url, confirmLabel: "保存", cancelLabel: "取消" })
    if (value === null) return
    try { setURL(parseApiURL(value).url); setStatus("网址已设置，可以开始请求。") }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  async function enterToken() {
    const value = await Dialog.prompt({ title: "可选 token", message: "无需登录的接口可留空。仅保存在本次运行内存中。", defaultValue: token, obscureText: true, confirmLabel: "保存", cancelLabel: "取消" })
    if (value !== null) setToken(value.trim())
  }

  async function request() {
    if (active.current) return
    if (!url) { setStatus("请先输入接口完整网址。"); return }
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setStatus("正在发送 GET 请求并解密…")
    try {
      const response = await requestAndDecrypt(url, token, controller.signal)
      if (!mounted.current || active.current !== controller) return
      setResult(JSON.stringify(response.value, null, 2))
      setStatus(`HTTP ${response.status} · 解密成功 · ${new Date().toLocaleTimeString()}`)
    } catch (error) {
      if (mounted.current && active.current === controller) setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (active.current === controller) {
        active.current = null
        if (mounted.current) setBusy(false)
      }
    }
  }

  function exit() { active.current?.abort(); Script.exit() }

  return <VStack padding spacing={12}>
    <Text font="title">GET 响应解密</Text>
    <Text>{url || "尚未输入网址"}</Text>
    <Button title="输入或修改网址" action={enterURL} disabled={busy} />
    <Button title={token ? "修改 token（已设置）" : "设置 token（可选）"} action={enterToken} disabled={busy} />
    <Button title={busy ? "请求中…" : "GET 请求并解密"} action={request} disabled={busy} />
    {busy ? <Button title="取消请求" action={() => active.current?.abort()} /> : null}
    <Text>{status}</Text>
    <ScrollView><Text textSelection="enabled">{result || "解密结果显示在这里"}</Text></ScrollView>
    {Script.supportsMinimization() ? <Button title="最小化" action={async () => { await Script.minimize() }} /> : null}
    <Button title="退出" action={exit} />
  </VStack>
}

async function main() {
  try { await Navigation.present({ element: <MainView /> }) }
  catch (error) { await Dialog.alert({ title: "启动失败", message: error instanceof Error ? error.message : String(error) }) }
  finally { Script.exit() }
}
main()
