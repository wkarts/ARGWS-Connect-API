import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const manager = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const compiled = Object.fromEntries(['current', 'diagnostics'].map(name => [name, ts.transpileModule(
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
