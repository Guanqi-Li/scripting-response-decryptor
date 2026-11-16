import { Button, Divider, GeometryReader, HStack, Image, Rectangle, ScrollView, Text, TextField, VStack, useState } from "scripting"

export function ProfileView({ onInteraction }: { onInteraction: () => void }) {
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")

  function dismissKeyboard() {
    if (typeof Keyboard !== "undefined") Keyboard.hide()
  }

  const fields = [
    { title: "账号", icon: "person", value: account, onChanged: setAccount },
    { title: "密码", icon: "key", value: password, onChanged: setPassword },
  ]

  return (
    <GeometryReader>
      {({ size }) => (
        <ScrollView
          scrollDismissesKeyboard="immediately"
          scrollBounceBehavior="always"
          onScrollPhaseChange={(_, phase) => {
            if (phase !== "interacting") return
            onInteraction()
            dismissKeyboard()
          }}
        >
          <VStack
            padding={{ horizontal: 24, top: 32, bottom: 80 }}
            frame={{ maxWidth: "infinity", minHeight: size.height, alignment: "top" }}
            background={<Rectangle fill="clear" contentShape="rect" onTapGesture={dismissKeyboard} accessibilityHidden />}
          >
            <VStack spacing={22} frame={{ maxWidth: 400 }}>
              <VStack spacing={12}>
                <Image systemName="book.fill"
                  font={27}
                  foregroundStyle="white"
                  frame={{ width: 60, height: 60 }}
                  background={{ style: "systemBlue", shape: { type: "rect", cornerRadius: 18 } }}
                  accessibilityHidden
                />
                <Text font="title2" fontWeight="semibold">登录爱漫画</Text>
              </VStack>
              <VStack spacing={0}
                background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}
              >
                {fields.map(({ title, icon, value, onChanged }, index) => (
                  <VStack key={title} spacing={0}>
                    {index > 0 ? <Divider padding={{ leading: 48, trailing: 16 }} /> : null}
                    <HStack spacing={12} padding={{ horizontal: 16 }} frame={{ minHeight: 54 }}>
                      <Image systemName={icon} foregroundStyle="secondaryLabel"
                        frame={{ width: 20 }} accessibilityHidden />
                      <TextField title={title} value={value} onChanged={onChanged}
                        keyboardType="default"
                        textInputAutocapitalization="never"
                        autocorrectionDisabled
                        textFieldStyle="plain"
                        onFocus={onInteraction}
                        onSubmit={dismissKeyboard}
                        submitLabel="done"
                      />
                    </HStack>
                  </VStack>
                ))}
              </VStack>
              <VStack spacing={8}>
                <Button disabled buttonStyle="plain" action={() => {}}>
                  <Text fontWeight="semibold"
                    frame={{ maxWidth: "infinity", minHeight: 48 }}
                    foregroundStyle="secondaryLabel"
                    background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 14 } }}
                  >
                    登录
                  </Text>
                </Button>
                <Text font="footnote" foregroundStyle="secondaryLabel">登录暂未开放</Text>
              </VStack>
            </VStack>
          </VStack>
        </ScrollView>
      )}
    </GeometryReader>
  )
}
