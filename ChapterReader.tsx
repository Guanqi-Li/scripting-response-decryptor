import {
  Button, Dialog, GeometryReader, HStack, Image, LazyVStack, Navigation, NavigationStack,
  ProgressView, Rectangle, ScrollView, Spacer, Text, VStack, ZStack, useEffect, useObservable, useRef,
} from "scripting"
import { setReaderToken, type Chapter, type Comic, type ReaderChapter } from "./catalog"
import { ChapterDirectoryRows } from "./ChapterDirectoryView"
import { ApiError, isTransientRequestError } from "./request"
import { ReaderRequests, type ReaderCache } from "./reader-cache"
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

function ReaderImageRow({ page, cache, requests, width, placeholderHeight, previousURL, nextURL, showControls }: {
  page: ReaderPage
  cache: ReaderCache
  requests: ReaderRequests
  width: number
  placeholderHeight: number
  previousURL?: string
  nextURL?: string
  showControls: () => void
}) {
  const update = useObservable(0)
  useEffect(() => {
    const invalidate = () => update.setValue(update.value + 1)
    const stop = requests.observe(page.url, invalidate)
    invalidate()
    return stop
  }, [page.url, requests])

  void update.value
  const loaded = cache.images.get(page.url)
  const measured = cache.ratios.get(page.url)
  const expected = useRef((previousURL && cache.ratios.get(previousURL)) || (nextURL && cache.ratios.get(nextURL)))
  const ratio = measured || expected.current
  const height = ratio ? width * ratio : placeholderHeight
  return (
    <ZStack frame={{ width, height }} contentShape="rect" onTapGesture={loaded ? undefined : showControls}>
      {loaded ? (
        <Image image={loaded.image} resizable frame={{ width, height }}
          contentShape="rect" onTapGesture={showControls} />
      ) : requests.failed.has(page.url)
        ? <Button title={`重试第 ${page.number} 张`} action={() => requests.retry(page.url)} />
        : !page.url ? <Text foregroundStyle="white">第 {page.number} 张图片地址无效</Text>
        : <ProgressView tint="white" />}
    </ZStack>
  )
}

function ReaderDirectory({ chapters, chapterID, select }: {
  chapters: Chapter[]
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
          <ChapterDirectoryRows chapters={chapters} selectedChapterID={chapterID} openChapter={chapter => { select(chapter); dismiss() }} />
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

export type ReaderOpening = { data: ReaderChapter } | { error: unknown }

export function ChapterReader({ book, chapter, initialPage, opening, cache, getChapters, getAdjacent,
  getMissingPage, reloadDirectoryPage }: {
  book: Comic
  chapter: Chapter
  initialPage: number
  opening: ReaderOpening
  cache: ReaderCache
  getChapters: () => Chapter[]
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
  const position = useObservable<string | null>(initialTarget?.id ?? null)
  const controls = useObservable(false)
  const busy = useObservable(false)
  const error = useObservable("error" in opening
    ? openingError instanceof Error ? openingError.message : String(openingError)
    : "")
  const needsToken = useObservable(openingError instanceof ApiError && (openingError.code === 401 || openingError.status === 401))
  const errorKind = useRef<"open" | "append">("open")
  const directoryGap = useObservable<number | null>(null)
  const directoryError = useObservable("")
  const directoryRequest = useRef<AbortController | null>(null)
  const tokenPromptOpen = useRef(false)
  const warning = useObservable("")
  const mounted = useRef(true)
  const scrollKey = useObservable(0)
  const visible = useRef<string[]>([])
  const reachedEnd = useRef<string | null>(null)
  const activePage = useRef<ReaderPage | null>(null)
  const indexed = useRef<{ items: ReaderPage[]; byID: Map<string, number> } | null>(null)
  const target = useRef<string | null>(initialTarget?.id ?? null)
  const last = useRef<ReadingRecord | null>(null)
  const lastSaved = useRef("")
  const prefetch = useRef<{ forChapter: number; data?: ReaderChapter } | null>(null)
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
    const nearEnd = items.length - 1 - end <= 5
    const prefetchState = prefetch.current
    const nextImages = nearEnd && prefetchState?.forChapter === tail.chapter.id
      ? prefetchState.data?.images.slice(0, 3) ?? [] : []
    requests.prioritize([...nearby, ...ahead, ...behind].map(page => page.url).concat(nextImages).filter(Boolean),
      nearby.map(page => page.url).filter(Boolean))

    if (nearEnd && prefetchState?.forChapter !== tail.chapter.id) {
      const nextChapter = getAdjacent(tail.chapter, 1)
      if (!nextChapter) return
      const waiting: { forChapter: number; data?: ReaderChapter } = { forChapter: tail.chapter.id }
      prefetch.current = waiting

      const preload = async (attempt: number) => {
        try {
          const data = await requests.chapter(nextChapter)
          if (!mounted.current || prefetch.current !== waiting) return
          waiting.data = data
          prioritize(visible.current.length ? visible.current : target.current ? [target.current] : [])
        } catch (error) {
          if (!mounted.current || prefetch.current !== waiting || attempt > 0 || !isTransientRequestError(error)) return
          prefetchTimer.current = setTimeout(() => {
            const tailIndex = pageIndex().get(tail.id)
            if (prefetch.current === waiting && tailIndex !== undefined &&
              visible.current.some(id => (pageIndex().get(id) ?? -1) >= tailIndex - 5)) void preload(1)
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
    if (changed) prioritize(ids)
    const restore = target.current
    if (restore && !ids.includes(restore)) return
    target.current = null
    const current = position.value
    if (restore || (current && ids.includes(current))) confirmPage(restore ?? current)
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
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 850)
  }

  function onPositionChanged(id: string | null) {
    if (mounted.current && !target.current) confirmPage(id)
  }

  function showControls() {
    controls.setValue(!controls.value)
    clearTimeout(hideTimer.current)
    if (controls.value) hideTimer.current = setTimeout(() => controls.setValue(false), 4500)
  }

  function setChapterError(cause: unknown, kind: "open" | "append") {
    if (!mounted.current) return
    errorKind.current = kind
    needsToken.setValue(cause instanceof ApiError && (cause.code === 401 || cause.status === 401))
    error.setValue(cause instanceof Error ? cause.message : String(cause))
  }

  async function enterReadingToken() {
    if (tokenPromptOpen.current) return
    tokenPromptOpen.current = true
    try {
      const value = await Dialog.prompt({
        title: "设置阅读 token",
        message: "请输入你自己账号的有效 token。本次运行有效。",
        placeholder: "token",
        obscureText: true,
        confirmLabel: "重试章节",
      })
      const token = value?.trim()
      if (!mounted.current || !token) return
      if (/[\r\n]/.test(token)) {
        await Dialog.alert({ title: "token 格式不正确", message: "请只输入一行 token。" })
        return
      }
      setReaderToken(token)
      retry.current?.()
    } catch {
      if (mounted.current) error.setValue("无法打开 token 输入框，请重试。")
    } finally {
      tokenPromptOpen.current = false
    }
  }

  async function openChapter(next: Chapter, resumePage = 1) {
    if (busy.value || !mounted.current) return
    busy.setValue(true)
    error.setValue("")
    needsToken.setValue(false)
    retry.current = () => { void openChapter(next, resumePage) }
    try {
      const data = await requests.chapter(next)
      if (!mounted.current) return
      save()
      last.current = null
      visible.current = []
      activePage.current = null
      reachedEnd.current = null
      clearTimeout(prefetchTimer.current)
      prefetch.current = null
      directoryGap.setValue(null)
      directoryError.setValue("")
      const items = makePages(data)
      const start = items[Math.min(items.length, Math.max(1, resumePage)) - 1]
      target.current = start.id
      selected.setValue(data.chapter)
      position.setValue(start.id)
      scrollKey.setValue(scrollKey.value + 1)
      pages.setValue(items)
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
    needsToken.setValue(false)
    retry.current = () => { void appendChapter() }
    try {
      const data = await requests.chapter(next)
      if (!mounted.current) return
      reachedEnd.current = null
      pages.setValue([...items, ...makePages(data)])
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

  async function showDirectory() {
    if (directoryOpen.current) return
    directoryOpen.current = true
    clearTimeout(hideTimer.current)
    controls.setValue(false)
    let choice: Chapter | undefined
    try {
      await Navigation.present({ element: <ReaderDirectory chapters={getChapters()} chapterID={selected.value.id} select={item => { choice = item }} /> })
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
    }
    position.subscribe(onPositionChanged)
    if (initialTarget) prioritize([initialTarget.id])
    else retry.current = () => { void openChapter(chapter, initialPage) }
    return () => {
      position.unsubscribe(onPositionChanged)
      mounted.current = false
      clearTimeout(hideTimer.current)
      save()
      stopRequests()
    }
  }, [])

  const items = pages.value
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
            <ScrollView
              key={scrollKey.value}
              background="black"
              scrollBounceBehavior="always"
              scrollPosition={{ value: position, anchor: "top" }}
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
                      nextURL={items[index + 1]?.url} showControls={showControls} />
                  </VStack>
                ))}
                {endMarker !== null ? <Rectangle key={endMarker} fill="black" frame={{ height: 1 }} accessibilityHidden /> : null}
              </LazyVStack>
            </ScrollView>
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
          {needsToken.value ? <Button title="设置阅读 token" action={enterReadingToken} />
            : <Button title="重试章节" action={() => retry.current?.()} />}
          {!items.length ? <Button title="返回" action={close} /> :
            <Button title="关闭提示" action={() => { error.setValue(""); needsToken.setValue(false); maybeAppend() }} />}
        </VStack>
      ) : directoryGap.value !== null ? (
        <VStack spacing={8} padding={14} background="secondarySystemBackground">
          <Text>{directoryError.value || "下一话目录尚未加载。"}</Text>
          <Button title="加载下一话目录" action={retryDirectory} />
        </VStack>
      ) : null}
      {controls.value ? (
        <VStack spacing={0} padding={16} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <HStack spacing={12} padding={12} background={{ style: "rgba(25,25,25,0.94)", shape: { type: "rect", cornerRadius: 18 } }}>
            <Button title="返回" systemImage="chevron.left" font="subheadline" action={close} />
            <Text font="subheadline" foregroundStyle="white" lineLimit={2}>{selected.value.title || chapterLabel(selected.value)}</Text>
            <Spacer />
          </HStack>
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
