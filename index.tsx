import {
  Button, Dialog, HStack, Image, Navigation, NavigationStack, Rectangle, RoundedRectangle,
  Script, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState,
} from "scripting"
import { ComicGrid, CoverCache, type CatalogEntry } from "./ComicGrid"
import { ComicDetailView } from "./ComicDetailView"
import { ReadingHistoryView } from "./ReadingHistoryView"
import { MainNavigation, type MainTab } from "./MainNavigation"
import { ProfileView } from "./ProfileView"
import { getReadingHistory, type ReadingRecord } from "./reading-history"
import { ReaderCache } from "./reader-cache"
import type { ChapterDirectoryCache } from "./ChapterDirectoryView"
import {
  appendCatalog, clearLegacyCatalogCache, fetchCatalog, fetchCategories,
  type Category, type Comic,
} from "./catalog"

function MainView() {
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [selectedCategoryID, setSelectedCategoryID] = useState<number | null>(null)
  const [categoryError, setCategoryError] = useState("")
  const [selectedBook, setSelectedBook] = useState<Comic | null>(null)
  const [activeTab, setActiveTab] = useState<MainTab>("home")
  const closeNavigation = useRef<(() => void) | null>(null)
  const [history, setHistory] = useState<ReadingRecord[]>([])
  const [historyError, setHistoryError] = useState("")
  const categoryPositions = useRef(new Map<number, string>())
  const readerCacheRef = useRef<ReaderCache | null>(null)
  const readerCache = readerCacheRef.current ?? (readerCacheRef.current = new ReaderCache())
  const details = useRef(new Map<number, Comic>())
  const directories = useRef<ChapterDirectoryCache>(new Map())
  const [entries, setEntries] = useState<Record<number, CatalogEntry>>({})
  const current = useRef(entries)
  const categoryRequest = useRef<AbortController | null>(null)
  const pageRequests = useRef(new Map<number, AbortController>())
  const coverCache = useRef<CoverCache | null>(null)
  const covers = coverCache.current ?? (coverCache.current = new CoverCache())

  useEffect(() => {
    clearLegacyCatalogCache()
    refreshHistory()
    void loadCategories()
    return cancelRequests
  }, [])

  function refreshHistory() {
    try {
      setHistory(getReadingHistory())
      setHistoryError("")
    } catch {
      setHistoryError("无法读取观看历史。")
    }
  }

  function cancelRequests() {
    categoryRequest.current?.abort()
    categoryRequest.current = null
    for (const controller of pageRequests.current.values()) controller.abort()
    pageRequests.current.clear()
    covers.clear()
  }

  async function loadCategories() {
    if (categoryRequest.current) return
    const controller = new AbortController()
    categoryRequest.current = controller
    setCategoryError("")
    try {
      const loaded = await fetchCategories(controller.signal)
      if (controller.signal.aborted) return
      setCategories(loaded)
      const first = loaded[0]
      if (first) selectCategory(first.id)
    } catch (error) {
      if (!controller.signal.aborted) setCategoryError(errorMessage(error))
    } finally {
      if (categoryRequest.current === controller) categoryRequest.current = null
    }
  }

  function updateCatalog(id: number, entry: CatalogEntry) {
    current.current = { ...current.current, [id]: entry }
    setEntries(current.current)
  }

  function selectCategory(id: number) {
    setSelectedCategoryID(id)
    if (!current.current[id]) void loadPage(id)
  }

  async function loadPage(id: number) {
    if (pageRequests.current.has(id)) return
    const data = current.current[id]?.data
    if (data && data.page >= data.totalPage) return

    const controller = new AbortController()
    pageRequests.current.set(id, controller)
    updateCatalog(id, { data, loading: true })
    try {
      const next = await fetchCatalog(id, (data?.page ?? 0) + 1, controller.signal)
      if (controller.signal.aborted) return
      const combined = appendCatalog(data, next)
      updateCatalog(id, { data: combined })
    } catch (error) {
      if (!controller.signal.aborted) updateCatalog(id, { data, error: errorMessage(error) })
    } finally {
      if (pageRequests.current.get(id) === controller) pageRequests.current.delete(id)
    }
  }

  function selectTab(tab: MainTab) {
    if (tab === "history") refreshHistory()
    setActiveTab(tab)
  }

  function dismissNavigation() {
    closeNavigation.current?.()
  }

  function openBook(book: Comic) {
    dismissNavigation()
    setSelectedBook(book)
  }

  function exit() {
    cancelRequests()
    Script.exit()
  }

  const isHome = activeTab === "home"
  const title = isHome ? "爱漫画" : activeTab === "history" ? "观看历史" : "我的"

  return <NavigationStack>
    <VStack
      padding={{ top: 16 }}
      spacing={0}
      navigationTitle={title}
      overlay={selectedBook === null ? {
        alignment: "bottomTrailing",
        content: <MainNavigation
          activeTab={activeTab}
          closeAction={closeNavigation}
          select={selectTab}
        />,
      } : undefined}
      navigationBarTitleDisplayMode="inline"
      navigationDestination={{
        isPresented: selectedBook !== null,
        onChanged: presented => { if (!presented) setSelectedBook(null) },
        content: selectedBook ? (
          <ComicDetailView
            key={selectedBook.bookID}
            book={selectedBook}
            covers={covers}
            cache={details.current}
            directories={directories.current}
            readerCache={readerCache}
            progress={history.find(entry => entry.book.bookID === selectedBook.bookID)}
            refreshHistory={refreshHistory}
          />
        ) : <VStack />,
      }}
      toolbar={{
        topBarLeading: <Button accessibilityLabel="退出" action={exit}>
          <Image systemName="xmark" />
        </Button>,
        topBarTrailing: Script.supportsMinimization() ? (
          <Button accessibilityLabel="最小化" action={async () => {
            dismissNavigation()
            await Script.minimize()
          }}>
            <Image systemName="minus" />
          </Button>
        ) : undefined,
      }}
    >
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
        background={<Rectangle
          fill="clear"
          contentShape="rect"
          onTapGesture={dismissNavigation}
          accessibilityHidden
        />}
      >
        <VStack spacing={0} opacity={isHome ? 1 : 0} allowsHitTesting={isHome} accessibilityHidden={!isHome}>
          {categories?.length ? <ScrollView
            axes="horizontal"
            contentShape="rect"
            simultaneousGesture={typeof TapGesture === "function" ? TapGesture().onEnded(dismissNavigation) : undefined}
            scrollIndicator="hidden"
            fixedSize={{ horizontal: false, vertical: true }}
            onScrollPhaseChange={(_, phase) => { if (phase === "tracking" || phase === "interacting") dismissNavigation() }}
          >
            <HStack spacing={28} padding={{ horizontal: 16 }}>
              {categories.map(category => {
                const selected = category.id === selectedCategoryID
                return (
                  <Button
                    key={category.id}
                    buttonStyle="plain"
                    accessibilityAddTraits={selected ? "isSelected" : undefined}
                    action={() => { dismissNavigation(); selectCategory(category.id) }}
                  >
                    <VStack
                      frame={{ minHeight: 44 }}
                      overlay={selected ? {
                        alignment: "bottom",
                        content: <RoundedRectangle cornerRadius={1.5} fill="label" frame={{ height: 2 }} />,
                      } : undefined}
                    >
                      <Text
                        font="body"
                        fontWeight={selected ? "semibold" : "regular"}
                        lineLimit={1}
                        fixedSize={{ horizontal: true, vertical: false }}
                        padding={{ bottom: 6 }}
                      >
                        {category.name}
                      </Text>
                    </VStack>
                  </Button>
                )
              })}
            </HStack>
          </ScrollView> : categories ? <Text>暂无分类</Text> : null}
          {categoryError ? (
            <VStack spacing={6} padding={{ horizontal: 16, vertical: 8 }}>
              <Text>分类加载失败。{categoryError}</Text>
              <Button title="重新加载分类" action={() => { dismissNavigation(); void loadCategories() }} />
            </VStack>
          ) : null}
          {selectedCategoryID !== null ? (
            <ComicGrid
              key={selectedCategoryID}
              initialPosition={categoryPositions.current.get(selectedCategoryID) ?? null}
              savePosition={id => categoryPositions.current.set(selectedCategoryID, id)}
              entry={entries[selectedCategoryID]}
              covers={covers}
              openBook={openBook}
              onInteraction={dismissNavigation}
              loadPage={() => { void loadPage(selectedCategoryID) }}
            />
          ) : null}
        </VStack>
        {activeTab === "history" ? (
          <ReadingHistoryView records={history} error={historyError} retry={refreshHistory} covers={covers}
            openBook={openBook} onInteraction={dismissNavigation} />
        ) : null}
        {activeTab === "profile" ? <ProfileView onInteraction={dismissNavigation} /> : null}
      </ZStack>
    </VStack>
  </NavigationStack>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main() {
  try {
    await Navigation.present({
      element: <MainView />,
      modalPresentationStyle: "fullScreen",
    })
  } catch (error) {
    await Dialog.alert({ title: "启动失败", message: error instanceof Error ? error.message : String(error) })
  } finally {
    Script.exit()
  }
}
main()
