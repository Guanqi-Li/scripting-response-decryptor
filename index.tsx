import {
  Button, Dialog, HStack, Image, Navigation, NavigationStack, RoundedRectangle,
  Script, ScrollView, Text, VStack, ZStack, useEffect, useRef, useState,
} from "scripting"
import { ComicGrid, CoverCache, type CatalogEntry } from "./ComicGrid"
import { ComicDetailView } from "./ComicDetailView"
import { ReadingHistoryView } from "./ReadingHistoryView"
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
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<ReadingRecord[]>([])
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
    setHistory(getReadingHistory())
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

  function exit() {
    cancelRequests()
    Script.exit()
  }

  return <NavigationStack>
    <VStack
      padding={{ top: 16 }}
      spacing={0}
      navigationTitle={showHistory ? "观看历史" : "GET 响应解密"}
      overlay={selectedBook === null ? {
        alignment: "bottomTrailing",
        content: (
          <Button
            buttonStyle="glass"
            buttonBorderShape="circle"
            padding={{ trailing: 16, bottom: 12 }}
            accessibilityLabel={showHistory ? "回到首页" : "观看历史"}
            action={() => { if (!showHistory) refreshHistory(); setShowHistory(!showHistory) }}
          >
            <Image systemName={showHistory ? "house" : "clock.arrow.circlepath"} font="title3"
              frame={{ width: 36, height: 36 }} />
          </Button>
        ),
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
          <Button accessibilityLabel="最小化" action={async () => { await Script.minimize() }}>
            <Image systemName="minus" />
          </Button>
        ) : undefined,
      }}
    >
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
        <VStack spacing={0} opacity={showHistory ? 0 : 1} disabled={showHistory} accessibilityHidden={showHistory}>
          {categories?.length ? <ScrollView axes="horizontal" scrollIndicator="hidden" fixedSize={{ horizontal: false, vertical: true }}>
            <HStack spacing={28} padding={{ horizontal: 16 }}>
              {categories.map(category => {
                const selected = category.id === selectedCategoryID
                return (
                  <Button
                    key={category.id}
                    buttonStyle="plain"
                    accessibilityAddTraits={selected ? "isSelected" : undefined}
                    action={() => selectCategory(category.id)}
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
              <Button title="重新加载分类" action={loadCategories} />
            </VStack>
          ) : null}
          {selectedCategoryID !== null ? (
            <ComicGrid
              key={selectedCategoryID}
              entry={entries[selectedCategoryID]}
              covers={covers}
              openBook={setSelectedBook}
              loadPage={() => { void loadPage(selectedCategoryID) }}
            />
          ) : null}
        </VStack>
        {showHistory ? <ReadingHistoryView records={history} covers={covers} openBook={setSelectedBook} /> : null}
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
