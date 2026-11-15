# 爱漫画 · 1.7.0

Scripting 仓库导入地址：https://github.com/Guanqi-Li/scripting-response-decryptor

## 使用

- 全屏打开后先加载分类，按接口返回的顺序显示。自动选中第一项并使用它的 ID 请求第 1 页，切换分类时使用对应的 ID。
- 每页请求 15 本漫画。三列显示封面、标题和作者，保留每本漫画的 `bookID`。
- 点击封面、标题或作者打开详情，按漫画 ID 加载最近更新时间和最新章节。更新时间优先采用作品更新时间，最新话数优先采用完整目录中的最后一话。返回继续浏览原列表。切换分类后再切回时恢复该分类的滚动位置。
- 详情与章节目录同时请求。目录按接口返回的总页数自动加载、按页码合并，保留对应的章节 ID。目录重试仅请求缺失页。
- 点击章节或详情的阅读按钮进入全屏阅读，轻点画面可返回、切章或打开目录。滑过末页会追加下一章。
- 默认 token 仅用于 `/api/chaptersDetails`。章节请求返回 401 时可在阅读器替换 token 并重试，替换值仅在本次运行中生效。
- 首页右下角可切换观看历史，点击历史记录先进入漫画详情。「继续阅读」恢复上次看到的章节和图片。
- 在本机保存阅读进度与观看历史。阅读图片和章节详情只在本次运行中缓存。
- 拉到底部后再向上划一次可追加下一页，也可点击「加载更多」。翻页出错时保留已有列表，可在页尾重试。
- 列表、页码、详情、目录和已加载封面保留在本次运行的内存中，切回分类时直接复用。退出后重新打开会重新加载。升级后首次打开会清理旧版写入的漫画列表缓存。
- 左上角 × 退出并中止请求，右上角 − 最小化。

## 签名和解密

每次请求重新生成秒级 timestamp，sign 为以下 UTF-8 文本的小写 MD5：

`timestamp + "api" + apiPath + "GET" + SECRET`

apiPath 为网址 pathname 去掉 /api 后的路径，例如 /api/banners 对应 /banners。查询参数保留在请求网址中，不参与签名；URL fragment 不发送。签名沿用 URL 的路径编码，不额外解码。请求头包含 timestamp、sign、User-Agent: Mozilla/5.0，token 非空时添加 token。

按用户要求内置 KEY 和网站签名 SECRET。AES KEY 使用 UTF-8 字节，不进行 hex 解码。IV 为固定前缀与响应 suffix 拼接后的 UTF-8 字节，AES-256-CBC 自动移除 PKCS#7 填充。

decrypt.ts 导出 decryptResponse(response)，支持完整响应或内层 payload；request.ts 导出 URL 解析、签名和请求解密函数，可供其他脚本复用。

## 运行环境与验证

使用 Scripting 原生 UI、fetch、AbortController，以及内置 node:crypto / node:buffer，无需 npm 依赖。请使用支持这些 API 的当前 Scripting 版本。

### 本地回归检查

在 Node.js 22 或更新版本运行 `npm ci` 和 `npm test`。测试使用模拟请求和原生 UI，覆盖目录、预加载、续读、接章和历史保存。实际滚动与内存表现需要在 iPhone 上确认。

官方文档：[Quick Start](https://scriptingapp.github.io/guide/Quick%20Start)、[fetch 与超时](https://scriptingapp.github.io/guide/Utilities/Request/fetch)、[Node API 兼容说明](https://scriptingapp.github.io/guide/Changelog/3.2.2/Node%20API%20Compatibility%20Guide)。
