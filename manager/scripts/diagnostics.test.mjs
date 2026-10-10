import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const manager = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const compiled = Object.fromEntries(['current', 'diagnostics', 'retry-after'].map(name => [name, ts.transpileModule(
  fs.readFileSync(path.join(manager, `src/services/${name}.ts`), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText]))

function browser(respond) {
  const requests = [], links = [], blobs = [], removed = [], revoked = [], errors = [], timers = new Map(), listeners = new Map()
  let timerId = 0
  const setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id }
  const clearTimeout = id => timers.delete(id)
  class BrowserURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return 'blob:https://manager.example.test/diagnostic' }
    static revokeObjectURL(url) { revoked.push(url) }
  }
  const storage = { removeItem() {}, getItem() { assert.fail('Must not read storage') }, setItem() { assert.fail('Must not persist keys') } }
  const dependencies = {
    '@/config/runtime': { runtime: { apiBaseUrl: 'https://manager.example.test', requestTimeoutMs: 20000 } },
    './normalizers': {}, './whatsapp-destination': {}, './integration-definitions': {}, './voice-media': {},
  }
  const context = {
    sessionStorage: storage, localStorage: storage, URL: BrowserURL, AbortController, DOMException, setTimeout, clearTimeout,
    console: { error: value => errors.push(value) },
    window: {
      setTimeout,
      addEventListener(type, callback) { listeners.set(type, callback) },
      removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type) },
    },
    document: {
      body: { appendChild() {} },
      createElement(tag) { assert.equal(tag, 'a'); return { click() { links.push(this) }, remove() { removed.push(this) } } },
    },
    async fetch(input, init) {
      const req = { url: new URL(String(input)), init }
      requests.push(req)
      if (req.url.pathname === '/verify-creds') return Response.json({ valid: true })
      if (respond) return respond(req)
      return req.url.pathname.endsWith('/export') ? new Response('sanitized-test-record') : Response.json({ ready: true, events: [], nextCursor: null })
    },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name] },
  }
  function load(name) {
    const module = { exports: {} }
    vm.runInNewContext(compiled[name], { ...context, module, exports: module.exports }, { filename: `${name}.js` })
    return module.exports
  }
  dependencies['./retry-after'] = load('retry-after')
  const current = load('current')
  dependencies['./current'] = current
  return { current, ...load('diagnostics'), requests, links, blobs, removed, revoked, errors, timers, listeners }
}
const drain = () => new Promise(resolve => setImmediate(resolve))
const login = session => session.current.current.loginAccess('test-global-key')
const filters = { from: '2026-09-13T12:00:00.000Z', to: '2026-09-13T13:00:00.000Z', level: 'error', category: 'call', traceId: 'trace-a', callId: 'call-b', instanceId: 'instance-c' }

test('diagnostics require verified memory-only login for every read, setting and export', async () => {
  const session = browser()
  for (const fn of [() => session.diagnostics.status(), () => session.diagnostics.events(filters), () => session.diagnostics.settings(7, 128), () => session.diagnostics.download(filters)]) await assert.rejects(fn, /acesso administrativo/)
  assert.equal(session.requests.length, 0)
  await login(session)
  await session.diagnostics.status()
  await session.diagnostics.events(filters, 'cursor+/=')
  await session.diagnostics.settings(7, 128)
  for (const { url, init } of session.requests.slice(1)) {
    assert.equal(init.headers.apikey, 'test-global-key')
    assert.equal(init.credentials, 'same-origin')
    assert.equal(url.href.includes('test-global-key'), false)
    assert.ok(init.signal instanceof AbortSignal)
  }
  assert.equal(session.requests[2].url.searchParams.get('cursor'), 'cursor+/=')
  assert.equal(session.requests[2].url.searchParams.get('limit'), '100')
  assert.equal(session.requests[3].init.method, 'PUT')
  assert.deepEqual(JSON.parse(session.requests[3].init.body), { retentionDays: 7, maxDiskMB: 128 })
  await session.current.current.logout()
  await assert.rejects(() => session.diagnostics.status(), /acesso administrativo/)
})

for (const format of ['gzip', 'jsonl']) test(`${format} download exports the full applied filter and discards cursor, limit and unrelated fields`, async () => {
  const session = browser()
  await login(session)
  await session.diagnostics.download({ ...filters, cursor: 'should-not-export', limit: '1', conversation: 'do-not-send' }, format)
  const req = session.requests.at(-1)
  assert.equal(req.url.pathname, '/diagnostics/export')
  assert.equal(req.url.searchParams.get('format'), format)
  for (const [key, value] of Object.entries(filters)) assert.equal(req.url.searchParams.get(key), value)
  for (const key of ['cursor', 'limit', 'conversation']) assert.equal(req.url.searchParams.has(key), false)
  assert.equal(session.links.length, 1)
  assert.equal(session.removed.length, 1)
  assert.ok(session.links[0].download.endsWith(format === 'gzip' ? '.jsonl.gz' : '.jsonl'))
  assert.equal(await session.blobs[0].text(), 'sanitized-test-record')
  const cleanup = [...session.timers.values()].find(timer => timer.delay === 1000)
  assert.ok(cleanup)
  cleanup.fn()
  assert.deepEqual(session.revoked, [session.links[0].href])
})

test('a response from a previous administrator session is discarded, including export bytes', async () => {
  for (const operation of ['status', 'download']) {
    let finish
    const session = browser(() => new Promise(resolve => { finish = resolve }))
    await login(session)
    const pending = operation === 'status' ? session.diagnostics.status() : session.diagnostics.download(filters)
    await session.current.current.logout()
    await session.current.current.loginAccess('new-test-global-key')
    finish(operation === 'status' ? Response.json({ ready: true }) : new Response('previous-session-data'))
    await assert.rejects(pending, /acesso mudou/i)
    assert.equal(session.blobs.length, 0)
    assert.equal(session.links.length, 0)
  }
})

test('logout while the response body is being read cannot reveal the old records', async () => {
  let finishBody
  const session = browser(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { finishBody = resolve }) }))
  await login(session)
  const pending = session.diagnostics.events(filters)
  await drain()
  await session.current.current.logout()
  finishBody({ events: [{ id: 'old-session-event' }] })
  await assert.rejects(pending, /acesso mudou/i)
})

test('abort is propagated and a late result is not returned after page cleanup', async () => {
  let finish
  const session = browser(() => new Promise(resolve => { finish = resolve }))
  await login(session)
  const controller = new AbortController()
  const pending = session.diagnostics.status(controller.signal)
  controller.abort()
  assert.equal(session.requests.at(-1).init.signal.aborted, true)
  finish(Response.json({ ready: true }))
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(session.timers.size, 0)
})

for (const [status, expected] of [[403, /acesso global/], [429, /muitas solicitações/], [503, /disponibilidade da API/], [404, /versão da API/]]) test(`HTTP ${status} remains an explicit failure without reflecting private backend error content`, async () => {
  const session = browser(() => Response.json({ message: 'secret-message-with-contact-and-token' }, { status }))
  await login(session)
  await assert.rejects(() => session.diagnostics.status(), error => expected.test(error.message) && !error.message.includes('secret-message'))
  assert.equal(session.timers.size, 0)
})

test('frontend exceptions submit only fixed kind and screen; no errors are transmitted before login', async () => {
  const session = browser()
  const previousCalls = []
  const previousHandler = (...args) => previousCalls.push(args)
  const app = { config: { errorHandler: previousHandler } }
  const router = { currentRoute: { value: { matched: [{ path: '/instancias/:id' }], fullPath: '/instancias/phone-secret?apikey=secret' } } }
  const cleanup = session.installDiagnosticsErrors(app, router)
  const secret = new Error('private message conversation authentication-token')
  session.listeners.get('error')({ error: secret, filename: 'https://secret.example/?token=secret' })
  assert.equal(session.requests.length, 0)
  await login(session)
  session.listeners.get('error')({ error: secret })
  await drain()
  session.listeners.get('unhandledrejection')({ reason: secret })
  await drain()
  app.config.errorHandler(secret, { private: 'component state' }, 'private detail')
  await drain()
  const reports = session.requests.slice(1)
  assert.equal(reports.length, 3)
  assert.deepEqual(reports.map(req => JSON.parse(req.init.body)), [
    { kind: 'window_error', page: 'instances' }, { kind: 'unhandled_rejection', page: 'instances' }, { kind: 'vue_error', page: 'instances' },
  ])
  for (const req of reports) { assert.equal(req.url.pathname, '/diagnostics/client-events'); assert.equal(req.init.body.includes('secret'), false) }
  assert.equal(previousCalls[0][0], secret)
  cleanup()
  assert.equal(session.listeners.size, 0)
  assert.equal(app.config.errorHandler, previousHandler)
})

test('reporting failures are swallowed and repeated browser errors are capped at six per minute', async () => {
  const session = browser(async () => { throw new Error('diagnostics offline') })
  await login(session)
  const app = { config: {} }, router = { currentRoute: { value: { matched: [{ path: '/chamadas' }] } } }
  session.installDiagnosticsErrors(app, router)
  for (let i = 0; i < 20; i++) { session.listeners.get('error')({ message: 'not-collected' }); await drain() }
  assert.equal(session.requests.length, 7)
  assert.equal(session.timers.size, 0)
})

test('unknown and concrete paths never become frontend event data', () => {
  const session = browser()
  assert.equal(session.diagnosticScreen('/chamadas'), 'calls')
  assert.equal(session.diagnosticScreen('/diagnostico'), 'diagnostics')
  assert.equal(session.diagnosticScreen('/instancias/:id/integracoes/:key'), 'instances')
  for (const value of ['/instancias/customer-phone', '/chamadas?token=secret', 'https://private.example', '/private/name']) assert.equal(session.diagnosticScreen(value), 'unknown')
})

for (const [operation, deadline, expected] of [
  ['events', 20000, /consulta.*20 segundos/i],
  ['download', 120000, /download.*2 minutos/i],
]) test(`${operation} reports its deadline clearly and does not save a timed-out response`, async () => {
  const session = browser(req => new Promise((resolve, reject) => {
    req.init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
  }))
  await login(session)
  const pending = operation === 'events' ? session.diagnostics.events(filters) : session.diagnostics.download(filters)
  const assertion = assert.rejects(pending, error => expected.test(error.message) && error.name !== 'AbortError')
  const timer = [...session.timers.values()].find(value => value.delay === deadline)
  assert.ok(timer)
  timer.fn()
  await assertion
  assert.equal(session.requests.at(-1).init.signal.aborted, true)
  assert.equal(session.timers.size, 0)
  assert.equal(session.links.length, 0)
})

test('an export body finishing after cancellation or its deadline never becomes a downloadable file', async () => {
  for (const reason of ['cancel', 'deadline']) {
    let finishBody
    const session = browser(async () => ({ ok: true, status: 200, blob: () => new Promise(resolve => { finishBody = resolve }) }))
    await login(session)
    const controller = new AbortController()
    const pending = session.diagnostics.download(filters, 'gzip', controller.signal)
    const assertion = assert.rejects(pending, error => reason === 'cancel' ? error.name === 'AbortError' : /download.*2 minutos/i.test(error.message))
    await drain()
    if (reason === 'cancel') controller.abort()
    else [...session.timers.values()].find(timer => timer.delay === 120000).fn()
    finishBody(new Blob(['unfinished-file']))
    await assertion
    assert.equal(session.requests.at(-1).init.signal.aborted, true)
    assert.equal(session.links.length, 0)
    assert.equal(session.blobs.length, 0)
    assert.equal(session.timers.size, 0)
  }
})

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const snapshot = {
  ready: true, persistent: true, storageError: false, diskBytes: 1024, maxDiskBytes: 134217728,
  retentionDays: 7, storedEvents: 1, dropped: 0, counts: { info: 1, warn: 0, error: 0 }, categories: {},
  version: 'test',
}
const record = { id: 'visible-event', timestamp: '2026-10-08T14:36:00.000Z', level: 'info', category: 'runtime', code: 'runtime.sample', summary: 'Evento técnico' }
const descriptor = parse(fs.readFileSync(path.join(manager, 'src/views/DiagnosticsView.vue'), 'utf8'), { filename: 'DiagnosticsView.vue' }).descriptor
const viewScript = compileScript(descriptor, { id: 'diagnostics-test' })
const viewTemplate = compileTemplate({ id: 'diagnostics-test', filename: 'DiagnosticsView.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: viewScript.bindings } })
assert.deepEqual(viewTemplate.errors, [])

function view({ status = async () => snapshot, events = async () => ({ events: [record], nextCursor: null }), download = async () => {} } = {}) {
  const requests = [], hooks = {}, intervals = new Map()
  let intervalId = 0
  const dependencies = {
    vue: { ...Vue, onMounted: fn => { hooks.mount = fn }, onUnmounted: fn => { hooks.unmount = fn }, withCtx: fn => fn, withDirectives: node => node },
    '@/layouts/AppShell.vue': { default: {} }, '@/components/PageHeader.vue': { default: {} }, '@/components/AppIcon.vue': { default: {} },
    '@/services/diagnostics': { diagnostics: {
      status(signal) { requests.push({ kind: 'status', signal }); return status(signal) },
      events(applied, cursor, signal) { requests.push({ kind: 'events', filters: { ...applied }, cursor, signal }); return events(applied, cursor, signal) },
      download(applied, format, signal) { requests.push({ kind: 'download', filters: { ...applied }, format, signal }); return download(applied, format, signal) },
      settings: async () => snapshot,
    } },
  }
  function evaluate(source) {
    const module = { exports: {} }
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, Error, Date, Intl, AbortController, console,
      setInterval(fn, delay) { const id = ++intervalId; intervals.set(id, { fn, delay }); return id },
      clearInterval: id => intervals.delete(id), document: { hidden: false },
      require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name] },
    })
    return module.exports
  }
  const scope = Vue.effectScope()
  const state = scope.run(() => evaluate(viewScript.content).default.setup({}, { expose() {} }))
  const render = evaluate(viewTemplate.code).render
  function nodes(node) {
    if (!node || typeof node !== 'object') return []
    const children = Array.isArray(node.children) ? node.children : typeof node.children?.default === 'function' ? node.children.default() : []
    return [node, ...children.flatMap(nodes)]
  }
  function text(node) { return typeof node.children === 'string' ? node.children : nodes(node).filter(child => typeof child.children === 'string').map(child => child.children).join(' ') }
  return {
    state, requests, intervals,
    button(label) { return nodes(render({}, [], {}, Vue.proxyRefs(state), {}, {})).find(node => node.type === 'button' && text(node).includes(label)) },
    text() { return text(render({}, [], {}, Vue.proxyRefs(state), {}, {})) },
    cleanup() { hooks.unmount(); scope.stop() },
  }
}

test('the seven-day export is available while history is pending and keeps the applied range', async () => {
  const page = deferred(), file = deferred()
  const h = view({ events: () => page.promise, download: () => file.promise })
  h.state.draft.period = '7d'
  const pending = h.state.refresh()
  await drain()
  const applied = { ...h.state.applied.value }
  assert.equal(h.state.loading.value, true)
  assert.equal(h.button('Baixar diagnóstico').props.disabled, false)
  assert.notEqual(h.button('Aplicar filtros').props.disabled, true)
  const downloading = h.state.download()
  const exported = h.requests.find(req => req.kind === 'download')
  assert.deepEqual(exported.filters, applied)
  assert.equal(exported.format, 'gzip')
  assert.equal(new Date(exported.filters.to) - new Date(exported.filters.from), 7 * 86400000)
  h.state.draft.period = '1h'
  assert.deepEqual(exported.filters, applied)
  assert.equal(h.button('Preparando…').props.disabled, true)
  file.resolve()
  page.resolve({ events: [], nextCursor: null })
  await Promise.all([pending, downloading])
  h.cleanup()
})

test('history remains usable when storage status fails and export does not depend on that status', async () => {
  const h = view({ status: async () => { throw new Error('Estado indisponível.') } })
  await h.state.refresh()
  assert.equal(h.state.events.value[0]?.id, record.id)
  assert.equal(h.state.error.value, '')
  assert.match(h.state.statusError.value, /Estado indisponível/)
  assert.equal(h.button('Baixar diagnóstico').props.disabled, false)
  h.cleanup()
})

test('storage status is retained independently when history fails and export is still usable', async () => {
  const h = view({ events: async () => { throw new Error('Histórico indisponível.') } })
  await h.state.refresh()
  assert.equal(h.state.status.value?.persistent, true)
  assert.ok(h.state.statusLoadedAt.value)
  assert.match(h.state.error.value, /Histórico indisponível/)
  assert.equal(h.button('Baixar diagnóstico').props.disabled, false)
  h.cleanup()
})

test('a slow storage snapshot does not delay history rendering or starve its deadline through auto-refresh', async () => {
  const metadata = deferred()
  const h = view({ status: () => metadata.promise })
  const pending = h.state.refresh()
  await drain()
  assert.equal(h.state.loading.value, false)
  assert.equal(h.state.loadingStatus.value, true)
  assert.equal(h.state.events.value[0].id, record.id)
  assert.match(h.text(), /Evento técnico/)
  h.state.live.value = true
  await Vue.nextTick()
  const before = h.requests.length
  for (const timer of h.intervals.values()) timer.fn()
  assert.equal(h.requests.length, before)
  metadata.resolve(snapshot)
  await pending
  assert.equal(h.state.loadingStatus.value, false)
  h.cleanup()
})

test('a failed storage refresh keeps and labels the last successful snapshot without resetting its timestamp', async () => {
  let calls = 0
  const h = view({ status: async () => {
    if (++calls === 1) return snapshot
    throw new Error('Estado indisponível.')
  } })
  await h.state.refresh()
  const checkedAt = h.state.statusLoadedAt.value
  await h.state.refresh()
  assert.equal(h.state.status.value?.persistent, true)
  assert.equal(h.state.statusLoadedAt.value, checkedAt)
  assert.equal(h.state.events.value[0].id, record.id)
  assert.match(h.text(), /indicadores mantêm a consulta anterior/i)
  assert.match(h.text(), /armazenamento consultado em/i)
  h.cleanup()
})

test('a new period aborts the old scan and cannot be replaced by its late response', async () => {
  const old = deferred()
  let count = 0
  const h = view({ events: () => ++count === 1 ? old.promise : Promise.resolve({ events: [record], nextCursor: null }) })
  h.state.draft.period = '7d'
  const pending = h.state.refresh()
  const oldRequest = h.requests.find(req => req.kind === 'events')
  h.state.draft.period = '1h'
  await h.state.refresh()
  assert.equal(oldRequest.signal.aborted, true)
  old.resolve({ events: [{ ...record, id: 'obsolete-event' }], nextCursor: 'obsolete-cursor' })
  await pending
  assert.deepEqual(h.state.events.value.map(event => event.id), [record.id])
  assert.equal(h.state.cursor.value, null)
  assert.equal(new Date(h.state.applied.value.to) - new Date(h.state.applied.value.from), 3600000)
  h.cleanup()
})

test('the page offers cancellation for an export and does not auto-refresh during it', async () => {
  const file = deferred()
  const h = view({ download: () => file.promise })
  await h.state.refresh()
  h.state.live.value = true
  await Vue.nextTick()
  const downloading = h.state.download()
  const exported = h.requests.find(req => req.kind === 'download')
  const before = h.requests.length
  for (const timer of h.intervals.values()) timer.fn()
  assert.equal(h.requests.length, before)
  h.button('Cancelar download').props.onClick()
  assert.equal(exported.signal.aborted, true)
  file.reject(new DOMException('Consulta cancelada.', 'AbortError'))
  await downloading
  assert.equal(h.state.downloading.value, false)
  assert.equal(h.state.exportError.value, '')
  h.cleanup()
})
