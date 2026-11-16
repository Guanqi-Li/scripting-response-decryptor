import { Button, Capsule, GeometryReader, HStack, Image, Text, VStack, ZStack } from "scripting"

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
  expanded: boolean
  expand: () => void
  select: (tab: MainTab) => void
}

export function MainNavigation({ activeTab, expanded, expand, select }: MainNavigationProps) {
  const selectedIndex = tabs.findIndex(tab => tab.id === activeTab)
  return (
    <GeometryReader>
      {({ size }) => {
        const expandedWidth = Math.min(460, Math.max(height, size.width - edgeInset * 2))
        const tabWidth = (expandedWidth - tabInset * 2) / tabs.length
        return (
          <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}>
            <ZStack alignment="trailing"
              frame={{ width: expanded ? expandedWidth : height, height, alignment: "trailing" }}
              clipShape="capsule"
              glassEffect={{ glass: UIGlass.regular(), shape: "capsule" }}
              animation={{ animation: Animation.smooth({ duration: 0.3 }), value: expanded }}
              padding={{ trailing: edgeInset, bottom: 12 }}
            >
              <ZStack alignment="leading"
                frame={{ width: expandedWidth, height }}
                opacity={expanded ? 1 : 0}
                allowsHitTesting={expanded}
                accessibilityHidden={!expanded}
              >
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
              <Button
                buttonStyle="plain"
                accessibilityLabel="展开导航"
                action={expand}
                opacity={expanded ? 0 : 1}
                allowsHitTesting={!expanded}
                accessibilityHidden={expanded}
              >
                <Image systemName="line.3.horizontal" font="title3"
                  frame={{ width: height, height }} contentShape="circle" />
              </Button>
            </ZStack>
          </VStack>
        )
      }}
    </GeometryReader>
  )
}
