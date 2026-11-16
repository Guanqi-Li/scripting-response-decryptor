import { WebView, useEffect, useMemo, useObservable, useRef } from "scripting"
import { webReaderHTML } from "./web-reader-html"

type WebPage = { id: string; url: string }

export type WebReaderEvent =
  | { key: number; kind: "tap" }
  | { key: number; kind: "position"; ids: string[]; end: boolean }
  | { key: number; kind: "image"; id: string; ready: boolean; elapsed: number }
  | { key: number; kind: "fallback" }

type Props = {
  pages: WebPage[]
  generation: number
  startID: string | null
  preload: string[]
  onEvent: (event: WebReaderEvent) => void
  onFailure: () => void
}

export function WebReaderSurface(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const controller = useMemo(() => {
    try { return new WebViewController() }
    catch { return null }
  }, [])
  const applied = useObservable(false)
  const sync = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!controller) {
      latest.current.onFailure()
      return
    }
    let active = true
    let ready = false
    let pending = false
    let queued = false
    let failed = false
    const startup = setTimeout(fail, 8000)

    function fail() {
      if (!active || failed) return
      failed = true
      clearTimeout(startup)
      latest.current.onFailure()
    }

    function schedule() {
      queued = true
      if (!ready || pending || failed) return
      void flush()
    }

    async function flush() {
      if (!controller) return
      pending = true
      try {
        while (active && !failed && queued) {
          queued = false
          const { pages, generation, startID, preload } = latest.current
          const payload = {
            pages: pages.map(({ id, url }) => ({ id, url })),
            key: generation, startID, preload,
          }
          const update = await controller.evaluateJavaScript<boolean>(
            `return window.updateReader(${JSON.stringify(payload)})`,
          )
          if (update !== true) throw new Error("阅读器网页没有处理更新")
          if (active && !failed && !applied.value) {
            clearTimeout(startup)
            applied.setValue(true)
          }
        }
      } catch {
        fail()
      } finally {
        pending = false
      }
    }

    async function start() {
      if (!controller) return
      try {
        await controller.addScriptMessageHandler("reader", (message: unknown) => {
          if (!active) return false
          let payload = message
          if (typeof payload === "string") {
            try { payload = JSON.parse(payload) }
            catch { return false }
          }
          if (!isEvent(payload)) return false
          latest.current.onEvent(payload)
          return true
        })
        if (!active) return
        if (!await controller.loadHTML(webReaderHTML)) throw new Error("阅读器网页未加载")
        if (!active) return
        ready = true
        schedule()
      } catch {
        fail()
      }
    }

    sync.current = schedule
    void start()
    return () => {
      active = false
      clearTimeout(startup)
      sync.current = null
      controller.dispose()
    }
  }, [controller])

  useEffect(() => {
    sync.current?.()
  }, [props.pages, props.generation, props.preload])

  return controller ? (
    <WebView controller={controller} opacity={applied.value ? 1 : 0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={{ regions: "container", edges: "all" }} />
  ) : null
}

function isEvent(value: unknown): value is WebReaderEvent {
  if (typeof value !== "object" || value === null || !("key" in value) || typeof value.key !== "number"
    || !("kind" in value)) return false
  if (value.kind === "tap" || value.kind === "fallback") return true
  if (value.kind === "position") {
    return "ids" in value && Array.isArray(value.ids) && value.ids.every(id => typeof id === "string")
      && "end" in value && typeof value.end === "boolean"
  }
  return value.kind === "image" && "id" in value && typeof value.id === "string"
    && "ready" in value && typeof value.ready === "boolean"
    && "elapsed" in value && typeof value.elapsed === "number" && Number.isFinite(value.elapsed)
}
