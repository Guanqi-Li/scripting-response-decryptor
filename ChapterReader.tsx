import {
  Button, Dialog, GeometryReader, HStack, Image, LazyVStack, List, Navigation, NavigationStack,
  ProgressView, Rectangle, ScrollView, Spacer, Text, VStack, ZStack, useEffect, useObservable, useRef,
} from "scripting"
import { setReaderToken, type Chapter, type Comic, type ReaderChapter } from "./catalog"
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

function ReaderDirectory({ chapters, select }: { chapters: Chapter[]; select: (chapter: Chapter) => void }) {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <List navigationTitle="目录" toolbar={{ cancellationAction: <Button title="关闭" action={() => { dismiss() }} /> }}>
        {chapters.map(chapter => (
          <Button key={chapter.id} title={chapter.title} action={() => { select(chapter); dismiss() }} />
        ))}
      </List>
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
  const revision = useObservable(0)
  const mounted = useRef(true)
  const scrollKey = useObservable(0)
  const visible = useRef<string[]>([])
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

  function prioritize(ids: string[]) {
    const items = pages.value
    const start = items.findIndex(page => ids.includes(page.id))
    if (start < 0) return
    const first = items[start]
    const nearby = items.filter(page => ids.includes(page.id))
    const end = Math.max(start, items.indexOf(nearby[nearby.length - 1]))
    const ahead = items.slice(end + 1, end + 6)
    const tail = items[items.length - 1]
    const nextChapter = getAdjacent(tail.chapter, 1)
    const nearEnd = items.length - 1 - end <= 5
    const prefetchState = prefetch.current
    const nextImages = nearEnd && prefetchState?.forChapter === tail.chapter.id
      ? prefetchState.data?.images.slice(0, 3) ?? [] : []
    requests.prioritize([first.url, ...nearby.map(page => page.url), ...ahead.map(page => page.url), ...nextImages])

    if (nearEnd && nextChapter && prefetchState?.forChapter !== tail.chapter.id) {
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
    visible.current = ids
    const first = firstID ? pages.value.find(page => page.id === firstID) : pages.value.find(page => ids.includes(page.id))
    if (!first) return
    if (selected.value.id !== first.chapter.id) selected.setValue(first.chapter)
    prioritize(ids)
    if (!cache.images.has(first.url)) return
    if (last.current?.chapter.id === first.chapter.id && last.current.page === first.number) return
    last.current = { book, chapter: first.chapter, page: first.number, pageCount: first.count, readAt: Date.now() }
    if (saveTimer.current === undefined) saveTimer.current = setTimeout(save, 450)
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
    requests.changed = () => {
      revision.setValue(revision.value + 1)
      if (visible.current.length) reportVisible(visible.current)
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
  void revision.value
  const previous = getAdjacent(selected.value, -1)
  const next = getAdjacent(selected.value, 1)

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
                onChanged: ids => reportVisible(ids.filter((id): id is string => typeof id === "string")),
              }}
              onScrollGeometryChange={{
                of: "geometry",
                onChanged: (previous, current) => {
                  const tail = pages.value[pages.value.length - 1]
                  const bottom = Math.max(-current.contentInsets.top,
                    current.contentSize.height - current.containerSize.height + current.contentInsets.bottom)
                  if (tail && !error.value && visible.current.includes(tail.id) && cache.images.has(tail.url)
                    && current.contentOffset.y > previous.contentOffset.y && current.contentOffset.y >= bottom + 12) {
                    void appendChapter()
                  }
                },
              }}
            >
              <LazyVStack spacing={0} scrollTargetLayout>
                {items.map(page => {
                  const loaded = cache.images.get(page.url)
                  const width = geometry.size.width
                  const ratio = loaded?.ratio ?? cache.ratios.get(page.url)
                  const height = ratio ? width * ratio : geometry.size.height
                  return (
                    <VStack key={page.id} spacing={0}>
                      <ZStack
                        frame={{ width, height }}
                        contentShape="rect"
                        onTapGesture={loaded ? undefined : showControls}
                      >
                        {loaded ? (
                          <Image image={loaded.image} resizable frame={{ width, height }}
                            contentShape="rect" onTapGesture={showControls} />
                        ) : requests.failed.has(page.url)
                          ? <Button title={`重试第 ${page.number} 张`} action={() => requests.retry(page.url)} />
                          : <ProgressView tint="white" />}
                      </ZStack>
                    </VStack>
                  )
                })}
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
            <Button title="返回" systemImage="chevron.left" action={close} />
            <Text font="headline" foregroundStyle="white" lineLimit={2}>{selected.value.title || chapterLabel(selected.value)}</Text>
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
