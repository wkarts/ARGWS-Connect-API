'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const typescript = require('typescript');
const { OperationalStore, safeEvent, dayAt } = require('../operations-agent/store.cjs');
const { createAgent } = require('../operations-agent/server.cjs');
const root = path.resolve(__dirname, '..');
function loadTs(relative) {
  const absolute = path.join(root, relative);
  const source = require('node:fs').readFileSync(absolute, 'utf8');
  const compiled = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 } }).outputText;
  const module = new Module(absolute, moduleParent);
  module.filename = absolute; module.paths = Module._nodeModulePaths(path.dirname(absolute));
  module._compile(compiled, absolute);
  return module.exports;
}
const moduleParent = module;
const { createCatalogReader, connectCatalogPlugin } = loadTs('src/api/integrations/channel/whatsapp/zapo.catalog.plugin.ts');
const { ZapoGroupIdentityCache } = loadTs('src/api/integrations/channel/whatsapp/zapo.group-identity.ts');
const { whatsappDestination } = loadTs('manager/src/services/whatsapp-destination.ts');
const n = (tag, content, attrs = {}) => ({ tag, attrs, content });
const txt = (tag, content) => n(tag, Buffer.from(content));
const product = n('product', [txt('id', 'p1'), txt('name', 'Produto de teste'), txt('price', '10000'), txt('currency', 'BRL'), n('media', [n('image', [txt('original_image_url', 'https://example.test/p.png')])])]);

test('catalog uses real read IQ through the native public plugin, not a Baileys socket', async () => {
  const requests = [];
  const reader = createCatalogReader(async (context, node) => { requests.push({ context, node }); return n('iq', [n('product_catalog', [product, n('paging', [txt('after', 'native-cursor')])])]); });
  const result = await reader.getCatalog({ jid: '5511999999999:4@s.whatsapp.net', limit: 10, cursor: 'previous' });
  assert.equal(result.products[0].name, 'Produto de teste');
  assert.equal(result.products[0].price, 10000);
  assert.equal(result.nextPageCursor, 'native-cursor');
  assert.equal(requests[0].node.attrs.xmlns, 'w:biz:catalog');
  assert.equal(requests[0].node.attrs.type, 'get');
  assert.equal(requests[0].node.content[0].attrs.jid, '5511999999999@s.whatsapp.net');
  assert.equal(requests[0].node.content[0].content.find((v) => v.tag === 'after').content.toString(), 'previous');
  const plugin = connectCatalogPlugin();
  assert.equal(plugin.exposeAs, 'connectCatalog');
  assert.equal(typeof plugin.setup({ queryWithContext: async () => n('iq', [n('product_catalog', [])]) }).getCatalog, 'function');
});
test('catalog preserves unknown values and never returns fake products for protocol errors', async () => {
  const empty = createCatalogReader(async () => n('iq', [n('product_catalog', [])]));
  assert.deepEqual((await empty.getCatalog({ jid: '123@lid' })).products, []);
  const rejected = createCatalogReader(async () => n('iq', [n('error', undefined, { code: '403' })], { type: 'error' }));
  await assert.rejects(() => rejected.getCatalog({ jid: '123@lid' }), /rejected/);
  assert.throws(() => empty.getCatalog({ jid: '120363123456789012@g.us' }), /Invalid/);
  assert.throws(() => empty.getCatalog({ jid: '123@lid', limit: -1 }), /limit/);
  const malformed = createCatalogReader(async () => n('iq', []));
  await assert.rejects(() => malformed.getCatalog({ jid: '123@lid' }), /Unexpected/);
});
test('collections use business namespace and preserve products/status', async () => {
  let request;
  const reader = createCatalogReader(async (_context, node) => { request = node; return n('iq', [n('collections', [n('collection', [txt('id', 'c1'), txt('name', 'Coleção'), product, n('status_info', [txt('status', 'APPROVED')])])])]); });
  const result = await reader.getCollections('5511999999999@s.whatsapp.net');
  assert.equal(request.content[0].attrs.biz_jid, '5511999999999@s.whatsapp.net');
  assert.equal(result.collections[0].products[0].id, 'p1');
  assert.equal(result.collections[0].status.status, 'APPROVED');
});
test('catalog deduplicates simultaneous identical requests', async () => {
  let calls = 0, release;
  const wait = new Promise((resolve) => { release = resolve; });
  const reader = createCatalogReader(async () => { calls++; await wait; return n('iq', [n('product_catalog', [])]); });
  const a = reader.getCatalog({ jid: '123@lid' }), b = reader.getCatalog({ jid: '123@lid' });
  release(); await Promise.all([a, b]); assert.equal(calls, 1);
});
test('group namespace, hyphen and LID survive outbound normalization', () => {
  for (const ref of ['123456789-1234567890@g.us', '120363123456789012@g.us', '177159062745149@lid']) assert.equal(whatsappDestination(ref), ref);
  assert.equal(whatsappDestination('5511999999999:3@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
  assert.throws(() => whatsappDestination('status@broadcast'));
  assert.throws(() => whatsappDestination('unexpected@evil'));
});
test('group metadata learns once, separates participants and refreshes only on demand', async () => {
  let now = 0, calls = 0;
  const cache = new ZapoGroupIdentityCache(async () => { calls++; return { subject: 'Equipe de suporte' }; }, () => now);
  const group = '120363123456789012@g.us';
  const results = await Promise.all(Array.from({ length: 30 }, () => cache.resolve(group)));
  assert.equal(calls, 1); assert.equal(results[0].subject, 'Equipe de suporte');
  await cache.resolve('123@lid'); assert.equal(calls, 1);
  now = 300001; await cache.resolve(group); assert.equal(calls, 2);
});
test('operational records discard every sensitive input, not only known secret keys', () => {
  const input = { event: 'http.summary', count: 3, service: 'api', message: 'PRIVATE_MESSAGE', phone: '5511888888888', unknownNewField: 'SECRET', actor: 'Private Name', token: 'apikeysecret', qr: 'pairing' };
  const event = safeEvent(input, Date.now());
  const serialized = JSON.stringify(event);
  assert.equal(event.count, 3);
  for (const value of ['PRIVATE_MESSAGE', '5511888888888', 'SECRET', 'Private Name', 'apikeysecret', 'pairing']) assert.ok(!serialized.includes(value));
  assert.throws(() => safeEvent({ event: 'messages.upsert' }, Date.now()));
  assert.equal(dayAt(Date.parse('2026-09-09T01:00:00Z'), 'America/Bahia'), '2026-09-08');
});
test('daily archives remain queryable after live records are removed; pagination is exact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connect-ops-test-'));
  let now = Date.parse('2026-09-01T10:00:00Z');
  const store = new OperationalStore(dir, { clock: () => now, hotDays: 2 });
  try {
    await store.init();
    await store.append(Array.from({ length: 5 }, () => ({ event: 'http.summary', count: 1, payload: 'SECRET' })));
    now = Date.parse('2026-09-04T10:00:00Z');
    await store.maintain();
    await assert.rejects(fs.stat(path.join(dir, 'live', '2026-09-01.jsonl')));
    assert.equal((await store.verifyArchive('2026-09-01')).count, 5);
    let cursor, ids = [];
    do {
      const page = await store.query({ from: '2026-09-01', to: '2026-09-01', limit: 2, cursor });
      ids.push(...page.events.map((event) => event.id)); cursor = page.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
    await store.maintain();
    assert.equal((await store.days()).length, 1);
    await assert.rejects(() => store.query({ from: '2026-01-01', to: '2026-09-01' }));
    await assert.rejects(() => store.query({ from: '2026-09-01', to: '2026-09-01', cursor: Buffer.from('{"day":"../../secret","line":0}').toString('base64url') }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('corrupted archive never authorizes removal of the remaining live file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connect-ops-corrupt-'));
  let now = Date.parse('2026-09-01T10:00:00Z');
  const store = new OperationalStore(dir, { clock: () => now, hotDays: 3 });
  try {
    await store.init(); await store.append([{ event: 'agent.started' }]);
    now = Date.parse('2026-09-02T10:00:00Z'); await store.maintain();
    await fs.appendFile(path.join(dir, 'archives', '2026-09-01.jsonl.gz'), 'tamper');
    now = Date.parse('2026-09-05T10:00:00Z'); await assert.rejects(() => store.maintain());
    assert.ok(await fs.stat(path.join(dir, 'live', '2026-09-01.jsonl')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('agent requires a dedicated token and serves private history / readable compressed export', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connect-ops-http-'));
  const token = 'test-only-not-a-production-secret-123456789';
  const store = new OperationalStore(dir);
  const agent = await createAgent({ token, store, checks: [] });
  try {
    await new Promise((resolve) => agent.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${agent.server.address().port}`;
    assert.equal((await fetch(base + '/snapshot')).status, 401);
    const headers = { authorization: `Bearer ${token}` };
    const archiveList = await (await fetch(base + '/archives', { headers })).json();
    const day = archiveList.archives[0].day;
    const download = await fetch(base + `/export?day=${day}`, { headers });
    assert.equal(download.status, 200);
    const decoded = require('node:zlib').gunzipSync(Buffer.from(await download.arrayBuffer())).toString();
    assert.ok(decoded.includes('Monitoramento iniciado')); assert.ok(!decoded.includes(token));
  } finally { await agent.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
