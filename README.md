# 响应解密 · 1.0.0

适用于 iPhone/iPad 的 Scripting App。使用官方文档列出的 `node:crypto` / `node:buffer` 内置兼容模块，无需安装 npm 依赖。请使用支持这些模块的当前 Scripting 版本。

## 使用

将整个目录导入 Scripting。复制接口响应 JSON，运行脚本，点击“读取剪贴板并解密”。可查看结果并点击“复制完整结果”。退出结束实例，最小化保留当前结果。解密失败时保留上一次成功结果。

支持完整响应 `{"data":{"suffix":"123456","data":"BASE64密文"}}`，或直接传入 `{"suffix":"123456","data":"BASE64密文"}`。

## 在其他 Scripting 脚本中复用

将 decrypt.ts 放入脚本目录：

```ts
import { decryptResponse } from "./decrypt"

const result = decryptResponse(response) // response 可以是 JSON 字符串或对象
console.log(JSON.stringify(result, null, 2))
```

密钥按用户要求内置在 decrypt.ts 中；KEY 是 UTF-8 的 32 字节字符串，不按 hex 解码。IV 为固定前缀加 suffix 的 UTF-8 字节。AES-CBC 默认移除 PKCS#7 填充，与原 Python 实现一致。返回解析后的 JSON 值。此工具仅在本地处理剪贴板内容，不发起网站请求。

## 验证与限制

使用 .NET AES 生成密文，与转换后的模块交叉验证；测试根层/嵌套结构、中文和多种长度、非法字段、IV、Base64 与损坏的填充。未进行 Scripting 真机运行，也未验证网站当前返回的数据。

官方依据：[Quick Start](https://scriptingapp.github.io/guide/Quick%20Start)、[Node API 兼容说明](https://scriptingapp.github.io/guide/Changelog/3.2.2/Node%20API%20Compatibility%20Guide)、[Pasteboard](https://scriptingapp.github.io/guide/Device%20Capabilities/Pasteboard)。
