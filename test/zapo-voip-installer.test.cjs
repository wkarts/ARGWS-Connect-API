'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { applyPatch } = require('../scripts/apply-zapo-voip-patch.cjs');

const hash = (content) => crypto.createHash('sha256').update(content).digest('hex');

function fixture(t, { version = '1.0.0' } = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'argws-voip-patch-'));
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }));
  const packageRoot = path.join(projectRoot, 'node_modules/@innovatorssoft/voip');
  fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'patches'));
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}');
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@innovatorssoft/voip', version, exports: { '.': './dist/index.js' } }),
  );
  fs.writeFileSync(path.join(packageRoot, 'dist/index.js'), '// fixture entrypoint\n');

  const originals = ['exports.route = "old-route";\n', 'exports.session = "old-session";\n'];
  const updated = ['exports.route = "safe-route";\n', 'exports.session = "safe-session";\n'];
  const files = ['dist/router.js', 'dist/session.js'];
  const manifest = {
    package: '@innovatorssoft/voip',
    version: '1.0.0',
    files: files.map((filePath, index) => ({
      path: filePath,
      beforeSha256: hash(originals[index]),
      afterSha256: hash(updated[index]),
      replacements: [{ before: originals[index], after: updated[index] }],
    })),
  };
  const writeManifest = () =>
    fs.writeFileSync(path.join(projectRoot, 'patches/zapo-voip-1.0.0.json'), JSON.stringify(manifest));
  const write = (index, content) => fs.writeFileSync(path.join(packageRoot, files[index]), content);
  const read = (index) => fs.readFileSync(path.join(packageRoot, files[index]), 'utf8');
  originals.forEach((content, index) => write(index, content));
  writeManifest();
  return { projectRoot, packageRoot, originals, updated, manifest, writeManifest, read, write };
}

test('applies to a package that does not export package.json and verifies idempotently', (t) => {
  const data = fixture(t);
  assert.equal(applyPatch(data).applied, 2);
  assert.equal(data.read(0), data.updated[0]);
  assert.equal(data.read(1), data.updated[1]);
  assert.equal(applyPatch(data).applied, 0);
  assert.equal(applyPatch({ ...data, check: true }).applied, 0);
});

test('check mode fails for an unapplied patch without mutating files', (t) => {
  const data = fixture(t);
  assert.throws(() => applyPatch({ ...data, check: true }), /patch missing/);
  assert.equal(data.read(0), data.originals[0]);
  assert.equal(data.read(1), data.originals[1]);
});

test('rejects a different dependency version without changing its files', (t) => {
  const data = fixture(t, { version: '1.0.1' });
  assert.throws(() => applyPatch(data), /requires @innovatorssoft\/voip@1.0.0; found 1.0.1/);
  assert.equal(data.read(0), data.originals[0]);
});

test('validates every input before writing even when the last file has drifted', (t) => {
  const data = fixture(t);
  data.write(1, '// unknown package build\n');
  assert.throws(() => applyPatch(data), /refusing to patch an unknown build/);
  assert.equal(data.read(0), data.originals[0]);
  assert.equal(data.read(1), '// unknown package build\n');
});

test('validates every resulting hash before writing any file', (t) => {
  const data = fixture(t);
  data.manifest.files[1].afterSha256 = hash('incorrect expected output');
  data.writeManifest();
  assert.throws(() => applyPatch(data), /patched hash mismatch/);
  assert.equal(data.read(0), data.originals[0]);
  assert.equal(data.read(1), data.originals[1]);
});

test('resumes a partially applied patch with the original and corrected hashes', (t) => {
  const data = fixture(t);
  data.write(0, data.updated[0]);
  assert.equal(applyPatch(data).applied, 1);
  assert.equal(data.read(0), data.updated[0]);
  assert.equal(data.read(1), data.updated[1]);
});

test('rejects ambiguous replacement matches', (t) => {
  const data = fixture(t);
  const content = 'old old\n';
  data.write(1, content);
  Object.assign(data.manifest.files[1], {
    beforeSha256: hash(content),
    afterSha256: hash('new old\n'),
    replacements: [{ before: 'old', after: 'new' }],
  });
  data.writeManifest();
  assert.throws(() => applyPatch(data), /must match exactly once/);
  assert.equal(data.read(0), data.originals[0]);
});

test('rejects duplicate target files before writing', (t) => {
  const data = fixture(t);
  data.manifest.files.push(data.manifest.files[0]);
  data.writeManifest();
  assert.throws(() => applyPatch(data), /Duplicate Zapo VOIP patch target/);
  assert.equal(data.read(0), data.originals[0]);
});

for (const unsafePath of ['../package.json', 'dist/../../outside.js', '/tmp/outside.js', 'dist\\outside.js']) {
  test(`rejects unsafe manifest path ${unsafePath}`, (t) => {
    const data = fixture(t);
    data.manifest.files[1].path = unsafePath;
    data.writeManifest();
    assert.throws(() => applyPatch(data), /Unsafe Zapo VOIP patch path/);
    assert.equal(data.read(0), data.originals[0]);
  });
}

test('rejects a directory symlink that escapes the dependency root', (t) => {
  const data = fixture(t);
  const outside = path.join(data.projectRoot, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'session.js'), data.originals[1]);
  fs.symlinkSync(outside, path.join(data.packageRoot, 'dist/linked'), 'junction');
  data.manifest.files[1].path = 'dist/linked/session.js';
  data.writeManifest();
  assert.throws(() => applyPatch(data), /path escapes package/);
  assert.equal(data.read(0), data.originals[0]);
  assert.equal(fs.readFileSync(path.join(outside, 'session.js'), 'utf8'), data.originals[1]);
});

test('fails check mode if a corrected file is subsequently altered', (t) => {
  const data = fixture(t);
  applyPatch(data);
  data.write(1, `${data.updated[1]}// unexpected edit\n`);
  assert.throws(() => applyPatch({ ...data, check: true }), /refusing to patch an unknown build/);
});
