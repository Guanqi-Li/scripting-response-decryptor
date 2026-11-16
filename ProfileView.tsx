import {
  Button, GeometryReader, HStack, Image, Rectangle, ScrollView, SecureField, Text, TextField, VStack, useState,
} from "scripting"

export function ProfileView({ onInteraction }: { onInteraction: () => void }) {
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  function dismiss() {
    onInteraction()
    if (typeof Keyboard !== "undefined") Keyboard.hide()
  }

  const passwordField = {
    title: "密码",
    value: password,
    onChanged: setPassword,
    onFocus: onInteraction,
    onSubmit: dismiss,
    submitLabel: "done" as const,
    textFieldStyle: "roundedBorder" as const,
  }

  return (
    <GeometryReader>
      {({ size }) => (
        <ScrollView
          scrollDismissesKeyboard="immediately"
          scrollBounceBehavior="always"
          onScrollPhaseChange={(_, phase) => { if (phase === "interacting") dismiss() }}
        >
          <VStack
            padding={{ horizontal: 20, top: 20, bottom: 80 }}
            frame={{ maxWidth: "infinity", minHeight: size.height, alignment: "top" }}
            background={<Rectangle fill="clear" contentShape="rect" onTapGesture={dismiss} accessibilityHidden />}
          >
            <VStack spacing={12} frame={{ maxWidth: 420 }}>
              <Text font="title2" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                登录爱漫画
              </Text>
              <TextField title="账号" value={account} onChanged={setAccount}
                keyboardType="default" textInputAutocapitalization="never" autocorrectionDisabled
                onFocus={onInteraction} onSubmit={dismiss} submitLabel="done" textFieldStyle="roundedBorder"
              />
              <HStack spacing={8}>
                {showPassword ? (
                  <TextField {...passwordField} keyboardType="default" textInputAutocapitalization="never" autocorrectionDisabled />
                ) : (
                  <SecureField {...passwordField} />
                )}
                <Button buttonStyle="plain" accessibilityLabel={showPassword ? "隐藏密码" : "显示密码"}
                  action={() => { onInteraction(); setShowPassword(!showPassword) }}
                >
                  <Image systemName={showPassword ? "eye.slash" : "eye"}
                    frame={{ width: 44, height: 44 }} contentShape="rect" />
                </Button>
              </HStack>
              <Button buttonStyle="borderedProminent" disabled action={() => {}}>
                <Text frame={{ maxWidth: "infinity" }}>登录</Text>
              </Button>
              <Text font="footnote" foregroundStyle="secondaryLabel">登录暂未开放</Text>
            </VStack>
          </VStack>
        </ScrollView>
      )}
    </GeometryReader>
  )
}
