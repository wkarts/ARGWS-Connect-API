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

test('release synchronization dispatches only development image workflows after publication', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/auto-version-release.yml'), 'utf8');
  assert.ok(source.includes('needs: [plan-version, version-source, release]'));
  assert.ok(source.includes('node .github/scripts/sync-release-version.mjs'));
  assert.ok(source.includes('gh workflow run ghcr-publish-application.yml --ref develop'));
  assert.ok(source.includes('gh workflow run ghcr-publish-docs.yml --ref develop'));
  assert.ok(source.includes('actions: write'));
  assert.doesNotMatch(source, /git push[^\n]*(?:--force|\s-f(?:\s|$))/);
});

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function releaseRepository(t) {
  const { dir } = fixture(t);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-release-remote-'));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  const docFiles = [
    'docs/openapi/connect-api.openapi.json', 'docs/openapi/meta-compatible.openapi.json',
    'docs/openapi/coverage.json', 'docs/asyncapi/connect-api-events.asyncapi.json',
  ];
  const updateDocs = (version, generatedAt = '2026-09-01T00:00:00.000Z') => {
    for (const file of docFiles) {
      const data = file.endsWith('coverage.json')
        ? { version, generatedAt, nativeRoutes: 10 }
        : { info: { version, title: 'preserve develop contract' }, paths: { '/existing': {} } };
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), `${JSON.stringify(data, null, 2)}\n`);
    }
  };
  updateDocs('1.0.21');
  git(dir, 'init', '--initial-branch=develop');
  git(dir, 'config', 'user.name', 'Release test');
  git(dir, 'config', 'user.email', 'release-test@example.invalid');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'initial');
  git(dir, 'branch', 'main');
  git(remote, 'init', '--bare');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', 'origin', 'develop', 'main');
  git(dir, 'checkout', 'main');
  assert.equal(runApply(dir, '1.0.22').status, 0);
  updateDocs('1.0.22', '2026-09-02T00:00:00.000Z');
  // The published date is deterministic even if synchronization is retried later.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'RELEASE-MANIFEST.json'), 'utf8'));
  manifest.revision_date = '2026-09-01';
  fs.writeFileSync(path.join(dir, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'release metadata');
  const releaseSha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'push', 'origin', 'main');
  git(dir, 'checkout', 'develop');
  return { dir, remote, releaseSha, docFiles };
}

function runSync(dir, releaseSha, version = '1.0.22') {
  return spawnSync(process.execPath, [path.join(root, '.github/scripts/sync-release-version.mjs'), releaseSha, version], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' },
  });
}

function remoteJson(dir, file) {
  return JSON.parse(git(dir, 'show', `origin/develop:${file}`));
}

test('released main safely fast-forwards an unchanged develop', (t) => {
  const { dir, releaseSha } = releaseRepository(t);
  const result = runSync(dir, releaseSha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, 'fast-forward');
  assert.equal(git(dir, 'rev-parse', 'origin/develop'), releaseSha);
});

test('divergent develop receives version fields while preserving new code, dependencies and contracts', (t) => {
  const { dir, releaseSha, docFiles } = releaseRepository(t);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.dependencies['new-develop-dependency'] = '2.0.0';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(dir, 'new-feature.txt'), 'new development must survive');
  for (const file of docFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (data.paths) data.paths['/new-develop-route'] = { get: { summary: 'keep this' } };
    else {
      data.nativeRoutes = 11;
      data.generatedAt = '2026-09-03T00:00:00.000Z';
    }
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feat: concurrent develop work');
  const before = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'push', 'origin', 'develop');
  const result = runSync(dir, releaseSha);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, 'metadata');
  assert.equal(git(dir, 'rev-parse', 'origin/develop^'), before);
  assert.equal(git(dir, 'show', 'origin/develop:new-feature.txt'), 'new development must survive');
  assert.equal(remoteJson(dir, 'package.json').dependencies['new-develop-dependency'], '2.0.0');
  assert.equal(remoteJson(dir, 'package.json').version, '1.0.22');
  assert.equal(remoteJson(dir, 'package-lock.json').packages[''].version, '1.0.22');
  assert.equal(remoteJson(dir, 'RELEASE-MANIFEST.json').revision_date, '2026-09-01');
  for (const file of docFiles) {
    const data = remoteJson(dir, file);
    if (data.paths) {
      assert.equal(data.info.version, '1.0.22');
      assert.equal(data.paths['/new-develop-route'].get.summary, 'keep this');
    } else {
      assert.equal(data.version, '1.0.22');
      assert.equal(data.nativeRoutes, 11);
      assert.equal(data.generatedAt, '2026-09-03T00:00:00.000Z');
    }
  }
  const allowed = ['VERSION', 'package.json', 'package-lock.json', 'RELEASE-MANIFEST.json', ...docFiles].sort();
  assert.deepEqual(git(dir, 'diff', '--name-only', before, summary.sha).split('\n').sort(), allowed);
  const second = runSync(dir, releaseSha);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).mode, 'aligned');
  assert.equal(git(dir, 'rev-parse', 'origin/develop'), summary.sha);
});

test('synchronization never downgrades an already newer develop version', (t) => {
  const { dir, releaseSha } = releaseRepository(t);
  assert.equal(runApply(dir, '1.1.0').status, 0);
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'newer version');
  const before = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'push', 'origin', 'develop');
  const result = runSync(dir, releaseSha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, 'superseded');
  assert.equal(JSON.parse(result.stdout).publish, false);
  assert.equal(git(dir, 'rev-parse', 'origin/develop'), before);
});

test('synchronization refuses a version that does not belong to the published commit', (t) => {
  const { dir, releaseSha } = releaseRepository(t);
  const before = git(dir, 'rev-parse', 'origin/develop');
  const result = runSync(dir, releaseSha, '9.9.9');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
  assert.equal(git(dir, 'rev-parse', 'origin/develop'), before);
});

test('promotion preview follows the same labels and Conventional Commit rules as publication', () => {
  for (const [labels, title, version] of [
    ['', 'fix: call acceptance', '1.1.2'],
    ['', 'feat(calls): new feature', '1.2.0'],
    ['version:patch', 'feat!: preserve explicit override', '1.1.2'],
    ['version:major', 'fix: forced major', '2.0.0'],
  ]) {
    const result = spawnSync(process.execPath, [planner, 'v1.1.1', labels, title], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).version, version);
  }
  const source = fs.readFileSync(path.join(root, '.github/workflows/release-contract.yml'), 'utf8');
  assert.ok(source.includes('edited, labeled, unlabeled'));
  assert.ok(source.includes('GITHUB_STEP_SUMMARY'));
  assert.ok(source.includes("github.head_ref == 'develop'"));
  assert.doesNotMatch(source, /contents: write|pull-requests: write|pull_request_target/);
});

test('a concurrent develop push is retained and synchronization retries without force', (t) => {
  const { dir, remote, releaseSha } = releaseRepository(t);
  const hooks = path.join(dir, '.git', 'test-hooks');
  fs.mkdirSync(hooks);
  const flag = path.join(hooks, 'concurrent-sha');
  // The pre-push hook simulates another developer committing after the fetch.
  const hook = `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const remote = ${JSON.stringify(remote)};
const flag = ${JSON.stringify(flag)};
if (!fs.existsSync(flag)) {
  const git = (...args) => execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' }).trim();
  const tip = git('rev-parse', 'refs/heads/develop');
  const tree = git('rev-parse', tip + '^{tree}');
  const next = git('-c', 'user.name=Concurrent developer', '-c', 'user.email=concurrent@example.invalid', 'commit-tree', tree, '-p', tip, '-m', 'concurrent change');
  git('update-ref', 'refs/heads/develop', next, tip);
  fs.writeFileSync(flag, next);
}
`;
  fs.writeFileSync(path.join(hooks, 'pre-push'), hook, { mode: 0o755 });
  git(dir, 'config', 'core.hooksPath', hooks);
  const result = runSync(dir, releaseSha);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /retrying synchronization/);
  const concurrentSha = fs.readFileSync(flag, 'utf8');
  assert.equal(git(dir, 'rev-parse', 'origin/develop^'), concurrentSha);
  assert.equal(remoteJson(dir, 'package.json').version, '1.0.22');
  assert.equal(JSON.parse(result.stdout).mode, 'metadata');
});

test('equal coverage contracts align their generated timestamp and allow the next promotion', (t) => {
  const { dir, releaseSha } = releaseRepository(t);
  const coverageFile = path.join(dir, 'docs/openapi/coverage.json');
  const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
  coverage.generatedAt = '2026-09-03T00:00:00.000Z';
  fs.writeFileSync(coverageFile, `${JSON.stringify(coverage, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'next-feature.txt'), 'preserve the next feature');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feat: next development with regenerated docs');
  git(dir, 'push', 'origin', 'develop');
  const result = runSync(dir, releaseSha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(remoteJson(dir, 'docs/openapi/coverage.json').generatedAt, '2026-09-02T00:00:00.000Z');
  git(dir, 'checkout', 'main');
  git(dir, 'merge', '--no-edit', 'origin/develop');
  assert.equal(fs.readFileSync(path.join(dir, 'next-feature.txt'), 'utf8'), 'preserve the next feature');
  assert.equal(git(dir, 'diff', '--name-only', releaseSha, 'HEAD'), 'next-feature.txt');
});

test('development images build the event commit on every component and architecture', () => {
  for (const file of ['ghcr-publish-application.yml', 'ghcr-publish-docs.yml']) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    assert.ok(source.includes('ref: ${{ github.sha }}'), file);
    assert.ok(source.includes('[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]'), file);
    assert.ok(source.includes('[[ "${GITHUB_REF}" == "refs/heads/develop" ]]'), file);
    assert.doesNotMatch(source, /ref: develop|branch --show-current/, file);
    assert.ok(source.includes('org.opencontainers.image.revision=${{ github.sha }}'), file);
  }
});
