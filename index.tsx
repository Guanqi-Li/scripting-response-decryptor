import { Button, Dialog, Navigation, Script, ScrollView, Text, VStack, useState } from "scripting"
import { decryptResponse } from "./decrypt"

function MainView() {
  const [result, setResult] = useState("")
  const [status, setStatus] = useState("复制接口的响应 JSON，再点击下方按钮。")
  const [busy, setBusy] = useState(false)

  async function decryptClipboard() {
    if (busy) return
    setBusy(true)
    try {
      const raw = await Pasteboard.getString()
      if (!raw?.trim()) throw new Error("剪贴板中没有响应 JSON")
      const value = decryptResponse(raw)
      setResult(JSON.stringify(value, null, 2))
      setStatus("解密成功，可查看或复制完整结果。")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  async function copyResult() {
    try {
      await Pasteboard.setString(result)
      setStatus("完整解密结果已复制。")
    } catch { setStatus("复制失败，请检查剪贴板权限。") }
  }

  return <VStack padding spacing={12}>
    <Text font="title">响应解密</Text>
    <Text>{status}</Text>
    <Button title={busy ? "正在解密…" : "读取剪贴板并解密"} action={decryptClipboard} disabled={busy} />
    <Button title="复制完整结果" action={copyResult} disabled={!result || busy} />
    <ScrollView><Text textSelection="enabled">{result || "解密结果显示在这里"}</Text></ScrollView>
    {Script.supportsMinimization() ? <Button title="最小化" action={async () => { await Script.minimize() }} /> : null}
    <Button title="退出" action={() => Script.exit()} />
  </VStack>
}

async function main() {
  try { await Navigation.present({ element: <MainView /> }) }
  catch (error) {
    await Dialog.alert({ title: "启动失败", message: error instanceof Error ? error.message : String(error) })
  } finally { Script.exit() }
}

main()
