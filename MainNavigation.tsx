import { Button, Capsule, HStack, Image, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"

export type MainTab = "home" | "history" | "profile"

const tabs = [
  { id: "home", label: "主页", icon: "house" },
  { id: "history", label: "历史", icon: "clock.arrow.circlepath" },
  { id: "profile", label: "我的", icon: "person.crop.circle" },
] as const

const height = 52
const tabInset = 4
const tabWidth = (288 - tabInset * 2) / tabs.length

type MainNavigationProps = {
  activeTab: MainTab
  closeAction: { current: (() => void) | null }
  select: (tab: MainTab) => void
}

export function MainNavigation({ activeTab, closeAction, select }: MainNavigationProps) {
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef(false)

  useEffect(() => {
    const close = () => {
      if (!expandedRef.current) return
      expandedRef.current = false
      setExpanded(false)
    }
    closeAction.current = close
    return () => {
      if (closeAction.current === close) closeAction.current = null
    }
  }, [closeAction])

  if (!expanded) return (
    <Button buttonStyle="glass" buttonBorderShape="circle"
      padding={{ trailing: 16, bottom: 12 }}
      accessibilityLabel="展开导航"
      action={() => {
        expandedRef.current = true
        setExpanded(true)
      }}
    >
      <Image systemName="line.3.horizontal" font="title3" frame={{ width: 36, height: 36 }} />
    </Button>
  )

  const selectedIndex = tabs.findIndex(tab => tab.id === activeTab)
  const selectionAnimation = typeof Animation !== "undefined" && typeof Animation.easeOut === "function"
    ? { animation: Animation.easeOut(0.24), value: activeTab }
    : undefined
  return (
    <ZStack alignment="leading"
      frame={{ height }}
      glassEffect
      padding={{ trailing: 16, bottom: 12 }}
    >
      <Capsule
        fill="tertiarySystemFill"
        frame={{ width: tabWidth, height: height - tabInset * 2 }}
        offset={{ x: tabInset + selectedIndex * tabWidth, y: 0 }}
        animation={selectionAnimation}
        allowsHitTesting={false}
        accessibilityHidden
      />
      <HStack spacing={0} padding={{ horizontal: tabInset }}>
        {tabs.map(({ id, label, icon }) => {
          const selected = activeTab === id
          return (
            <Button key={id} buttonStyle="plain"
              accessibilityLabel={label}
              accessibilityAddTraits={selected ? "isSelected" : undefined}
              action={() => select(id)}
            >
              <VStack spacing={2}
                frame={{ width: tabWidth, height: height - tabInset * 2 }}
                contentShape="rect"
                foregroundStyle={selected ? "systemBlue" : "label"}
              >
                <Image systemName={icon} font="body" />
                <Text font="caption" fontWeight="semibold">{label}</Text>
              </VStack>
            </Button>
          )
        })}
      </HStack>
    </ZStack>
  )
}
