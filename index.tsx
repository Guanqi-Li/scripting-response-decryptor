import {
  Button, Dialog, HStack, Image, Navigation, NavigationStack, ProgressView,
  RoundedRectangle, Script, ScrollView, Spacer, Text, VStack, useEffect, useRef, useState,
} from "scripting"
import { requestAndDecrypt } from "./request"

const CATEGORIES_URL = "https://www.18akmanhua.com/api/stacksCategories"

type Category = {
  id: number
  name: string
}

function isCategory(value: unknown): value is Category {
  return typeof value === "object" && value !== null
    && "id" in value && typeof value.id === "number" && Number.isSafeInteger(value.id)
    && "name" in value && typeof value.name === "string" && value.name.trim().length > 0
}

function MainView() {
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [selectedCategoryID, setSelectedCategoryID] = useState<number | null>(null)
  const [categoryError, setCategoryError] = useState("")
  const categoryRequest = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void loadCategories()
    return () => {
      mounted.current = false
      categoryRequest.current?.abort()
      categoryRequest.current = null
    }
  }, [])

  async function loadCategories() {
    if (categoryRequest.current) return

    const controller = new AbortController()
    categoryRequest.current = controller
    setCategoryError("")
    try {
      const { value } = await requestAndDecrypt(CATEGORIES_URL, "", controller.signal)
      if (!mounted.current || categoryRequest.current !== controller || controller.signal.aborted) return
      if (!Array.isArray(value) || !value.every(isCategory)) {
        throw new Error("解密后的分类数据格式有误。")
      }
      setSelectedCategoryID(value[0]?.id ?? null)
      setCategories(value)
    } catch (error) {
      if (mounted.current && categoryRequest.current === controller && !controller.signal.aborted) {
        setCategoryError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (categoryRequest.current === controller) categoryRequest.current = null
    }
  }

  function exit() {
    categoryRequest.current?.abort()
    Script.exit()
  }

  return <NavigationStack>
    <VStack
      padding={{ top: 16 }}
      spacing={0}
      navigationTitle="GET 响应解密"
      navigationBarTitleDisplayMode="inline"
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
      {categoryError ? (
        <VStack spacing={6} padding={{ horizontal: 16 }}>
          <Text>分类加载失败。{categoryError}</Text>
          <Button title="重新加载分类" action={loadCategories} />
        </VStack>
      ) : categories === null ? (
        <ProgressView title="正在加载分类…" />
      ) : categories.length === 0 ? (
        <Text>暂无分类</Text>
      ) : (
        <ScrollView axes="horizontal" scrollIndicator="hidden">
          <HStack spacing={28} padding={{ horizontal: 16 }}>
            {categories.map(category => {
              const selected = category.id === selectedCategoryID
              return (
                <Button
                  key={category.id}
                  buttonStyle="plain"
                  accessibilityAddTraits={selected ? "isSelected" : undefined}
                  action={() => setSelectedCategoryID(category.id)}
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
        </ScrollView>
      )}
      <Spacer />
    </VStack>
  </NavigationStack>
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
