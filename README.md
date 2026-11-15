# GET 响应解密 · 1.4.1

Scripting 仓库导入地址：https://github.com/Guanqi-Li/scripting-response-decryptor

## 使用

- 全屏打开后先加载分类，按接口返回的顺序显示。自动选中第一项并使用它的 ID 请求第 1 页，切换分类时使用对应的 ID。
- 每页请求 15 本漫画。三列显示封面、标题和作者，保留每本漫画的 `bookID`。
- 点击封面、标题或作者打开详情，按漫画 ID 加载简介、最近更新时间和最新章节。简介显示在封面右边，默认最多两行，超出时可以展开。详情缺少更新时间或章节时，使用列表里对应的数据。返回继续浏览原列表。
- 拉到底部后再向上划一次可追加下一页，也可点击「加载更多」。翻页出错时保留已有列表，可在页尾重试。
- 列表、页码、详情和已加载封面保留在本次运行的内存中，切回分类时直接复用。退出后重新打开会重新加载。升级后首次打开会清理旧版写入的漫画列表缓存。
- 左上角 × 退出并中止请求，右上角 − 最小化。

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
