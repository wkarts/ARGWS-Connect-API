'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync, execFileSync } = require('node:child_process');
const ts = require('typescript');

// This suite requires a repository checkout. It runs from test:compat, not
// manager/npm test: the standalone Manager Docker context excludes the API.
const root = path.resolve(__dirname, '..');
const manager = path.join(root, 'manager');
const source = fs.readFileSync(path.join(root, 'src/config/manager-features.config.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleResult = { exports: {} };
vm.runInNewContext(compiled, { module: moduleResult, exports: moduleResult.exports, process: { env: {} } });
const { managerFeatures, MANAGER_FEATURE_DEFAULTS } = moduleResult.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const localDefaults = JSON.parse(fs.readFileSync(path.join(manager, 'public/assets/feature-defaults.json'), 'utf8'));

function renderFeatures(env) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-feature-parity-'));
  try {
    const output = path.join(directory, 'runtime.js');
    execFileSync('sh', [
      path.join(manager, 'docker-entrypoint.d/40-manager-features.sh'),
      path.join(manager, 'public/assets/runtime-config.js'), output,
    ], { env: { PATH: process.env.PATH, ...env }, timeout: 15000 });
    const script = fs.readFileSync(output, 'utf8');
    const window = { location: { hostname: 'fixture.invalid', protocol: 'https:', port: '' } };
    vm.runInNewContext(script, { window });
    return {
      features: plain(window.__CONNECT_WEB__.features),
      appVersion: window.__CONNECT_WEB__.appVersion,
      script,
    };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('API defaults and standalone Manager defaults remain identical', () => {
  assert.deepEqual(localDefaults, plain(MANAGER_FEATURE_DEFAULTS));
  const features = managerFeatures({ AUTHENTICATION_API_KEY: 'fixture-secret', OPERATIONS_INTERNAL_TOKEN: 'fixture-agent-secret' });
  for (const key of ['conversations', 'messages', 'contacts', 'testMessageContacts']) assert.equal(features[key], false);
  assert.equal(features.instanceTestMessage, true);
  assert.ok(!JSON.stringify(features).includes('secret'));
});

test('API ENV parser keeps explicit true/false and fallback semantics for every feature', () => {
  for (const [key, [name, fallback]] of Object.entries(MANAGER_FEATURE_DEFAULTS)) {
    for (const value of ['true', '1', 'yes', 'on', ' TRUE ']) assert.equal(managerFeatures({ [name]: value })[key], true);
    for (const value of ['false', '0', 'no', 'off', 't rue', 'invalid']) assert.equal(managerFeatures({ [name]: value })[key], false);
    for (const value of ['', ' ']) assert.equal(managerFeatures({ [name]: value })[key], fallback);
  }
});

test('standalone runtime follows the real API parser for every registered feature', () => {
  for (const value of [undefined, '', ' ', 'true', '1', 'yes', 'on', ' TRUE ', 'false', '0', 'no', 'off', 'invalid']) {
    const env = { AUTHENTICATION_API_KEY: 'fixture-not-for-browser', OPERATIONS_INTERNAL_TOKEN: 'fixture-agent-not-for-browser' };
    if (value !== undefined) for (const [name] of Object.values(MANAGER_FEATURE_DEFAULTS)) env[name] = value;
    const rendered = renderFeatures(env);
    assert.deepEqual(rendered.features, { studio: true, ...plain(managerFeatures(env)) });
    assert.ok(!rendered.script.includes(env.AUTHENTICATION_API_KEY));
    assert.ok(!rendered.script.includes(env.OPERATIONS_INTERNAL_TOKEN));
  }
});

test('standalone Manager exposes a sanitized application version', () => {
  const rendered = renderFeatures({ CONNECT_API_VERSION: '1.0.24' });
  assert.equal(rendered.appVersion, '1.0.24');

  const malicious = renderFeatures({ CONNECT_API_VERSION: '1.0.24";alert(1)//' });
  assert.equal(malicious.appVersion, 'develop');
  assert.doesNotMatch(malicious.script, /alert\(1\)/);
});

test('mixed standalone flags preserve independent overrides and match API output', () => {
  const env = { MANAGER_FEATURE_CONVERSATIONS: 'true', MANAGER_FEATURE_MESSAGES: 'false', MANAGER_FEATURE_CONTACTS: 'true', MANAGER_FEATURE_TEST_MESSAGE_CONTACTS: 'off', MANAGER_FEATURE_DOCS: ' ' };
  assert.deepEqual(renderFeatures(env).features, { studio: true, ...plain(managerFeatures(env)) });
});

test('Manager auth and privacy suites pass with only the standalone build context', { timeout: 60000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-manager-context-'));
  try {
    const app = path.join(directory, 'app');
    // Copy Manager files only, never synthesize ../src or copy API modules.
    fs.cpSync(manager, app, {
      recursive: true,
      filter: entry => !['node_modules', 'dist', '.git'].some(part => path.relative(manager, entry).split(path.sep).includes(part)),
    });
    assert.equal(fs.existsSync(path.join(directory, 'src')), false);
    // Tests use only TypeScript plus built-in Node modules; reuse the installed
    // compiler without downloading packages or changing the isolated sources.
    const modules = path.dirname(path.dirname(path.dirname(require.resolve('typescript'))));
    const env = { ...process.env, NODE_PATH: [modules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) };
    // A nested node --test must start its own runner, not inherit child-v8 mode.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/operations-auth.test.mjs', 'scripts/privacy-test-message.test.mjs'], {
      cwd: app, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024,
      env,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `Manager-only tests failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# fail 0\b/);
    assert.match(result.stdout, /# skipped 0\b/);
    assert.equal(fs.existsSync(path.join(directory, 'src')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
