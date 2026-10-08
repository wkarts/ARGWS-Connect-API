'use strict';
// Read-only verification: never regenerate assets while evaluating their evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const readFile = file => {
  requireValue(fs.lstatSync(file).isFile(), `Not a regular distribution file: ${path.basename(file)}`);
  return fs.readFileSync(file);
};

function verifyDistribution({ sourceRoot, directory, revision, channel }) {
  requireValue(/^[0-9a-f]{40}$/.test(revision) && ['candidate', 'develop', 'stable'].includes(channel),
    'Invalid expected build identity');
  const manifest = JSON.parse(readFile(path.join(sourceRoot, 'browser-extensions/findhub-auth/manifest.json')));
  const version = manifest.version;
  requireValue(/^\d+\.\d+\.\d+$/.test(version) && typeof manifest.key === 'string' && manifest.key.length > 0,
    'Invalid source extension identity');
  const extensionId = sha256(Buffer.from(manifest.key, 'base64')).slice(0, 32)
    .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  const names = {
    zip: `Connect-FindHub-Auth-${version}.zip`,
    windows: `Connect-FindHub-Auth-Setup-${version}.exe`,
    assistant: `Connect-FindHub-Auth-Assistant-${version}-windows-x64.exe`,
  };
  const assetNames = [...Object.values(names), 'extension-release.json'];
  const deliveredNames = [...assetNames, 'SHA256SUMS.txt'];
  for (const file of fs.readdirSync(directory)) {
    if (/^Connect-FindHub-Auth-.*\.(zip|exe)$/.test(file)) {
      requireValue(deliveredNames.includes(file), `Unexpected distribution asset: ${file}`);
    }
  }
  const buffers = Object.fromEntries(deliveredNames.map(name => [name, readFile(path.join(directory, name))]));
  const metadata = JSON.parse(buffers['extension-release.json']);
  requireValue(metadata.schema === 1 && metadata.version === version && metadata.extensionId === extensionId
    && metadata.sourceRevision === revision && metadata.channel === channel, 'Distribution provenance mismatch');
  for (const [kind, name] of Object.entries(names)) {
    requireValue(metadata[kind]?.file === name && metadata[kind]?.sha256 === sha256(buffers[name]),
      `Distribution metadata checksum mismatch: ${kind}`);
  }
  requireValue(metadata.windows.signed === false && metadata.windows.scope === 'current-user'
    && metadata.windows.browserApprovalRequired === true && metadata.assistant.language === 'rust'
    && metadata.assistant.architecture === 'x64' && metadata.assistant.signed === false
    && metadata.assistant.browserApprovalRequired === true, 'Distribution Windows contract mismatch');
  const iconSource = 'public/branding/connect-api/core/connect-api-app-icon-dark.png';
  requireValue(metadata.iconSource === iconSource
    && metadata.iconSha256 === sha256(readFile(path.join(sourceRoot, iconSource))), 'Icon provenance mismatch');
  requireValue(buffers[names.zip].equals(readFile(path.join(sourceRoot, 'public/findhub-auth.zip'))),
    'Distribution ZIP does not match source ZIP');
  for (const kind of ['windows', 'assistant']) {
    const exe = buffers[names[kind]];
    requireValue(exe.length >= 1024 && exe[0] === 77 && exe[1] === 90, `Invalid Windows executable: ${kind}`);
  }
  const assistant = buffers[names.assistant];
  const pe = assistant.readUInt32LE(0x3c);
  requireValue(pe + 6 <= assistant.length && assistant.toString('ascii', pe, pe + 4) === 'PE\0\0'
    && assistant.readUInt16LE(pe + 4) === 0x8664, 'Rust assistant is not a Windows x64 PE');
  const checksums = new Map();
  for (const line of buffers['SHA256SUMS.txt'].toString('utf8').trimEnd().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    requireValue(match && assetNames.includes(match[2]) && !checksums.has(match[2]), 'Invalid checksum inventory');
    checksums.set(match[2], match[1]);
  }
  requireValue(checksums.size === assetNames.length, 'Incomplete checksum inventory');
  for (const name of assetNames) {
    requireValue(checksums.get(name) === sha256(buffers[name]), `SHA256SUMS mismatch: ${name}`);
  }
  return {
    schema: 1, kind: 'findhub-distribution', sourceRevision: revision, channel, version, extensionId,
    fileCount: deliveredNames.length,
    inventory: deliveredNames.map(file => ({ file, bytes: buffers[file].length, sha256: sha256(buffers[file]) })),
  };
}

function emitEvidence(receipt, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  console.log(JSON.stringify(receipt));
  if (summaryPath) {
    const lines = ['### Find Hub distribution verified', '', `Source revision: \`${receipt.sourceRevision}\``, '',
      `Channel: \`${receipt.channel}\`; version: \`${receipt.version}\`; extension ID: \`${receipt.extensionId}\`.`,
      'Verified source identity, exact extension ZIP, Windows binary headers and all release checksums.', '',
      '| File | Bytes | SHA256 |', '| --- | ---: | --- |',
      ...receipt.inventory.map(item => `| \`${item.file}\` | ${item.bytes} | \`${item.sha256}\` |`)];
    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`);
  }
}

if (require.main === module) {
  const sourceRoot = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const revision = option('--revision', head);
  requireValue(revision === head, 'Source revision does not match checkout HEAD');
  emitEvidence(verifyDistribution({ sourceRoot,
    directory: path.resolve(option('--directory', path.join(sourceRoot, 'build/findhub-extension'))),
    revision, channel: option('--channel', 'candidate') }));
}

module.exports = { verifyDistribution, emitEvidence };
