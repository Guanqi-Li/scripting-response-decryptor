# GET 响应解密 · 1.1.0

Scripting 仓库导入地址：https://github.com/Guanqi-Li/scripting-response-decryptor

## 使用

1. 点击“输入或修改网址”，手动输入接口完整网址，例如 https://www.18akmanhua.com/api/banners 。
2. 如接口需要登录，点击“设置 token”；否则留空。token 仅保存在本次运行内存中。
3. 点击“GET 请求并解密”，查看 HTTP 状态和解密后的完整 JSON。

不读取或写入剪贴板。支持取消请求，15 秒原生请求超时，失败保留上次成功结果。退出中止请求并结束实例；最小化保留实例。网址需包含 /api/ 前缀。不跟随重定向，请直接输入目标接口网址。

## 签名和解密

每次请求重新生成秒级 timestamp，sign 为以下 UTF-8 文本的小写 MD5：

`timestamp + "api" + apiPath + "GET" + SECRET`

apiPath 为网址 pathname 去掉 /api 后的路径，例如 /api/banners 对应 /banners。查询参数保留在请求网址中，不参与签名；URL fragment 不发送。签名沿用 URL 的路径编码，不额外解码。请求头包含 timestamp、sign、User-Agent: Mozilla/5.0，token 非空时添加 token。

按用户要求内置 KEY 和网站签名 SECRET。AES KEY 使用 UTF-8 字节，不进行 hex 解码。IV 为固定前缀与响应 suffix 拼接后的 UTF-8 字节，AES-256-CBC 自动移除 PKCS#7 填充。

decrypt.ts 导出 decryptResponse(response)，支持完整响应或内层 payload；request.ts 导出 URL 解析、签名和请求解密函数，可供其他脚本复用。

## 运行环境与验证

使用 Scripting 原生 UI、fetch、AbortController，以及内置 node:crypto / node:buffer，无需 npm 依赖。请使用支持这些 API 的当前 Scripting 版本。

本地解密已用独立 .NET AES 密文交叉验证。签名与 Python hashlib 交叉验证，检查 URL 与查询参数解析及取消行为。真实请求 /api/banners 返回 HTTP 200、接口 code 422，提示缺少 type 参数；返回的加密 data 已成功解密为 {}。脚本将此类接口错误显示为失败，不误报业务成功。请自行输入带所需参数的完整接口网址。未进行 Scripting 真机验证。

官方文档：[Quick Start](https://scriptingapp.github.io/guide/Quick%20Start)、[fetch 与超时](https://scriptingapp.github.io/guide/Utilities/Request/fetch)、[Node API 兼容说明](https://scriptingapp.github.io/guide/Changelog/3.2.2/Node%20API%20Compatibility%20Guide)。
