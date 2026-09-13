'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { buildConnectVoip } = require('../scripts/build-connect-voip.cjs');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'src/api/integrations/channel/whatsapp/voip/engine');
const attribution = path.join(projectRoot, 'third-party/connect-voip');
function fixture(t, content = 'export const engine = "connect";\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-voip-build-'));
  const engine = path.join(root, 'src/api/integrations/channel/whatsapp/voip/engine');
  fs.mkdirSync(engine, { recursive: true });
  fs.writeFileSync(path.join(engine, 'index.js'), content);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, engine, build: () => buildConnectVoip({ projectRoot: root }) };
}

test('builds Connect source without any installed VoIP dependency', t => {
  const item = fixture(t);
  const result = item.build();
  assert.equal(result.files, 1);
  assert.equal(require(path.join(result.output, 'dist/index.js')).engine, 'connect');
});

test('build preserves installed dependency bytes and never invokes its scripts', t => {
  const item = fixture(t);
  const dependency = path.join(item.root, 'node_modules/@innovatorssoft/voip');
  fs.mkdirSync(dependency, { recursive: true });
  const marker = path.join(dependency, 'sentinel.js');
  fs.writeFileSync(marker, 'export const untouched = true;\n');
  const before = fs.statSync(marker).mtimeMs;
  item.build();
  assert.equal(fs.readFileSync(marker, 'utf8'), 'export const untouched = true;\n');
  assert.equal(fs.statSync(marker).mtimeMs, before);
});

test('the generated CommonJS and ESM entrypoints have equivalent exports', async t => {
  const item = fixture(t);
  const result = item.build();
  const cjs = require(path.join(result.output, 'dist/index.js'));
  const esm = await import(pathToFileURL(path.join(result.output, 'dist/esm/index.js')).href);
  assert.equal(cjs.engine, esm.engine);
});

test('nested relative imports execute in both output formats', async t => {
  const item = fixture(t, "export { engine } from './call/identity.js';\n");
  fs.mkdirSync(path.join(item.engine, 'call'));
  fs.writeFileSync(path.join(item.engine, 'call/identity.js'), 'export const engine = "connect";\n');
  const result = item.build();
  assert.equal(require(path.join(result.output, 'dist/index.js')).engine, 'connect');
  assert.equal((await import(pathToFileURL(path.join(result.output, 'dist/esm/index.js')).href)).engine, 'connect');
});

test('rebuilding removes stale generated modules while preserving source', t => {
  const item = fixture(t);
  const result = item.build();
  fs.writeFileSync(path.join(result.output, 'dist/stale.js'), 'stale');
  item.build();
  assert.ok(!fs.existsSync(path.join(result.output, 'dist/stale.js')));
  assert.equal(fs.readFileSync(path.join(item.engine, 'index.js'), 'utf8'), 'export const engine = "connect";\n');
});

test('invalid source is rejected before replacing the previous build', t => {
  const item = fixture(t);
  const result = item.build();
  const previous = fs.readFileSync(path.join(result.output, 'dist/index.js'), 'utf8');
  fs.writeFileSync(path.join(item.engine, 'index.js'), 'export const = ;');
  assert.throws(item.build, /Invalid Connect VoIP source/);
  assert.equal(fs.readFileSync(path.join(result.output, 'dist/index.js'), 'utf8'), previous);
});

test('missing entrypoint is rejected', t => {
  const item = fixture(t);
  fs.renameSync(path.join(item.engine, 'index.js'), path.join(item.engine, 'other.js'));
  assert.throws(item.build, /source is incomplete/);
});

test('source symlinks cannot copy content from outside the owned engine', t => {
  const item = fixture(t);
  const outside = path.join(item.root, 'outside.js');
  fs.writeFileSync(outside, 'export const outside = true;');
  fs.symlinkSync(outside, path.join(item.engine, 'linked.js'));
  assert.throws(item.build, /symbolic links/);
});

test('video adapter migration preserves the homologated voice install hook', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.postinstall, 'npm run patch:zapo-voip');
  assert.equal(pkg.scripts['patch:zapo-voip'], 'node scripts/apply-zapo-voip-patch.cjs');
  assert.ok(fs.existsSync(path.join(projectRoot, 'scripts/apply-zapo-voip-patch.cjs')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'patches/zapo-voip-1.0.0.json')));
});

test('the port keeps its upstream MIT notice and source provenance', () => {
  assert.match(fs.readFileSync(path.join(attribution, 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(path.join(attribution, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 vinikjkkj/);
  const provenance = JSON.parse(fs.readFileSync(path.join(attribution, 'PROVENANCE.json'), 'utf8'));
  assert.equal(provenance.sourceVersion, '1.0.0');
  assert.equal(provenance.connectBaselineVersion, '1.1.3');
  assert.equal(Object.keys(provenance.initialSourceSha256).length, 42);
});

test('engine runtime never imports the external VoIP implementation or private Zapo files', () => {
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(filename, 'utf8');
        assert.doesNotMatch(content, /(?:from\s*|import\s*\(|require\s*\()\s*['"]@innovatorssoft\/voip/);
        assert.doesNotMatch(content, /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:@innovatorssoft\/)?zapo-js\/(?:dist|src|internal)/);
      }
    }
  }
  visit(source);
});

test('voice regression fixtures keep the native engine default and allow isolated parity comparisons', () => {
  for (const filename of ['zapo-voip-signaling.test.cjs', 'zapo-voip-signal-loop.test.cjs', 'zapo-voip-incoming-accept.test.cjs']) {
    const content = fs.readFileSync(path.join(projectRoot, 'test', filename), 'utf8');
    assert.match(content, /ARGWS_VOIP_PACKAGE_ROOT/);
    assert.match(content, /require\.resolve\('@innovatorssoft\/voip'\)/);
  }
});

test('the Connect plugin owns a separate plugin identifier and exposes the existing voip API', () => {
  const wrapper = fs.readFileSync(path.join(source, '../connect-voip.plugin.ts'), 'utf8');
  assert.match(wrapper, /id: '@argws\/connect-voip'/);
  assert.match(wrapper, /exposeAs: 'voip'/);
  assert.match(wrapper, /new WaVoipCoordinator\(ctx, options\)/);
  assert.match(wrapper, /coordinator\.dispose\(\)/);
});

test('VoIP CI retains the homologated voice patch check', () => {
  const workflow = fs.readFileSync(path.join(projectRoot, '.github/workflows/zapo-voip-regression.yml'), 'utf8');
  assert.match(workflow, /npm run test:voip/);
  assert.match(workflow, /apply-zapo-voip-patch/);
});
