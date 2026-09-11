'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function compile(source, context = {}) {
  const sandbox = { module: { exports: {} }, exports: {}, URL, Buffer, ...context };
  sandbox.exports = sandbox.module.exports;
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output, sandbox);
  return sandbox.module.exports;
}
function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}

test('documentation assets and query stay on the configured internal host', () => {
  const { internalDocsTarget } = compile(read('src/utils/internalDocsTarget.ts'));
  const base = 'http://docs-argws-connect-production:8080';
  for (const asset of ['/', '/openapi/connect-api.openapi.json', '/openapi/branding/docs/connect-api-rest-light.png', '/assets/app.js?v=1', '/?source=https://example.invalid']) {
    const target = internalDocsTarget(base, asset);
    assert.equal(target.origin, base);
    assert.ok(target.pathname.startsWith('/'));
  }
  for (const attack of ['//evil.invalid/path', 'https://evil.invalid', '/\\evil.invalid', '/%2f%2fevil.invalid', '/%5cevil.invalid', '/../etc/passwd', '/%2e%2e/a', '/%00x', '/bad\nvalue']) {
    assert.throws(() => internalDocsTarget(base, attack), undefined, attack);
  }
  assert.throws(() => internalDocsTarget('file:///etc', '/'));
  assert.throws(() => internalDocsTarget('http://user:password@docs:8080', '/'));
});

test('documentation forwarding never follows remote redirects server-side', () => {
  const source = read('src/api/routes/view.router.ts');
  assert.ok(source.includes("redirect: 'manual'"));
  assert.ok(source.includes('redirected.origin !== target.origin'));
  assert.ok(source.includes('internalDocsTarget(docsInternalUrl, req.url)'));
  assert.doesNotMatch(source, /new URL\(suffix/);
});

test('current Manager retains direct access only for the document lifetime', () => {
  const source = read('manager/src/services/current.ts');
  const start = source.indexOf('const ACCESS_STORAGE_KEY');
  const end = source.indexOf('let instanceCache', start);
  const save = source.match(/function saveAccess\(value: string\) \{[\s\S]*?\n\}/);
  assert.ok(start >= 0 && end > start && save);
  const sessionStorage = storage({ connect_access_code: 'old-value' });
  const localStorage = storage({ connect_access_code: 'old-value' });
  const program = source.slice(start, end) + '\n' + save[0] + '\nexport { saveAccess }; export const getAccess = () => accessCode;';
  const loaded = compile(program, { sessionStorage, localStorage });
  assert.equal(loaded.getAccess(), '');
  assert.equal(sessionStorage.getItem('connect_access_code'), null);
  loaded.saveAccess('  test-access-value  ');
  assert.equal(loaded.getAccess(), 'test-access-value');
  assert.equal(sessionStorage.getItem('connect_access_code'), null);
  assert.equal(localStorage.getItem('connect_access_code'), null);
  const reloaded = compile(program, { sessionStorage, localStorage });
  assert.equal(reloaded.getAccess(), '');
  loaded.saveAccess('');
  assert.equal(loaded.getAccess(), '');
});

test('legacy Manager clears old credentials and does not persist new ones', () => {
  const localStorage = storage({ token: 'old-api', instanceToken: 'old-instance', managerTheme: 'dark' });
  const sessionStorage = storage({ token: 'old-api', instanceToken: 'old-instance' });
  const program = read('manager-legacy/src/core/session.js');
  const session = compile(program, { localStorage, sessionStorage });
  session.saveSession({ apiUrl: 'https://example.invalid/manager/', apiKey: 'test-api' });
  session.saveSelectedInstance({ id: 'test-id', name: 'test-name', token: 'test-instance' });
  assert.equal(session.loadSession().apiKey, 'test-api');
  assert.equal(session.loadSelectedInstance().token, 'test-instance');
  for (const value of localStorage.data.values()) assert.notEqual(value, 'test-api');
  assert.equal(localStorage.getItem('instanceToken'), null);
  assert.equal(sessionStorage.getItem('token'), null);
  const afterReload = compile(program, { localStorage, sessionStorage });
  assert.equal(afterReload.loadSession(), null);
  assert.equal(afterReload.getTheme(), 'dark');
  session.clearSession();
  assert.equal(session.loadSession(), null);
});
