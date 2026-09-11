'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const applyScript = path.join(root, '.github/scripts/apply-version.mjs');
const planner = path.join(root, '.github/scripts/compute-next-version.mjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-release-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pkg = { name: 'release-test', version: '1.0.21', dependencies: { 'zapo-js': '1.6.3' } };
  const lock = { version: '1.0.21', lockfileVersion: 3, packages: { '': { ...pkg }, 'node_modules/zapo-js': { version: '1.6.3', integrity: 'test-integrity' } } };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
  fs.writeFileSync(path.join(dir, 'RELEASE-MANIFEST.json'), JSON.stringify({ version: '1.0.21', other: 'preserved' }));
  fs.writeFileSync(path.join(dir, 'VERSION'), '1.0.21\n');
  const sentinels = {
    'deploy/canonical/env.example': 'ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:1.0.21\n',
    'deploy/canonical/compose.yaml': 'services:\n  api:\n    image: ghcr.io/wkarts/argws-connect-api:1.0.21\n',
    'deploy/production/.env': 'EXISTING_INSTALLATION=unchanged\n',
    'volumes/instances/session.json': '{"test":"untouched"}',
    '.github/workflows/example.yml': 'name: unchanged\n',
  };
  for (const [name, value] of Object.entries(sentinels)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), value);
  }
  return { dir, pkg, lock, sentinels };
}

function runApply(dir, version) {
  return spawnSync(process.execPath, [applyScript, version], { cwd: dir, encoding: 'utf8' });
}

test('new release updates only version metadata and preserves the historical deployment', (t) => {
  const { dir, pkg, lock, sentinels } = fixture(t);
  const result = runApply(dir, '1.0.22');
  assert.equal(result.status, 0, result.stderr);
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.equal(read('package.json').version, '1.0.22');
  assert.equal(read('package-lock.json').version, '1.0.22');
  assert.equal(read('package-lock.json').packages[''].version, '1.0.22');
  assert.deepEqual(read('package.json').dependencies, pkg.dependencies);
  assert.deepEqual(read('package-lock.json').packages['node_modules/zapo-js'], lock.packages['node_modules/zapo-js']);
  assert.equal(read('RELEASE-MANIFEST.json').other, 'preserved');
  assert.equal(fs.readFileSync(path.join(dir, 'VERSION'), 'utf8'), '1.0.22\n');
  for (const [name, value] of Object.entries(sentinels)) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), value, name);
});

test('reapplying the same release is idempotent', (t) => {
  const { dir } = fixture(t);
  assert.equal(runApply(dir, '1.0.22').status, 0);
  const files = ['package.json', 'package-lock.json', 'VERSION'];
  const before = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
  assert.equal(runApply(dir, '1.0.22').status, 0);
  files.forEach((name, i) => assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), before[i]));
});

test('invalid versions are rejected before any metadata changes', (t) => {
  const { dir } = fixture(t);
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  for (const version of ['', 'latest', 'develop', '../1.0.22', '1.0.22\ninvalid']) {
    assert.notEqual(runApply(dir, version).status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
  }
});

test('existing version planner selects 1.0.22 for the main release promotion', () => {
  const result = spawnSync(process.execPath, [planner, 'v1.0.21', '', 'release: publicar Connect|API v1.0.22'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: '1.0.22', bump: 'patch', previous: '1.0.21' });
});

test('release workflow retains main-only publication, three components and scoped credentials', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/auto-version-release.yml'), 'utf8');
  assert.ok(source.includes('refs/heads/main'));
  assert.ok(source.includes("NODE_VERSION: '22.x'"));
  assert.ok(source.includes('component: [api, manager, docs]'));
  assert.ok(source.includes('MANAGER_BUILD_MODE=production'));
  assert.ok(source.includes('packages: write'));
  assert.ok(source.includes('argws-connect-buildkit:buildx-stable-1'));
  assert.ok(source.includes('Release metadata must never modify workflows.'));
  assert.doesNotMatch(source, /git push[^\n]*(?:--force|\s-f(?:\s|$))/);
});
