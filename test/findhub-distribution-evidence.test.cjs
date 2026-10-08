'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyDistribution, emitEvidence } = require('../scripts/verify-findhub-distribution.cjs');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'findhub-evidence-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  const directory = path.join(sourceRoot, 'distribution');
  const write = (name, data) => {
    const file = path.join(sourceRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  const manifest = { version: '1.2.3', key: Buffer.from('fixture public identity').toString('base64') };
  const revision = 'a'.repeat(40), channel = 'candidate';
  const iconSource = 'public/branding/connect-api/core/connect-api-app-icon-dark.png';
  write('browser-extensions/findhub-auth/manifest.json', JSON.stringify(manifest));
  write(iconSource, 'fixture icon');
  write('public/findhub-auth.zip', 'fixture exact ZIP bytes');
  const names = ['Connect-FindHub-Auth-1.2.3.zip', 'Connect-FindHub-Auth-Setup-1.2.3.exe',
    'Connect-FindHub-Auth-Assistant-1.2.3-windows-x64.exe', 'extension-release.json'];
  const exe = Buffer.alloc(1024);
  exe.write('MZ'); exe.writeUInt32LE(128, 0x3c); exe.write('PE\0\0', 128); exe.writeUInt16LE(0x8664, 132);
  write(`distribution/${names[0]}`, 'fixture exact ZIP bytes');
  write(`distribution/${names[1]}`, exe);
  write(`distribution/${names[2]}`, exe);
  const metadata = {
    schema: 1, version: manifest.version, channel, sourceRevision: revision,
    extensionId: sha256(Buffer.from(manifest.key, 'base64')).slice(0, 32)
      .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16))),
    zip: { file: names[0], sha256: sha256('fixture exact ZIP bytes') },
    windows: { file: names[1], sha256: sha256(exe), signed: false, scope: 'current-user', browserApprovalRequired: true },
    assistant: { file: names[2], sha256: sha256(exe), language: 'rust', architecture: 'x64',
      signed: false, browserApprovalRequired: true },
    iconSource, iconSha256: sha256('fixture icon'),
  };
  const checksums = () => write('distribution/SHA256SUMS.txt',
    names.map(name => `${sha256(fs.readFileSync(path.join(directory, name)))}  ${name}`).join('\n') + '\n');
  const finalize = () => { write('distribution/extension-release.json', JSON.stringify(metadata)); checksums(); };
  finalize();
  return { sourceRoot, directory, revision, channel, names, metadata, write, checksums, finalize,
    verify: () => verifyDistribution({ sourceRoot, directory, revision, channel }) };
}

test('read-only receipt covers five delivered files with exact bytes, SHA256 and source identity', t => {
  const f = fixture(t);
  const before = Object.fromEntries(fs.readdirSync(f.directory).map(name =>
    [name, fs.readFileSync(path.join(f.directory, name))]));
  const receipt = f.verify();
  assert.equal(receipt.fileCount, 5);
  assert.equal(receipt.sourceRevision, f.revision);
  assert.equal(receipt.extensionId, f.metadata.extensionId);
  for (const item of receipt.inventory) {
    assert.equal(item.sha256, sha256(before[item.file]));
    assert.equal(item.bytes, before[item.file].length);
    assert.deepEqual(fs.readFileSync(path.join(f.directory, item.file)), before[item.file]);
  }
  const summary = path.join(f.sourceRoot, 'summary.md');
  fs.writeFileSync(summary, 'Previous step\n');
  emitEvidence(receipt, summary);
  const text = fs.readFileSync(summary, 'utf8');
  assert.ok(text.startsWith('Previous step\n'));
  assert.ok(text.includes(f.revision));
  for (const item of receipt.inventory) { assert.ok(text.includes(item.file)); assert.ok(text.includes(item.sha256)); }
});

test('rejects missing or corrupted binaries without repairing output', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, f.names[1]), 'broken executable');
  assert.throws(f.verify, /metadata checksum mismatch/);
  assert.equal(fs.readFileSync(path.join(f.directory, f.names[1]), 'utf8'), 'broken executable');
  fs.unlinkSync(path.join(f.directory, f.names[1]));
  assert.throws(f.verify, /ENOENT/);
});

for (const field of ['sourceRevision', 'channel', 'version', 'extensionId']) {
  test(`rejects altered ${field} even when metadata checksums are recomputed`, t => {
    const f = fixture(t); f.metadata[field] = 'wrong'; f.finalize();
    assert.throws(f.verify, /provenance mismatch/);
  });
}

test('rejects ZIP drift despite recomputed checksums and metadata', t => {
  const f = fixture(t);
  f.write(`distribution/${f.names[0]}`, 'different ZIP bytes');
  f.metadata.zip.sha256 = sha256('different ZIP bytes'); f.finalize();
  assert.throws(f.verify, /does not match source ZIP/);
});

test('requires finalized executable hashes and the existing x64 binary contract', t => {
  const f = fixture(t);
  delete f.metadata.assistant.sha256; f.finalize();
  assert.throws(f.verify, /metadata checksum mismatch/);
  const data = fs.readFileSync(path.join(f.directory, f.names[2]));
  data.writeUInt16LE(0x14c, 132);
  f.write(`distribution/${f.names[2]}`, data); f.metadata.assistant.sha256 = sha256(data); f.finalize();
  assert.throws(f.verify, /not a Windows x64 PE/);
});

for (const variant of ['missing', 'duplicate', 'traversal', 'wrong hash']) {
  test(`rejects ${variant} checksum entry`, t => {
    const f = fixture(t), file = path.join(f.directory, 'SHA256SUMS.txt');
    let lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    if (variant === 'missing') lines.pop();
    if (variant === 'duplicate') lines.push(lines[0]);
    if (variant === 'traversal') lines[0] = lines[0].replace(f.names[0], `../${f.names[0]}`);
    if (variant === 'wrong hash') lines[0] = `${'b'.repeat(64)}  ${f.names[0]}`;
    fs.writeFileSync(file, lines.join('\n') + '\n');
    assert.throws(f.verify, /checksum inventory|SHA256SUMS mismatch/);
  });
}

test('rejects stale wildcard assets that would otherwise be uploaded', t => {
  const f = fixture(t);
  f.write('distribution/Connect-FindHub-Auth-0.0.1.zip', 'stale zip');
  assert.throws(f.verify, /Unexpected distribution asset/);
});
