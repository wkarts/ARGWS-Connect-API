'use strict';

const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const smoke = path.resolve(__dirname, '../scripts/native-smoke.cjs');

test('native smoke has no JS engine dependency and retains real recognition assertions', () => {
  const source = readFileSync(smoke, 'utf8');
  const imports = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every((name) => name.startsWith('node:')), imports.join(', '));
  assert.match(source, /model checksum mismatch/);
  assert.match(source, /real JFK speech must be recognized/);
  assert.match(source, /same loaded process must survive both jobs/);
  assert.match(source, /pool exceeded configured cgroup memory/);
});

test('native smoke reaches checksum verification without loading third-party JS modules', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'native-smoke-deps-'));
  try {
    const model = path.join(directory, 'invalid-model.bin');
    const guard = path.join(directory, 'builtin-only.cjs');
    writeFileSync(model, 'invalid model used only for the checksum rejection test');
    writeFileSync(guard, `const Module = require('node:module');
const original = Module._load;
Module._load = function(id, parent, isMain) {
  if (!isMain && !id.startsWith('node:')) throw new Error('THIRD_PARTY_DEPENDENCY: ' + id);
  return original.apply(this, arguments);
};
`);
    const result = spawnSync(process.execPath, ['--require', guard, smoke], {
      env: { ...process.env, NODE_OPTIONS: '', SPEECH_WHISPER_MODEL_FILE: model,
        SPEECH_WHISPER_MODEL_SHA256: '0'.repeat(64) },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /model checksum mismatch/);
    assert.doesNotMatch(result.stderr, /THIRD_PARTY_DEPENDENCY|MODULE_NOT_FOUND/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
