import { Button, Capsule, HStack, Image, Text, VStack, ZStack, useEffect, useObservable } from "scripting"

export type MainTab = "home" | "history" | "profile"

const tabs = [
  { id: "home", label: "主页", icon: "house" },
  { id: "history", label: "历史", icon: "clock.arrow.circlepath" },
  { id: "profile", label: "我的", icon: "person.crop.circle" },
] as const

const height = 52
const tabInset = 4
const edgeInset = 16

type MainNavigationProps = {
  activeTab: MainTab
  closeAction: { current: (() => void) | null }
  select: (tab: MainTab) => void
}

export function MainNavigation({ activeTab, closeAction, select }: MainNavigationProps) {
  const expanded = useObservable(false)

  useEffect(() => {
    const close = () => changeExpanded(false)
    closeAction.current = close
    return () => {
      if (closeAction.current === close) closeAction.current = null
    }
  }, [closeAction, expanded])

  function changeExpanded(next: boolean) {
    if (expanded.value === next) return
    const update = () => expanded.setValue(next)
    if (typeof withAnimation === "function" && typeof Animation !== "undefined" && typeof Animation.easeOut === "function") {
      void withAnimation(Animation.easeOut(0.27), update)
    } else {
      update()
    }
  }

  return (
    <ZStack alignment="trailing" padding={{ trailing: edgeInset, bottom: 12 }}>
      {expanded.value ? <NavigationTabs activeTab={activeTab} select={select} /> : (
        <Button buttonStyle="glass" buttonBorderShape="circle"
          accessibilityLabel="展开导航"
          action={() => changeExpanded(true)}
        >
          <Image systemName="line.3.horizontal" font="title3" frame={{ width: 36, height: 36 }} />
        </Button>
      )}
    </ZStack>
  )
}

function NavigationTabs({ activeTab, select }: Pick<MainNavigationProps, "activeTab" | "select">) {
  const screenWidth = typeof Device !== "undefined" ? Device.screen?.width : undefined
  const width = Math.min(460, (screenWidth ?? 375) - edgeInset * 2)
  const tabWidth = (width - tabInset * 2) / tabs.length
  const panelTransition = typeof Transition !== "undefined" && typeof Transition.scale === "function"
    ? Transition.scale(height / width, { x: 1 - height / (2 * width), y: 0.5 }).combined(Transition.opacity())
    : undefined
  const selectedIndex = tabs.findIndex(tab => tab.id === activeTab)
  const selectionAnimation = typeof Animation !== "undefined" && typeof Animation.easeOut === "function"
    ? { animation: Animation.easeOut(0.24), value: activeTab }
    : undefined
  return (
    <ZStack alignment="leading"
      frame={{ height }}
      glassEffect
      transition={panelTransition}
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
