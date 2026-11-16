import { Button, HStack, Image, Rectangle, Text, VStack, ZStack } from "scripting"

export type MainTab = "home" | "history" | "profile"

const tabs = [
  { id: "home", label: "主页", icon: "house" },
  { id: "history", label: "历史", icon: "clock.arrow.circlepath" },
  { id: "profile", label: "我的", icon: "person.crop.circle" },
] as const

type MainNavigationProps = {
  activeTab: MainTab
  expanded: boolean
  expand: () => void
  dismiss: () => void
  select: (tab: MainTab) => void
}

export function MainNavigation({ activeTab, expanded, expand, dismiss, select }: MainNavigationProps) {
  if (!expanded) return (
    <Button
      buttonStyle="glass"
      buttonBorderShape="circle"
      padding={{ trailing: 16, bottom: 12 }}
      accessibilityLabel="展开导航"
      action={expand}
    >
      <Image systemName="line.3.horizontal" font="title3" frame={{ width: 36, height: 36 }} />
    </Button>
  )

  return (
    <ZStack alignment="bottom" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Rectangle
        fill="clear"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        contentShape="rect"
        onTapGesture={dismiss}
        accessibilityHidden
      />
      <VStack padding={{ horizontal: 20, bottom: 12 }}>
        <HStack spacing={0} padding={5}
          frame={{ maxWidth: 460 }}
          glassEffect={{ glass: UIGlass.regular(), shape: "capsule" }}
        >
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
                <VStack
                  spacing={4}
                  frame={{ maxWidth: "infinity", minHeight: 60 }}
                  contentShape="rect"
                  background={selected ? { style: "tertiarySystemFill", shape: "capsule" } : undefined}
                  foregroundStyle={selected ? "systemBlue" : "label"}
                >
                  <Image systemName={icon} font="title2" />
                  <Text font="subheadline" fontWeight={selected ? "semibold" : "regular"}>{label}</Text>
                </VStack>
              </Button>
            )
          })}
        </HStack>
      </VStack>
    </ZStack>
  )
}
