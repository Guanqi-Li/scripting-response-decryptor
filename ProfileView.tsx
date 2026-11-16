import { Button, ScrollView, SecureField, Text, TextField, VStack, useState } from "scripting"

export function ProfileView({ onInteraction }: { onInteraction: () => void }) {
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")

  return (
    <ScrollView
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      scrollBounceBehavior="always"
      onScrollPhaseChange={(_, phase) => { if (phase === "interacting") onInteraction() }}
    >
      <VStack spacing={16} padding={{ horizontal: 20, top: 20, bottom: 80 }} frame={{ maxWidth: "infinity" }}>
        <VStack spacing={12} frame={{ maxWidth: 420 }}>
          <Text font="title2" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            登录爱漫画
          </Text>
          <TextField
            title="账号"
            value={account}
            onChanged={setAccount}
            textInputAutocapitalization="never"
            autocorrectionDisabled
            onFocus={onInteraction}
            textFieldStyle="roundedBorder"
          />
          <SecureField
            title="密码"
            value={password}
            onChanged={setPassword}
            onFocus={onInteraction}
            textFieldStyle="roundedBorder"
          />
          <Button buttonStyle="borderedProminent" disabled action={() => {}}>
            <Text frame={{ maxWidth: "infinity" }}>登录</Text>
          </Button>
          <Text font="footnote" foregroundStyle="secondaryLabel">登录暂未开放</Text>
        </VStack>
      </VStack>
    </ScrollView>
  )
}
