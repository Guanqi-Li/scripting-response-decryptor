import {
  Button, Dialog, GeometryReader, HStack, Image, LazyVStack, Navigation, NavigationStack,
  ProgressView, Rectangle, ScrollView, Spacer, Text, VStack, ZStack, useEffect, useObservable, useRef,
} from "scripting"
import { setReaderToken, type Chapter, type Comic, type ReaderChapter } from "./catalog"
import { ChapterDirectoryRows } from "./ChapterDirectoryView"
import { ApiError } from "./request"
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

function ReaderImageRow({ page, cache, requests, width, placeholderHeight, showControls }: {
  page: ReaderPage
  cache: ReaderCache
  requests: ReaderRequests
  width: number
  placeholderHeight: number
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
  const ratio = cache.ratios.get(page.url)
  const height = ratio ? width * ratio : placeholderHeight
  return (
    <ZStack frame={{ width, height }} contentShape="rect" onTapGesture={loaded ? undefined : showControls}>
      {loaded ? (
        <Image image={loaded.image} resizable frame={{ width, height }}
          contentShape="rect" onTapGesture={showControls} />
      ) : requests.failed.has(page.url)
        ? <Button title={`重试第 ${page.number} 张`} action={() => requests.retry(page.url)} />
        : <ProgressView tint="white" />}
    </ZStack>
  )
}

function ReaderDirectory({ chapters, select }: { chapters: Chapter[]; select: (chapter: Chapter) => void }) {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="章节目录"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="关闭" action={() => { dismiss() }} /> }}
      >
        <VStack padding={16}>
          <ChapterDirectoryRows chapters={chapters} openChapter={chapter => { select(chapter); dismiss() }} />
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

export type ReaderOpening = { data: ReaderChapter } | { error: unknown }

export function ChapterReader({ book, chapter, initialPage, opening, cache, getChapters, getAdjacent }: {
  book: Comic
  chapter: Chapter
  initialPage: number
  opening: ReaderOpening
  cache: ReaderCache
  getChapters: () => Chapter[]
  getAdjacent: (chapter: Chapter, direction: -1 | 1) => Chapter | undefined
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
      if (mounted.current) warning.setValue("")
    } catch {
      if (mounted.current) warning.setValue("阅读进度保存失败。")
    }
  }

  function close() {
    if (!mounted.current) return
    mounted.current = false
    clearTimeout(hideTimer.current)
    save()
    requests.close()
    dismiss()
  }

  function visibleIndexes(ids: string[]) {
    const items = pages.value
    if (indexed.current?.items !== items) {
      indexed.current = { items, byID: new Map(items.map((page, index) => [page.id, index])) }
    }
    const byID = indexed.current.byID
    return ids.map(id => byID.get(id)).filter((index): index is number => index !== undefined).sort((a, b) => a - b)
  }

  function prioritize(ids: string[]) {
    const items = pages.value
    const indexes = visibleIndexes(ids)
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
    requests.prioritize([...nearby, ...ahead, ...behind].map(page => page.url).concat(nextImages))

    if (nearEnd && prefetchState?.forChapter !== tail.chapter.id) {
      const nextChapter = getAdjacent(tail.chapter, 1)
      if (!nextChapter) return
      const waiting: { forChapter: number; data?: ReaderChapter } = { forChapter: tail.chapter.id }
      prefetch.current = waiting
      void requests.chapter(nextChapter).then(data => {
        if (!mounted.current || prefetch.current !== waiting) return
        waiting.data = data
        prioritize(visible.current.length ? visible.current : target.current ? [target.current] : [])
      }).catch(() => {})
    }
  }

  function reportVisible(ids: string[]) {
    if (!mounted.current) return
    if (target.current && !ids.includes(target.current)) return
    const positionID = position.value
    const firstID = target.current ?? (positionID && ids.includes(positionID) ? positionID : null)
    target.current = null
    const changed = ids.length !== visible.current.length || ids.some(id => !visible.current.includes(id))
    visible.current = ids
    if (changed) prioritize(ids)
    const index = visibleIndexes(firstID ? [firstID] : ids)[0]
    const page = pages.value[index]
    activePage.current = page ?? null
    if (!page) return
    if (selected.value.id !== page.chapter.id) selected.setValue(page.chapter)
    recordVisiblePage(page)
  }

  function recordVisiblePage(page: ReaderPage) {
    if (!cache.images.has(page.url)) return
    if (last.current?.chapter.id === page.chapter.id && last.current.page === page.number) return
    last.current = { book, chapter: page.chapter, page: page.number, pageCount: page.count, readAt: Date.now() }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 850)
  }

  function onPositionChanged(id: string | null) {
    if (id && visible.current.includes(id)) reportVisible(visible.current)
  }

  function showControls() {
    controls.setValue(!controls.value)
    clearTimeout(hideTimer.current)
    if (controls.value) hideTimer.current = setTimeout(() => controls.setValue(false), 4500)
  }

  function setChapterError(cause: unknown) {
    if (!mounted.current) return
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
      prefetch.current = null
      const items = makePages(data)
      const start = items[Math.min(items.length, Math.max(1, resumePage)) - 1]
      target.current = start.id
      selected.setValue(data.chapter)
      position.setValue(start.id)
      scrollKey.setValue(scrollKey.value + 1)
      pages.setValue(items)
      prioritize([start.id])
    } catch (cause) {
      setChapterError(cause)
    } finally {
      if (mounted.current) busy.setValue(false)
    }
  }

  function maybeAppend() {
    const tail = pages.value[pages.value.length - 1]
    if (tail && reachedEnd.current === tail.id && !error.value && cache.images.has(tail.url)) {
      void appendChapter()
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
      setChapterError(cause)
    } finally {
      if (mounted.current) busy.setValue(false)
    }
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
      await Navigation.present({ element: <ReaderDirectory chapters={getChapters()} select={item => { choice = item }} /> })
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
      requests.close()
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
              onScrollPhaseChange={(previous, _next, { geometry }) => {
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
                {items.map(page => (
                  <VStack key={page.id} spacing={0}>
                    <ReaderImageRow page={page} cache={cache} requests={requests} width={geometry.size.width}
                      placeholderHeight={geometry.size.height} showControls={showControls} />
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
          {!items.length ? <Button title="返回" action={close} /> : null}
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
