const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { setImmediate: settle } = require('node:timers/promises')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const node = (type, props, key) => ({ type, props, key })
function transpile(file) {
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  })
  assert.equal(diagnostics.length, 0, diagnostics.map(diagnostic => diagnostic.messageText).join('\n'))
  return outputText
}
function load(file, dependencies = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(transpile(file), {
    exports, URL, AbortController, Error, setTimeout, clearTimeout,
    require: name => name.includes('jsx-runtime') ? { jsx: node, jsxs: node } : dependencies[name] ?? {},
    ...globals,
  })
  return exports
}

const signal = () => new AbortController().signal
const book = { bookID: 7, title: '测试漫画', author: '', coverURL: '', updatedAt: '2026-11-16', latestChapter: 40 }
const first = { id: 1, title: '第一话', number: 1 }
const second = { id: 2, title: '第二话', number: 2 }

test('entry exists and all script files compile', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'script.json'), 'utf8'))
  assert.ok(fs.existsSync(path.join(root, metadata.entry)))
  for (const file of fs.readdirSync(root).filter(file => /\.tsx?$/.test(file))) transpile(file)
})

test('home recovers its initial category request and preserves the loaded grid when navigating', async () => {
  const mainHooks = [], navHooks = [], effects = []
  let hooks, cursor, root, catalogRequests = 0, categoryRequests = 0
  let signedIn = false
  const slot = initial => {
    const index = cursor++
    return index in hooks ? hooks[index] : hooks[index] = initial
  }
  const ui = Object.fromEntries(['Button', 'Capsule', 'HStack', 'Image', 'NavigationStack', 'Rectangle', 'ScrollView', 'Text',
    'VStack', 'ZStack'].map(type => [type, type]))
  Object.assign(ui, {
    Navigation: { present({ element }) { root = element; return new Promise(() => {}) } },
    Script: { supportsMinimization: () => false, exit() {} },
    useState(initial) { const entry = slot({ value: initial }); return [entry.value, value => { entry.value = value }] },
    useRef: value => slot({ current: value }),
    useObservable: value => slot({ value, setValue(next) { this.value = next } }),
    useEffect(effect) {
      const entry = slot({ ran: false })
      if (entry.ran) return
      entry.ran = true
      effects.push(effect)
    },
  })
  const request = load('request.ts')
  const { MainNavigation } = load('MainNavigation.tsx', { scripting: ui })
  load('index.tsx', {
    scripting: ui,
    './MainNavigation': { MainNavigation },
    './request': request,
    './ProfileView': { ProfileView: 'ProfileView' },
    './ComicGrid': { ComicGrid: 'ComicGrid', CoverCache: class {} },
    './reader-cache': { ReaderCache: class {} },
    './reading-history': { getReadingHistory: () => [] },
    './catalog': {
      clearLegacyCatalogCache() {},
      fetchCategories: async () => {
        categoryRequests++
        if (categoryRequests === 1) throw new request.ApiError('unavailable', 503)
        if (!signedIn) throw new request.ApiError('token expired', 200, 401)
        return [{ id: 0, name: '新作' }]
      },
      fetchCatalog: async () => { catalogRequests++; return { page: 1, totalPage: 1, books: [book] } },
      appendCatalog: (_, next) => next,
    },
  }, { setTimeout: callback => callback() })
  const render = (component, state) => { hooks = state; cursor = 0; return component.type(component.props) }
  const main = () => render(root, mainHooks).props.children.props
  const nav = props => render(props.overlay.content, navHooks).props.children
  const grid = props => props.children.props.children[0].props.children[2]
  main()
  effects.shift()()
  await settle()
  assert.equal(categoryRequests, 2)
  const failed = main().children.props.children[0].props.children[1]
  assert.equal(failed.props.children[1].props.title, '去登录')
  failed.props.children[1].props.action()
  const profile = main()
  assert.equal(profile.navigationTitle, '我的')
  signedIn = true
  profile.children.props.children[2].props.onSignedIn()
  await settle()
  const initial = main()
  assert.equal(initial.navigationTitle, '爱漫画')
  assert.equal(categoryRequests, 3)
  const initialGrid = grid(initial)
  initialGrid.props.savePosition('7')
  const collapsed = nav(initial)
  effects.shift()()
  assert.equal(collapsed.props.buttonStyle, 'glass')
  collapsed.props.action()
  const expanded = nav(initial)
  const bar = expanded.type(expanded.props).props
  assert.equal(bar.frame.height, 52)
  assert.equal(bar.children[1].props.children.length, 3)
  assert.ok(bar.children[0].props.frame.width * 3 > 288)
  assert.equal(grid(main()).props.entry, initialGrid.props.entry)
  initialGrid.props.onInteraction()
  const updated = main()
  assert.equal(nav(updated).props.accessibilityLabel, '展开导航')
  assert.equal(grid(updated).key, initialGrid.key)
  assert.equal(grid(updated).props.entry, initialGrid.props.entry)
  assert.equal(grid(updated).props.initialPosition, '7')
  assert.equal(catalogRequests, 1)
  nav(updated).props.action()
  assert.equal(nav(updated).props.activeTab, "home")
  assert.equal(updated.children.props.background, undefined)
  assert.equal(nav(updated).props.activeTab, "home")
})

test('login uses two regular text fields and tapping blank space only hides the keyboard', () => {
  const hooks = []
  let cursor = 0, hidden = 0, dismissed = 0
  const ui = Object.fromEntries(['Button', 'Divider', 'GeometryReader', 'HStack', 'Image', 'Rectangle',
    'ScrollView', 'Text', 'TextField', 'VStack'].map(type => [type, type]))
  ui.useState = initial => {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = initial
    return [hooks[index], value => { hooks[index] = value }]
  }
  ui.useRef = current => ({ current })
  ui.useEffect = () => {}
  const { ProfileView } = load('ProfileView.tsx', { scripting: ui }, { Keyboard: { hide() { hidden++ } } })
  function page() {
    cursor = 0
    return ProfileView({ onInteraction: () => { dismissed++ } }).props.children({ size: { height: 500 } }).props
  }
  function textFields(view) {
    if (Array.isArray(view)) return view.flatMap(textFields)
    if (view?.type === 'TextField') return [view.props]
    return view?.props?.children ? textFields(view.props.children) : []
  }
  const scroll = page()
  const body = scroll.children.props
  const fields = textFields(scroll.children)
  assert.deepEqual(Array.from(fields, field => field.title), ['账号', '密码'])
  assert.ok(fields.every(field => field.keyboardType === 'default'))
  assert.equal(body.frame.minHeight, 500)
  body.background.props.onTapGesture()
  assert.equal(hidden, 1)
  assert.equal(dismissed, 0)
  fields[1].onChanged('example')
  assert.equal(textFields(page().children)[1].value, 'example')
  fields[1].onSubmit()
  assert.equal(hidden, 2)
  scroll.onScrollPhaseChange('tracking', 'interacting')
  assert.equal(dismissed, 1)
})

test('site-unavailable HTML is classified as retryable even when HTTP reports success', async () => {
  const request = load('request.ts', { 'node:crypto': require('node:crypto') }, {
    fetch: async () => new Response('<html><title>Site Unavailable</title></html>'),
  })
  await assert.rejects(request.requestAndDecrypt(request.SITE_ORIGIN + '/api/stacksCategories', '', signal()), error => {
    assert.match(error.message, /无法访问漫画站点/)
    assert.equal(request.isAuthenticationError(error), false)
    return request.isTransientRequestError(error)
  })
})

function loginFixture(respond, saved = { username: 'fixture-user', password: 'fixture-password', token: 'old-token' }) {
  const crypto = require('node:crypto')
  const decrypt = load('decrypt.ts', { 'node:crypto': crypto, 'node:buffer': require('node:buffer') }, { TextDecoder })
  function envelope(value) {
    const suffix = '012345'
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(decrypt.KEY), Buffer.from(decrypt.IV_PREFIX + suffix))
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64')
    return { code: 200, data: { suffix, data } }
  }
  const requests = []
  const request = load('request.ts', { 'node:crypto': crypto, './decrypt': decrypt }, {
    fetch: async (url, options) => {
      requests.push({ url, ...options })
      return new Response(JSON.stringify(await respond(new URL(url), options, envelope)))
    },
  })
  const login = load('login.ts', { './request': request }, {
    Storage: { get: () => saved, set: (_, value) => { saved = value; return true } },
  })
  const catalog = load('catalog.ts', { './request': request, './login': login })
  return { catalog, login, requests, request }
}

test('manual login signs a JSON POST and immediately replaces the saved credentials and token', async () => {
  let attempts = 0
  const { login, request, requests } = loginFixture((url, _, envelope) => {
    assert.equal(url.pathname, '/api/newLogins')
    return ++attempts === 1 ? envelope({ token: 'manual-token', member: { ignored: true } }) :
      { code: 401, msg: '登录失败' }
  })
  assert.equal(requests.length, 0)
  const credentials = { username: 'new-user', password: 'new-password' }
  await login.signIn(credentials, signal())
  const [{ method, headers, body }] = requests
  assert.equal(method, 'POST')
  assert.equal(headers['Content-Type'], 'application/json')
  assert.equal(headers.token, undefined)
  assert.equal(headers.sign, request.makeHeaders('/newLogins', 'POST', undefined, Number(headers.timestamp) * 1000).sign)
  assert.deepEqual(JSON.parse(body), { ...credentials, type: 0 })
  assert.deepEqual({ ...login.readLogin() }, { ...credentials, token: 'manual-token' })
  await assert.rejects(login.signIn({ username: 'bad-input', password: 'invalid' }, signal()), /登录失败/)
  assert.equal(login.readLogin().token, 'manual-token')
  assert.equal(login.readLogin().username, 'new-user')
})

test('all comic APIs send the saved token and login POSTs omit it', async () => {
  const results = {
    '/api/stacksCategories': [{ id: 0, name: '新作' }],
    '/api/stacks': { page: 1, totalPage: 1, list: [] },
    '/api/bookDetails': { bookDetail: { id: 7 } },
    '/api/chaptersDirectories': { page: 1, totalPage: 1, list: [] },
    '/api/chaptersDetails': { chapterDetail: { id: 1, book_id: 7, image_list: ['/1.jpg'] } },
    '/api/newLogins': { token: 'saved-token' },
  }
  const { catalog, login, requests } = loginFixture((url, _, envelope) => envelope(results[url.pathname]), null)
  const credentials = { username: 'fixture-user', password: 'fixture-password' }
  await login.signIn(credentials, signal())
  assert.equal(requests[0].headers.token, undefined)

  await catalog.fetchCategories(signal())
  await catalog.fetchCatalog(0, 1, signal())
  await catalog.fetchBookDetails(book, signal())
  await catalog.fetchChapterPage(7, 1, signal())
  await catalog.fetchReaderChapter(7, first, signal())
  await login.signIn(credentials, signal())
  assert.deepEqual(requests.slice(1).map(item => new URL(item.url).pathname), Object.keys(results))
  assert.ok(requests.slice(1, -1).every(item => item.headers.token === 'saved-token'))
  assert.equal(requests.at(-1).headers.token, undefined)
})

test('concurrent chapter requests renew once, persisting only after a validated retry', async () => {
  let releaseRetry
  const waitForRetry = new Promise(resolve => { releaseRetry = resolve })
  const { catalog, login, requests } = loginFixture(async (url, options, envelope) => {
    if (url.pathname === '/api/newLogins') return envelope({ token: 'renewed-token' })
    if (options.headers.token === 'old-token') return { code: 401, msg: 'token失效' }
    await waitForRetry
    return envelope({ chapterDetail: { id: Number(url.searchParams.get('chapter_id')), book_id: 7, image_list: ['/1.jpg'] } })
  })
  const firstRead = catalog.fetchReaderChapter(7, first, signal())
  const secondRead = catalog.fetchReaderChapter(7, second, signal())
  await settle()
  assert.equal(login.readLogin().token, 'old-token')
  const renewals = requests.filter(item => item.method === 'POST')
  assert.equal(renewals.length, 1)
  assert.equal(renewals[0].headers.token, undefined)
  releaseRetry()
  await Promise.all([firstRead, secondRead])
  assert.equal(login.readLogin().token, 'renewed-token')
  assert.equal(requests.filter(item => item.headers.token === 'renewed-token').length, 2)
})

test('chapter failures preserve the saved token and ordinary errors do not trigger login', async () => {
  const { catalog, login, requests } = loginFixture((url, options, envelope) => {
    if (url.pathname === '/api/newLogins') return envelope({ token: 'unused-token' })
    if (url.searchParams.get('chapter_id') === '2') return { code: 500, msg: '章节出错' }
    if (options.headers.token === 'old-token') return { code: 403, msg: 'token 已过期' }
    return envelope({ chapterDetail: { id: first.id, book_id: 7, image_list: [] } })
  })
  await assert.rejects(catalog.fetchReaderChapter(7, second, signal()), /章节出错/)
  assert.equal(requests.length, 1)
  await assert.rejects(catalog.fetchReaderChapter(7, first, signal()), /图片列表为空/)
  assert.equal(login.readLogin().token, 'old-token')
  assert.equal(requests.filter(item => item.method === 'POST').length, 1)
})

test('a pending automatic refresh cannot overwrite a successful manual login', async () => {
  let releaseRetry
  const waitForRetry = new Promise(resolve => { releaseRetry = resolve })
  const { catalog, login } = loginFixture(async (url, options, envelope) => {
    if (url.pathname === '/api/newLogins') {
      return envelope({ token: JSON.parse(options.body).username === 'manual-user' ? 'manual-token' : 'renewed-token' })
    }
    if (options.headers.token === 'old-token') return { code: 401, msg: 'token失效' }
    await waitForRetry
    return envelope({ chapterDetail: { id: 1, book_id: 7, image_list: ['/1.jpg'] } })
  })
  const chapter = catalog.fetchReaderChapter(7, first, signal())
  await settle()
  await login.signIn({ username: 'manual-user', password: 'manual-password' }, signal())
  releaseRetry()
  await chapter
  assert.equal(login.readLogin().token, 'manual-token')
})

function mountCatalogScroll() {
  const { ComicGrid } = load('ComicGrid.tsx', { scripting: {
    Rectangle: 'Rectangle', ScrollView: 'ScrollView',
    useObservable: value => ({ value }),
    useRef: current => ({ current }),
    useEffect() {},
  } }, {
    DragGesture: () => ({
      onChanged(callback) { this.changed = callback; return this },
      onEnded(callback) { this.ended = callback; return this },
    }),
  })
  let requests = 0
  const scroll = ComicGrid({
    entry: { data: { page: 1, totalPage: 2, books: [] } },
    loadPage: () => { requests++ },
    onInteraction() {},
  }).props
  const geometry = y => ({
    contentInsets: { top: 0, bottom: 0 },
    contentSize: { height: 900 },
    containerSize: { height: 600 },
    contentOffset: { y },
  })
  return {
    phase: (previous, next, y) => scroll.onScrollPhaseChange(previous, next, { geometry: geometry(y) }),
    offset: (oldY, newY) => scroll.onScrollGeometryChange.onChanged(geometry(oldY), geometry(newY)),
    move: (width, height) => scroll.simultaneousGesture.changed({ translation: { width, height } }),
    release: (width, height) => scroll.simultaneousGesture.ended({ translation: { width, height } }),
    footer: visible => scroll.children.props.children[1].props.onScrollVisibilityChange.onChanged(visible),
    requests: () => requests,
  }
}

test('the first scroll to the end loads exactly one catalog page', () => {
  const scroll = mountCatalogScroll()
  scroll.phase('idle', 'tracking', 200)
  scroll.phase('tracking', 'interacting', 210)
  scroll.offset(290, 296)
  assert.equal(scroll.requests(), 0)
  scroll.offset(296, 297)
  scroll.phase('interacting', 'decelerating', 301)
  scroll.footer(true)
  assert.equal(scroll.requests(), 1)
})

test('the footer can trigger pagination after the same scroll has already stopped', () => {
  const scroll = mountCatalogScroll()
  scroll.footer(true)
  assert.equal(scroll.requests(), 0)
  scroll.footer(false)
  scroll.phase('idle', 'tracking', 200)
  scroll.phase('tracking', 'interacting', 250)
  scroll.phase('interacting', 'idle', 296)
  scroll.footer(true)
  assert.equal(scroll.requests(), 1)
})

test('a pull at the end loads even when the native offset does not move', () => {
  const scroll = mountCatalogScroll()
  scroll.footer(true)
  scroll.phase('idle', 'tracking', 300)
  scroll.phase('tracking', 'idle', 300)
  assert.equal(scroll.requests(), 0)
  scroll.phase('idle', 'tracking', 300)
  scroll.move(8, -4)
  assert.equal(scroll.requests(), 0)
  scroll.release(0, -4)
  scroll.phase('tracking', 'interacting', 300)
  scroll.phase('interacting', 'idle', 300)
  assert.equal(scroll.requests(), 1)
})

test('failed history read leaves previously saved history intact', () => {
  const record = { book, chapter: first, page: 1, pageCount: 2, readAt: 1 }
  let value = [record], fail = true, writes = 0
  const history = load('reading-history.ts', {}, { Storage: {
    get() { if (fail) throw Error('read failed'); return value },
    set(_, next) { value = next; writes++; return true },
  } })
  assert.throws(() => history.saveReadingRecord({ ...record, page: 2 }), /read failed/)
  assert.equal(writes, 0)
  assert.equal(value[0].page, 1)
  fail = false
  history.saveReadingRecord({ ...record, page: 2 })
  assert.equal(history.getReadingHistory()[0].page, 2)
})

test('valid rows survive malformed data and image numbering is stable', async () => {
  const data = {
    '/api/stacks': { page: 1, totalPage: 1, list: [{ id: 7, title: '有效' }, { id: 8, title: null }] },
    '/api/chaptersDirectories': { page: 1, totalPage: 1, list: [{ id: 1, title: null, sort: 1 }, { title: '坏行' }] },
    '/api/bookDetails': { bookDetail: { id: 7, renew_time: '2026-11-16', last_chapter_obj: {
      updated_at: '2026-11-10', chapter_obj: { sumChapters: 35 },
    } } },
    '/api/chaptersDetails': { chapterDetail: { id: 1, book_id: 7, image_list: ['/1.jpg', null, '/3.jpg'] } },
  }
  const response = async url => ({ value: data[new URL(url).pathname] })
  const catalog = load('catalog.ts', {
    './request': { SITE_ORIGIN: 'https://www.18akmanhua.com', requestAndDecrypt: response },
    './login': { requestWithSavedToken: response, withChapterToken: request => request('') },
  })
  assert.equal((await catalog.fetchCatalog(0, 1, signal())).books.length, 1)
  assert.equal((await catalog.fetchChapterPage(7, 1, signal())).chapters[0].title, '第1话')
  const detail = await catalog.fetchBookDetails(book, signal())
  assert.equal(detail.updatedAt, '2026-11-16')
  assert.equal(detail.latestChapter, 40)
  const manifest = await catalog.fetchReaderChapter(7, first, signal())
  assert.deepEqual(Array.from(manifest.images, url => url ? new URL(url).pathname : ''), ['/1.jpg', '', '/3.jpg'])
})

test('directory index exposes missing neighbors and accepts a single-page repair', async () => {
  const directory = load('ChapterDirectoryView.tsx', { './catalog': { fetchChapterPage: async (_, page) => ({
    totalPage: 3, chapters: [{ id: page, title: String(page), number: page }],
  }) } })
  const cache = new Map()
  await directory.readDirectoryPage(7, cache, 1, signal())
  await directory.readDirectoryPage(7, cache, 3, signal())
  assert.equal(directory.getAdjacentChapter(7, cache, first, 1), undefined)
  assert.equal(directory.getPendingNextPage(7, cache, first), 2)
  await directory.readDirectoryPage(7, cache, 2, signal())
  assert.equal(directory.getAdjacentChapter(7, cache, first, 1).id, 2)
  assert.equal(directory.getPendingNextPage(7, cache, first), undefined)
})

test('the detail and reader directories share an automatic full load and retry only missing pages', async () => {
  let allowPages
  const batch = new Promise(resolve => { allowPages = resolve })
  let fail = true
  const requests = []
  const directory = load('ChapterDirectoryView.tsx', { './catalog': {
    fetchChapterPage: async (_, page) => {
      requests.push(page)
      if (page > 1) await batch
      if (page === 2 && fail) throw new Error('page failed')
      return { totalPage: 4, chapters: [{ id: page, title: String(page), number: page }] }
    },
  } })
  const cache = new Map()
  const detail = directory.observeDirectoryLoad(7, cache, () => {})
  await settle()
  assert.deepEqual(requests, [1, 2, 3, 4])
  assert.equal(directory.getChapters(7, cache).length, 1)
  const snapshots = []
  const reader = directory.observeDirectoryLoad(7, cache, () => {
    snapshots.push(Array.from(directory.getChapters(7, cache), chapter => chapter.id))
  })
  assert.equal(reader.finished, detail.finished)
  detail.release()
  const failed = assert.rejects(reader.finished, /第 2 页/)
  allowPages()
  await failed
  reader.release()
  assert.deepEqual(snapshots, [[1, 3, 4]])

  fail = false
  const retry = directory.observeDirectoryLoad(7, cache, () => {})
  await retry.finished
  retry.release()
  assert.deepEqual(requests, [1, 2, 3, 4, 2])
  assert.deepEqual(Array.from(directory.getChapters(7, cache), chapter => chapter.id), [1, 2, 3, 4])
})

test('a 33-chapter directory publishes the whole list without showing page one on its own', async () => {
  let release
  const remaining = new Promise(resolve => { release = resolve })
  const state = [], effects = [], requested = []
  let cursor
  const slot = initial => {
    const index = cursor++
    return index in state ? state[index] : state[index] = initial
  }
  const { ChapterDirectoryView } = load('ChapterDirectoryView.tsx', {
    scripting: {
      Text: 'Text', ProgressView: 'ProgressView', VStack: 'VStack',
      useState(initial) { const entry = slot({ value: initial }); return [entry.value, value => { entry.value = value }] },
      useEffect(effect) { effects.push(effect) },
      useRef: current => slot({ current }),
    },
    './catalog': {
      async fetchChapterPage(_, page) {
        requested.push(page)
        if (page > 1) await remaining
        const chapters = Array.from({ length: page === 3 ? 3 : 15 }, (_, offset) => {
          const id = (page - 1) * 15 + offset + 1
          return { id, title: String(id), number: id }
        })
        return { totalPage: 3, chapters }
      },
    },
  })
  const cache = new Map()
  function view() {
    cursor = 0
    return ChapterDirectoryView({ bookID: 7, cache, openChapter() {} }).props.children[1]
  }
  assert.equal(view().type, 'ProgressView')
  const [publish, mount] = effects
  publish()
  const unmount = mount()
  await settle()
  assert.deepEqual(requested, [1, 2, 3])
  assert.equal(cache.get(7).chapters.length, 15)
  assert.equal(view().type, 'ProgressView')
  release()
  await settle()
  assert.deepEqual(Array.from(view().props.chapters, chapter => chapter.id),
    Array.from({ length: 33 }, (_, index) => index + 1))
  unmount()
})

test('visible pages take one stale download slot, then retry transient prefetch once', async () => {
  const jobs = []
  const { ReaderCache, ReaderRequests } = load('reader-cache.ts', {}, {
    fetch: (url, { signal }) => new Promise((resolve, reject) => {
      jobs.push({ url, signal, resolve })
      signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })
    }),
  })
  const requests = new ReaderRequests(new ReaderCache(), 7)
  requests.prioritize(['/a', '/b', '/c'])
  requests.prioritize(['/visible', '/ahead'], ['/visible'])
  assert.equal(jobs.filter(job => job.signal.aborted).length, 1)
  await settle()
  const visible = jobs.find(job => job.url === '/visible')
  assert.ok(visible)
  visible.resolve({ ok: false, status: 503 })
  await settle()
  requests.prioritize(['/ahead', '/visible'], ['/visible'])
  await settle()
  assert.equal(jobs.filter(job => job.url === '/visible').length, 2)
  jobs.filter(job => job.url === '/visible')[1].resolve({ ok: false, status: 503 })
  await settle()
  requests.prioritize(['/visible', '/ahead'], ['/visible'])
  assert.equal(jobs.filter(job => job.url === '/visible').length, 2)
  requests.close()
})

test('image diagnostics distinguish queue time, download time, and native image processing time', async () => {
  let now = 100
  const jobs = new Map()
  const { ReaderCache, ReaderRequests } = load('reader-cache.ts', {}, {
    Date: { now: () => now },
    fetch: url => new Promise(resolve => { jobs.set(url, resolve) }),
    UIImage: { fromData() {
      now += 8
      return {
        width: 100, height: 100, scale: 1,
        croppedTo() { now += 2; return null },
      }
    } },
  })
  const cache = new ReaderCache()
  const requests = new ReaderRequests(cache, 7)
  requests.prioritize(['/1', '/2', '/3', '/4'], ['/1'])
  assert.equal(requests.imageTiming('/4').queuedAt, 100)
  assert.equal(requests.imageTiming('/4').startedAt, undefined)

  now = 135
  jobs.get('/1')({ ok: true, data: async () => { now = 190; return {} } })
  await settle()
  assert.deepEqual({ ...requests.imageTiming('/1') }, {
    queuedAt: 100, startedAt: 100, receivedAt: 190, finishedAt: 200, outcome: 'ready',
  })
  assert.equal(requests.imageTiming('/4').startedAt, 200)
  requests.close()
  assert.equal(requests.imageTiming('/1'), undefined)
})

test('cover queue is capped and discards pending work for an unseen cover', async () => {
  const jobs = []
  const { CoverCache } = load('ComicGrid.tsx', {}, {
    fetch: url => new Promise(resolve => jobs.push({ url, resolve })),
    UIImage: { fromData: () => ({ width: 100, height: 150 }) },
  })
  const covers = new CoverCache()
  const watched = Array.from({ length: 10 }, (_, i) => covers.watch('/' + i))
  assert.equal(jobs.length, 4)
  watched[4].release()
  assert.equal(await watched[4].promise, null)
  jobs[0].resolve({ ok: true, data: async () => ({}) })
  await settle()
  assert.equal(jobs.length, 5)
  assert.equal(jobs[4].url, '/5')
  covers.clear()
})

function mountReader({ initialPage = 1, failure } = {}) {
  const jobs = [], saved = [], hooks = [], rowHooks = [], props = []
  let activeHooks = hooks
  let cursor, cleanup
  const slot = value => {
    const i = cursor++
    return i in activeHooks ? activeHooks[i] : activeHooks[i] = value
  }
  const ui = {
    Navigation: { useDismiss: () => () => {} },
    useRef: value => slot({ current: value }),
    useObservable: value => slot({ value, setValue(next) { this.value = next }, subscribe() {}, unsubscribe() {} }),
    useEffect: effect => props.push(effect),
  }
  for (const type of ['Button', 'GeometryReader', 'HStack', 'Image', 'LazyVStack', 'NavigationStack',
    'ProgressView', 'Rectangle', 'ScrollView', 'Spacer', 'Text', 'VStack', 'ZStack']) ui[type] = type
  class ReaderRequests {
    failed = new Set()
    prioritize(urls, visible) { jobs.push({ urls, visible }) }
    imageTiming() { return undefined }
    async chapter(chapter) {
      if (failure) {
        const error = failure
        failure = null
        throw error
      }
      return { chapter, images: ['/next.jpg'] }
    }
    close() {}
  }
  class ApiError extends Error {}
  const { ChapterReader } = load('ChapterReader.tsx', {
    scripting: ui, './reader-cache': { ReaderRequests }, './request': { ApiError, isTransientRequestError: () => false },
    './reading-history': { saveReadingRecord: record => saved.push(record), chapterLabel: chapter => chapter.title },
  })
  const images = Array.from({ length: 12 }, (_, i) => '/' + (i + 1))
  const cache = { images: new Map(images.map(url => [url, { image: {} }])), ratios: new Map() }
  function view() {
    cursor = 0
    activeHooks = hooks
    props.length = 0
    return ChapterReader({ book, chapter: first, initialPage, opening: { data: { chapter: first, images } },
      cache, directoryCache: new Map(), getAdjacent: chapter => chapter.id === 1 ? second : undefined,
      getMissingPage: () => undefined, reloadDirectoryPage: async () => {} })
  }
  view()
  cleanup = props[0]()
  const scroll = () => view().props.children[1].props.children({ size: { width: 440, height: 950 } })
  const visible = ids => scroll().props.onScrollTargetVisibilityChange.onChanged(ids)
  const tapImage = () => {
    const component = scroll().props.children.props.children.flat()[0].props.children
    cursor = 0
    activeHooks = rowHooks
    component.type(component.props).props.children.props.onTapGesture()
  }
  return { view, scroll, visible, tapImage, jobs, saved, cleanup }
}

test('tapping the reader timing button opens and closes the inline diagnostic panel', () => {
  const reader = mountReader()
  reader.tapImage()
  const controls = () => reader.view().props.children[3].props.children
  const timingButton = () => controls()[0].props.children.at(-1).props
  try {
    assert.equal(timingButton().title, '测速')
    timingButton().action()
    assert.equal(timingButton().title, '关闭')
    assert.match(controls()[1].props.children, /当前.*第 1 张/)
    timingButton().action()
    assert.equal(controls()[1], null)
  } finally {
    reader.cleanup()
  }
})

test('resume waits for confirmation without blocking downloads of actual visible pages', () => {
  const reader = mountReader({ initialPage: 9 })
  reader.visible(['1:2'])
  assert.equal(reader.jobs.at(-1).urls[0], '/2')
  assert.equal(reader.saved.length, 0)
  reader.scroll().props.onScrollPhaseChange('tracking', 'interacting', { geometry: {} })
  reader.cleanup()
  assert.equal(reader.saved.at(-1).page, 2)
})

test('a transient prefetch failure does not prevent automatic append at the end', async () => {
  const reader = mountReader({ failure: Error('temporary failure') })
  reader.visible(['1:1'])
  reader.visible(['1:9'])
  await settle()
  reader.visible(['1:12', 'chapter-end:1:12'])
  await settle()
  assert.equal(reader.scroll().props.children.props.children.flat().at(-1).key, 'chapter-end:2:1')
  reader.cleanup()
})

test('manual chapter error leaves automatic append available for the current chapter', async () => {
  const reader = mountReader({ failure: Error('manual request failed') })
  reader.visible(['1:1'])
  reader.tapImage()
  const controls = reader.view().props.children.at(-1)
  const nextButton = controls.props.children.flatMap(row => row?.props.children ?? [])
    .find(node => node?.props?.title === '下一章')
  nextButton.props.action()
  await settle()
  assert.match(reader.view().props.children[2].props.children[0].props.children, /manual request failed/)
  reader.visible(['1:12', 'chapter-end:1:12'])
  await settle()
  assert.equal(reader.scroll().props.children.props.children.flat().at(-1).key, 'chapter-end:2:1')
  reader.cleanup()
})

test('an unrecognized page update never rewrites the saved resume position', () => {
  const reader = mountReader({ initialPage: 10 })
  reader.visible(['1:2'])
  reader.visible(['1:4'])
  reader.cleanup()
  assert.equal(reader.saved.length, 0)
})
