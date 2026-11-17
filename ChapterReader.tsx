import {
  Button, GeometryReader, HStack, Image, LazyVStack, Navigation, NavigationStack,
  ProgressView, Rectangle, ScrollView, ScrollViewReader, Spacer, Text, VStack, ZStack, useEffect, useObservable, useRef,
} from "scripting"
import type { Chapter, Comic, ReaderChapter } from "./catalog"
import { ChapterDirectoryView, type ChapterDirectoryCache } from "./ChapterDirectoryView"
import { isTransientRequestError } from "./request"
import { ReaderRequests, type ImageTiming, type ReaderCache } from "./reader-cache"
import { chapterLabel, saveReadingRecord, type ReadingRecord } from "./reading-history"

type ReaderPage = {
  id: string
  url: string
  chapter: Chapter
  number: number
  count: number
}

function makePages(data: ReaderChapter): ReaderPage[] {
  return data.images.map((url, index) => ({
    id: `${data.chapter.id}:${index + 1}`, url, chapter: data.chapter,
    number: index + 1, count: data.images.length,
  }))
}

function describeImageTiming(timing: Readonly<ImageTiming>, now: number): string {
  const parts: string[] = []
  const end = timing.finishedAt ?? now
  const elapsed = (from: number, to: number) => `${Math.max(0, to - from)} ms`
  parts.push(`排队 ${elapsed(timing.queuedAt, timing.startedAt ?? end)}`)
  if (timing.startedAt !== undefined) {
    parts.push(`下载 ${elapsed(timing.startedAt, timing.receivedAt ?? end)}`)
  }
  if (timing.processingAt !== undefined) parts.push(`处理 ${elapsed(timing.processingAt, end)}`)

  const status = timing.outcome === "ready" ? "已就绪" : timing.outcome === "failed" ? "失败"
    : timing.outcome === "cancelled" ? "已取消" : timing.processingAt !== undefined ? "处理中"
    : timing.receivedAt !== undefined ? "已下载"
    : timing.startedAt !== undefined ? "下载中" : "排队中"
  return `${status} · ${parts.join(" / ")}`
}

function ReaderImageRow({ page, cache, requests, width, placeholderHeight, previousURL, nextURL, showControls, updateRow }: {
  page: ReaderPage
  cache: ReaderCache
  requests: ReaderRequests
  width: number
  placeholderHeight: number
  previousURL?: string
  nextURL?: string
  showControls: () => void
  updateRow: (id: string, update: () => void) => void
}) {
  const update = useObservable(0)
  void update.value
  const loaded = cache.images.get(page.url)
  const failed = requests.failed.has(page.url)
  useEffect(() => {
    let mounted = true
    const invalidate = () => { if (mounted) update.setValue(update.value + 1) }
    const stop = requests.observe(page.url, () => updateRow(page.id, invalidate))
    if (cache.images.get(page.url) !== loaded || requests.failed.has(page.url) !== failed) {
      updateRow(page.id, invalidate)
    }
    return () => {
      mounted = false
      stop()
    }
  }, [page.url, requests])

  const measured = cache.ratios.get(page.url)
  const expected = useRef((previousURL && cache.ratios.get(previousURL)) || (nextURL && cache.ratios.get(nextURL)))
  const ratio = measured || expected.current
  const height = ratio ? width * ratio : placeholderHeight
  return (
    <ZStack frame={{ width, height }} contentShape="rect" onTapGesture={loaded ? undefined : showControls}>
      {loaded ? (
        <Image image={loaded.image} resizable frame={{ width, height }}
          contentShape="rect" onTapGesture={showControls} />
      ) : failed
        ? <Button title={`重试第 ${page.number} 张`} action={() => requests.retry(page.url)} />
        : !page.url ? <Text foregroundStyle="white">第 {page.number} 张图片地址无效</Text>
        : <ProgressView tint="white" />}
    </ZStack>
  )
}

function ReaderDirectory({ bookID, directoryCache, chapterID, select }: {
  bookID: number
  directoryCache: ChapterDirectoryCache
  chapterID: number
  select: (chapter: Chapter) => void
}) {
  const dismiss = Navigation.useDismiss()
  const position = useObservable<number | null>(chapterID)
  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="章节目录"
        navigationBarTitleDisplayMode="inline"
        scrollPosition={{ value: position, anchor: "top" }}
        toolbar={{ cancellationAction: <Button title="关闭" action={() => { dismiss() }} /> }}
      >
        <VStack padding={16}>
          <ChapterDirectoryView bookID={bookID} cache={directoryCache} showHeading={false}
            selectedChapterID={chapterID} openChapter={chapter => { select(chapter); dismiss() }} />
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

export type ReaderOpening = { data: ReaderChapter } | { error: unknown }

export function ChapterReader({ book, chapter, initialPage, opening, cache, directoryCache, getAdjacent,
  getMissingPage, reloadDirectoryPage }: {
  book: Comic
  chapter: Chapter
  initialPage: number
  opening: ReaderOpening
  cache: ReaderCache
  directoryCache: ChapterDirectoryCache
  getAdjacent: (chapter: Chapter, direction: -1 | 1) => Chapter | undefined
  getMissingPage: (chapter: Chapter) => number | undefined
  reloadDirectoryPage: (page: number, signal: AbortSignal) => Promise<void>
}) {
  const dismiss = Navigation.useDismiss()
  const request = useRef<ReaderRequests | null>(null)
  const requests = request.current ?? (request.current = new ReaderRequests(cache, book.bookID))
  const initialPages = useRef<ReaderPage[] | null>(null)
  if (initialPages.current === null) initialPages.current = "data" in opening ? makePages(opening.data) : []
  const initialTarget = initialPages.current[Math.min(initialPages.current.length, Math.max(1, initialPage)) - 1]
  const openingError = "error" in opening ? opening.error : undefined
  const pages = useObservable(initialPages.current)
  const selected = useObservable(initialTarget?.chapter ?? chapter)
  const controls = useObservable(false)
  const imageTimings = useObservable<string | null>(null)
  const busy = useObservable(false)
  const error = useObservable("error" in opening
    ? openingError instanceof Error ? openingError.message : String(openingError)
    : "")
  const errorKind = useRef<"open" | "append">("open")
  const directoryGap = useObservable<number | null>(null)
  const directoryError = useObservable("")
  const directoryRequest = useRef<AbortController | null>(null)
  const warning = useObservable("")
  const mounted = useRef(true)
  const scrollKey = useObservable(0)
  const restoredScrollKey = useRef<number | null>(null)
  const moving = useRef(false)
  const deferredRows = useRef(new Map<string, () => void>())
  const visible = useRef<string[]>([])
  const reachedEnd = useRef<string | null>(null)
  const activePage = useRef<ReaderPage | null>(null)
  const indexed = useRef<{ items: ReaderPage[]; byID: Map<string, number> } | null>(null)
  const target = useRef<string | null>(initialTarget?.id ?? null)
  const last = useRef<ReadingRecord | null>(null)
  const lastSaved = useRef("")
  const prefetch = useRef<{ forChapter: number } | null>(null)
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retry = useRef<(() => void) | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const directoryOpen = useRef(false)

  function save() {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    if (!last.current) return
    const key = `${last.current.chapter.id}:${last.current.page}`
    if (key === lastSaved.current) return
    try {
      saveReadingRecord(last.current)
      lastSaved.current = key
      if (mounted.current && warning.value) warning.setValue("")
    } catch {
      if (mounted.current) warning.setValue("阅读进度保存失败。")
    }
  }

  function close() {
    if (!mounted.current) return
    mounted.current = false
    clearTimeout(hideTimer.current)
    save()
    stopRequests()
    dismiss()
  }

  function pageIndex() {
    const items = pages.value
    if (indexed.current?.items !== items) {
      indexed.current = { items, byID: new Map(items.map((page, index) => [page.id, index])) }
    }
    return indexed.current.byID
  }

  function queueChapterImages(next: string[] = []) {
    requests.queueImages([...pages.value.map(page => page.url), ...next])
  }

  function reachedPrefetchPoint(page: ReaderPage, tail: ReaderPage): boolean {
    return page.chapter.id === tail.chapter.id && page.number * 3 >= page.count * 2
  }

  function prioritize(ids: string[]) {
    const items = pages.value
    const positions = pageIndex()
    const indexes = ids.map(id => positions.get(id)).filter((index): index is number => index !== undefined).sort((a, b) => a - b)
    if (!indexes.length) return
    const nearby = indexes.map(index => items[index])
    const start = indexes[0]
    const end = indexes[indexes.length - 1]
    const ahead = items.slice(end + 1, end + 6)
    const behind = items.slice(Math.max(0, start - 2), start).reverse()
    const tail = items[items.length - 1]
    const nearEnd = reachedPrefetchPoint(items[end], tail)
    const prefetchState = prefetch.current
    requests.prioritize([...nearby, ...ahead, ...behind].map(page => page.url).filter(Boolean),
      nearby.map(page => page.url).filter(Boolean))

    if (nearEnd && prefetchState?.forChapter !== tail.chapter.id) {
      const nextChapter = getAdjacent(tail.chapter, 1)
      if (!nextChapter) return
      const waiting = { forChapter: tail.chapter.id }
      prefetch.current = waiting

      const preload = async (attempt: number) => {
        try {
          const data = await requests.chapter(nextChapter)
          if (!mounted.current || prefetch.current !== waiting) return
          queueChapterImages(data.images)
        } catch (error) {
          if (!mounted.current || prefetch.current !== waiting || attempt > 0 || !isTransientRequestError(error)) return
          prefetchTimer.current = setTimeout(() => {
            const ids = visible.current.length ? visible.current : target.current ? [target.current] : []
            if (prefetch.current === waiting && ids.some(id => {
              const index = pageIndex().get(id)
              return index !== undefined && reachedPrefetchPoint(pages.value[index], tail)
            })) void preload(1)
            else if (prefetch.current === waiting) prefetch.current = null
          }, 700)
        }
      }
      void preload(0)
    }
  }

  function confirmPage(id: string | null) {
    if (!id || !visible.current.includes(id) || activePage.current?.id === id) return
    const index = pageIndex().get(id)
    if (index === undefined) return
    const page = pages.value[index]
    activePage.current = page
    if (selected.value.id !== page.chapter.id) selected.setValue(page.chapter)
    recordVisiblePage(page)
  }

  function reportVisible(ids: string[]) {
    if (!mounted.current) return
    const changed = ids.length !== visible.current.length || ids.some(id => !visible.current.includes(id))
    visible.current = ids
    if (changed) {
      for (const id of ids) {
        const update = deferredRows.current.get(id)
        deferredRows.current.delete(id)
        update?.()
      }
      prioritize(ids)
    }
    const restore = target.current
    if (restore && !ids.includes(restore)) return
    target.current = null
    if (restore) confirmPage(restore)
    else if (!activePage.current || !ids.includes(activePage.current.id)) {
      const positions = pageIndex()
      const first = ids.reduce<string | null>((best, id) =>
        (positions.get(id) ?? Infinity) < (best ? positions.get(best) ?? Infinity : Infinity) ? id : best, null)
      confirmPage(first)
    }
  }

  function recordVisiblePage(page: ReaderPage) {
    if (!cache.images.has(page.url)) return
    if (last.current?.chapter.id === page.chapter.id && last.current.page === page.number) return
    last.current = { book, chapter: page.chapter, page: page.number, pageCount: page.count, readAt: Date.now() }
    if (!moving.current) scheduleSave()
  }

  function scheduleSave() {
    clearTimeout(saveTimer.current)
    if (last.current) saveTimer.current = setTimeout(save, 850)
  }

  function updateRow(id: string, update: () => void) {
    if (moving.current && !visible.current.includes(id)) {
      deferredRows.current.set(id, update)
    } else {
      deferredRows.current.delete(id)
      update()
    }
  }

  function setScrollMoving(next: boolean) {
    if (moving.current === next) return
    moving.current = next
    if (next) {
      clearTimeout(saveTimer.current)
    } else {
      for (const update of deferredRows.current.values()) update()
      deferredRows.current.clear()
      scheduleSave()
    }
  }

  function hideControlsLater() {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => controls.setValue(false), 4500)
  }

  function showControls() {
    controls.setValue(!controls.value)
    if (imageTimings.value !== null) imageTimings.setValue(null)
    if (controls.value) hideControlsLater()
    else clearTimeout(hideTimer.current)
  }

  function setChapterError(cause: unknown, kind: "open" | "append") {
    if (!mounted.current) return
    errorKind.current = kind
    error.setValue(cause instanceof Error ? cause.message : String(cause))
  }

  async function openChapter(next: Chapter, resumePage = 1) {
    if (busy.value || !mounted.current) return
    busy.setValue(true)
    error.setValue("")
    retry.current = () => { void openChapter(next, resumePage) }
    try {
      const data = await requests.chapter(next)
      if (!mounted.current) return
      save()
      last.current = null
      visible.current = []
      activePage.current = null
      deferredRows.current.clear()
      moving.current = false
      reachedEnd.current = null
      clearTimeout(prefetchTimer.current)
      prefetch.current = null
      directoryGap.setValue(null)
      directoryError.setValue("")
      const items = makePages(data)
      const start = items[Math.min(items.length, Math.max(1, resumePage)) - 1]
      target.current = start.id
      selected.setValue(data.chapter)
      scrollKey.setValue(scrollKey.value + 1)
      pages.setValue(items)
      queueChapterImages()
      prioritize([start.id])
    } catch (cause) {
      setChapterError(cause, "open")
    } finally {
      if (mounted.current) busy.setValue(false)
    }
  }

  function maybeAppend() {
    if (!mounted.current || target.current) return
    const tail = pages.value[pages.value.length - 1]
    if (!tail || reachedEnd.current !== tail.id || (error.value && errorKind.current === "append")) return
    if (tail.url && !cache.images.has(tail.url) && !requests.failed.has(tail.url)) return
    if (getAdjacent(tail.chapter, 1)) {
      if (directoryGap.value !== null) directoryGap.setValue(null)
      void appendChapter()
    } else {
      const page = getMissingPage(tail.chapter) ?? null
      if (page !== directoryGap.value) directoryGap.setValue(page)
    }
  }

  async function appendChapter() {
    const items = pages.value
    if (busy.value || !mounted.current || !items.length) return
    const next = getAdjacent(items[items.length - 1].chapter, 1)
    if (!next) return
    busy.setValue(true)
    error.setValue("")
    retry.current = () => { void appendChapter() }
    try {
      const data = await requests.chapter(next)
      if (!mounted.current) return
      reachedEnd.current = null
      pages.setValue([...items, ...makePages(data)])
      queueChapterImages()
      prioritize(visible.current)
    } catch (cause) {
      setChapterError(cause, "append")
    } finally {
      if (mounted.current) busy.setValue(false)
    }
  }

  async function retryDirectory() {
    const page = directoryGap.value
    if (page === null || directoryRequest.current) return
    const controller = new AbortController()
    directoryRequest.current = controller
    directoryError.setValue("")
    try {
      await reloadDirectoryPage(page, controller.signal)
      if (!controller.signal.aborted) maybeAppend()
    } catch {
      if (!controller.signal.aborted) directoryError.setValue("下一话目录加载失败。")
    } finally {
      if (directoryRequest.current === controller) directoryRequest.current = null
    }
  }

  function stopRequests() {
    clearTimeout(prefetchTimer.current)
    directoryRequest.current?.abort()
    requests.close()
  }

  function choose(next: Chapter) {
    if (next.id !== selected.value.id) {
      controls.setValue(false)
      void openChapter(next)
    }
  }

  function imageTimingText() {
    const items = pages.value
    const currentID = target.current ?? activePage.current?.id ?? visible.current[0]
    const index = currentID ? pageIndex().get(currentID) ?? 0 : 0
    const now = Date.now()
    const first = Math.max(0, index - 1)
    const lines = items.slice(first, index + 3).map((page, offset) => {
      const timing = requests.imageTiming(page.url)
      const label = `${chapterLabel(page.chapter)} · 第 ${page.number} 张`
      const isCurrent = first + offset === index
      const detail = timing ? describeImageTiming(timing, now)
        : cache.images.has(page.url) ? "来自内存缓存" : page.url ? "尚未入队" : "图片地址无效"
      return `${isCurrent ? "当前 · " : ""}${label}\n${detail}`
    })
    return lines.join("\n\n") || "本章还没有图片加载记录。"
  }

  function toggleImageTimings() {
    if (imageTimings.value !== null) {
      imageTimings.setValue(null)
      hideControlsLater()
    } else {
      clearTimeout(hideTimer.current)
      imageTimings.setValue(imageTimingText())
    }
  }

  async function showDirectory() {
    if (directoryOpen.current) return
    directoryOpen.current = true
    clearTimeout(hideTimer.current)
    controls.setValue(false)
    let choice: Chapter | undefined
    try {
      await Navigation.present({ element: <ReaderDirectory bookID={book.bookID} directoryCache={directoryCache} chapterID={selected.value.id} select={item => { choice = item }} /> })
      if (choice && mounted.current) choose(choice)
    } catch {
      if (mounted.current) {
        warning.setValue("无法打开目录。")
        showControls()
      }
    } finally {
      directoryOpen.current = false
    }
  }

  useEffect(() => {
    mounted.current = true
    requests.changed = url => {
      const page = activePage.current
      if (page?.url === url && visible.current.includes(page.id)) recordVisiblePage(page)
      if (pages.value[pages.value.length - 1]?.url === url) maybeAppend()
      if (controls.value && imageTimings.value !== null) imageTimings.setValue(imageTimingText())
    }
    if (initialTarget) {
      queueChapterImages()
      prioritize([initialTarget.id])
    } else retry.current = () => { void openChapter(chapter, initialPage) }
    return () => {
      mounted.current = false
      clearTimeout(hideTimer.current)
      save()
      stopRequests()
      deferredRows.current.clear()
    }
  }, [])

  const items = pages.value
  const chapterScrollKey = scrollKey.value
  const tail = items[items.length - 1]
  const endMarker = tail ? `chapter-end:${tail.id}` : null
  const previous = controls.value ? getAdjacent(selected.value, -1) : undefined
  const next = controls.value ? getAdjacent(selected.value, 1) : undefined

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black"
      statusBarHidden persistentSystemOverlays="hidden">
      <Rectangle fill="black" ignoresSafeArea={{ regions: "container", edges: "all" }} />
      {items.length ? (
        <GeometryReader ignoresSafeArea={{ regions: "container", edges: "all" }}>
          {geometry => (
            <ScrollViewReader>
              {proxy => (
                <ScrollView
                  key={chapterScrollKey}
                  background="black"
                  scrollBounceBehavior="always"
                  onAppear={() => {
                    const id = target.current
                    if (!id || scrollKey.value !== chapterScrollKey || restoredScrollKey.current === chapterScrollKey) return
                    restoredScrollKey.current = chapterScrollKey
                    if (id !== items[0]?.id) proxy.scrollTo(id, "top")
                  }}
                  ignoresSafeArea={{ regions: "container", edges: "all" }}
                  onScrollTargetVisibilityChange={{
                    idType: "string", threshold: 0,
                    onChanged: ids => {
                      if (!tail || pages.value[pages.value.length - 1]?.id !== tail.id) return
                      const pageIDs = ids.filter((id): id is string => typeof id === "string" && id !== endMarker)
                      reportVisible(pageIDs)
                      if (target.current) return
                      reachedEnd.current = endMarker !== null && ids.includes(endMarker) ? tail.id : null
                      maybeAppend()
                    },
                  }}
                  onScrollPhaseChange={(previous, nextPhase, { geometry }) => {
                    setScrollMoving(nextPhase === "tracking" || nextPhase === "interacting" || nextPhase === "decelerating")
                    if (nextPhase === "interacting" && target.current) {
                      target.current = null
                      reportVisible(visible.current)
                    }
                    if (previous !== "interacting" && previous !== "decelerating") return
                    if (!tail || target.current || pages.value[pages.value.length - 1]?.id !== tail.id || !visible.current.includes(tail.id)) return
                    const bottom = Math.max(-geometry.contentInsets.top,
                      geometry.contentSize.height - geometry.containerSize.height + geometry.contentInsets.bottom)
                    if (geometry.contentOffset.y < bottom - 2) return
                    reachedEnd.current = tail.id
                    maybeAppend()
                  }}
                >
                  <LazyVStack spacing={0} scrollTargetLayout>
                    {items.map((page, index) => (
                      <VStack key={page.id} spacing={0}>
                        <ReaderImageRow page={page} cache={cache} requests={requests} width={geometry.size.width}
                          placeholderHeight={geometry.size.height} previousURL={items[index - 1]?.url}
                          nextURL={items[index + 1]?.url} showControls={showControls} updateRow={updateRow} />
                      </VStack>
                    ))}
                    {endMarker !== null ? <Rectangle key={endMarker} fill="black" frame={{ height: 1 }} accessibilityHidden /> : null}
                  </LazyVStack>
                </ScrollView>
              )}
            </ScrollViewReader>
          )}
        </GeometryReader>
      ) : !error.value ? (
        <VStack alignment="leading" padding={16}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}>
          <Button title="返回" systemImage="chevron.left" tint="white" action={close} />
          <Spacer />
        </VStack>
      ) : null}
      {error.value ? (
        <VStack spacing={8} padding={14} background="secondarySystemBackground">
          <Text>{error.value}</Text>
          <Button title="重试章节" action={() => retry.current?.()} />
          {!items.length ? <Button title="返回" action={close} /> :
            <Button title="关闭提示" action={() => { error.setValue(""); maybeAppend() }} />}
        </VStack>
      ) : directoryGap.value !== null ? (
        <VStack spacing={8} padding={14} background="secondarySystemBackground">
          <Text>{directoryError.value || "下一话目录尚未加载。"}</Text>
          <Button title="加载下一话目录" action={retryDirectory} />
        </VStack>
      ) : null}
      {controls.value ? (
        <VStack spacing={0} padding={16} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <HStack spacing={12} padding={{ horizontal: 12, vertical: 4 }}
            background={{ style: "rgba(25,25,25,0.94)", shape: { type: "rect", cornerRadius: 18 } }}>
            <Button title="返回" systemImage="chevron.left" font="subheadline" action={close} />
            <Text font="subheadline" foregroundStyle="white" lineLimit={2}>{selected.value.title || chapterLabel(selected.value)}</Text>
            <Spacer />
            <Button title={imageTimings.value === null ? "测速" : "关闭"} systemImage="timer"
              accessibilityLabel={imageTimings.value === null ? "图片加载诊断" : "关闭图片加载诊断"}
              font="subheadline" tint="white" frame={{ minHeight: 36 }} contentShape="rect"
              action={toggleImageTimings} />
          </HStack>
          {imageTimings.value !== null ? (
            <Text font="footnote" foregroundStyle="white" multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }} padding={12}
              background={{ style: "rgba(25,25,25,0.94)", shape: { type: "rect", cornerRadius: 18 } }}
            >{imageTimings.value}</Text>
          ) : null}
          <Spacer />
          <HStack spacing={16} padding={12} background={{ style: "rgba(25,25,25,0.94)", shape: { type: "rect", cornerRadius: 18 } }}>
            <Button title="上一章" disabled={!previous || busy.value} action={() => { if (previous) choose(previous) }} />
            <Spacer />
            <Button title="目录" disabled={busy.value} action={async () => { await showDirectory() }} />
            <Spacer />
            <Button title="下一章" disabled={!next || busy.value} action={() => { if (next) choose(next) }} />
          </HStack>
          {warning.value ? <Text font="caption" foregroundStyle="white">{warning.value}</Text> : null}
        </VStack>
      ) : null}
    </ZStack>
  )
}
