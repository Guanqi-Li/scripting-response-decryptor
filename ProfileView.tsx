import { Button, Divider, GeometryReader, HStack, Image, Rectangle, ScrollView, Text, TextField, VStack, useEffect, useRef, useState } from "scripting"
import { readLogin, signIn } from "./login"

export function ProfileView({ onInteraction }: { onInteraction: () => void }) {
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [loggedIn, setLoggedIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    try {
      const saved = readLogin()
      if (saved) {
        setAccount(saved.username)
        setPassword(saved.password)
        setLoggedIn(true)
      }
    } catch {
      setError("无法读取本机登录信息。")
    }
    return () => { request.current?.abort() }
  }, [])

  const canSignIn = !pending && account.trim() !== "" && password !== ""

  async function submit() {
    if (!canSignIn || request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError("")
    onInteraction()
    dismissKeyboard()
    try {
      await signIn({ username: account.trim(), password }, controller.signal)
      if (!controller.signal.aborted) setLoggedIn(true)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "登录失败，请重试。")
    } finally {
      request.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

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
                        disabled={pending}
                        onFocus={onInteraction}
                        onSubmit={dismissKeyboard}
                        submitLabel="done"
                      />
                    </HStack>
                  </VStack>
                ))}
              </VStack>
              <VStack spacing={8}>
                <Button disabled={!canSignIn} buttonStyle="plain" action={submit}>
                  <Text fontWeight="semibold"
                    frame={{ maxWidth: "infinity", minHeight: 48 }}
                    foregroundStyle={canSignIn ? "white" : "secondaryLabel"}
                    background={{ style: canSignIn ? "systemBlue" : "tertiarySystemFill", shape: { type: "rect", cornerRadius: 14 } }}
                  >
                    {pending ? "登录中…" : loggedIn ? "重新登录" : "登录"}
                  </Text>
                </Button>
                {error ? <Text font="footnote" foregroundStyle="systemRed">{error}</Text> :
                  loggedIn ? <Text font="footnote" foregroundStyle="secondaryLabel">已保存登录信息</Text> : null}
              </VStack>
            </VStack>
          </VStack>
        </ScrollView>
      )}
    </GeometryReader>
  )
}
