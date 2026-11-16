import { Button, Capsule, Device, HStack, Image, Text, VStack, ZStack, useEffect, useRef, useState } from "scripting"

export type MainTab = "home" | "history" | "profile"

const tabs = [
  { id: "home", label: "主页", icon: "house" },
  { id: "history", label: "历史", icon: "clock.arrow.circlepath" },
  { id: "profile", label: "我的", icon: "person.crop.circle" },
] as const

const height = 52
const edgeInset = 16
const tabInset = 4

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

  function expand() {
    expandedRef.current = true
    setExpanded(true)
  }

  const expandedWidth = Math.min(420, Device.screen.width - edgeInset * 2)
  const tabWidth = (expandedWidth - tabInset * 2) / tabs.length
  const selectedIndex = tabs.findIndex(tab => tab.id === activeTab)

  return (
    <ZStack
      alignment="trailing"
      frame={{ width: expanded ? expandedWidth : height, height, alignment: "trailing" }}
      animation={{ animation: Animation.smooth({ duration: 0.28 }), value: expanded }}
      padding={{ trailing: edgeInset, bottom: 12 }}
    >
      <Capsule
        fill="clear"
        frame={{ width: expanded ? expandedWidth : height, height }}
        glassEffect={{ glass: UIGlass.regular(), shape: "capsule" }}
        allowsHitTesting={false}
        accessibilityHidden
      />
      {expanded ? (
        <ZStack alignment="leading" transition={Transition.opacity()}>
          <Capsule
            fill="tertiarySystemFill"
            frame={{ width: tabWidth, height: height - tabInset * 2 }}
            offset={{ x: tabInset + selectedIndex * tabWidth, y: 0 }}
            animation={{ animation: Animation.smooth({ duration: 0.25 }), value: activeTab }}
            allowsHitTesting={false}
            accessibilityHidden
          />
          <HStack spacing={0} padding={{ horizontal: tabInset }}>
            {tabs.map(({ id, label, icon }) => {
              const selected = activeTab === id
              return (
                <Button
                  key={id}
                  buttonStyle="plain"
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
      ) : (
        <Button
          buttonStyle="plain"
          accessibilityLabel="展开导航"
          transition={Transition.opacity()}
          action={expand}
        >
          <Image systemName="line.3.horizontal" font="title3"
            frame={{ width: height, height }} contentShape="circle" />
        </Button>
      )}
    </ZStack>
  )
}
