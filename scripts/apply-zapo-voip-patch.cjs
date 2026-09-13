'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const PACKAGE_NAME = '@innovatorssoft/voip';
const PACKAGE_VERSION = '1.0.0';
const MANIFEST_PATH = 'patches/zapo-voip-1.0.0.json';
const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');

function resolvePackageRoot(projectRoot) {
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  // Resolve the entrypoint: the package does not expose package.json as a subpath.
  let current = path.dirname(projectRequire.resolve(PACKAGE_NAME));
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (metadata.name === PACKAGE_NAME) {
        if (metadata.version !== PACKAGE_VERSION) {
          throw new Error(`Zapo VOIP patch requires ${PACKAGE_NAME}@${PACKAGE_VERSION}; found ${metadata.version}`);
        }
        return fs.realpathSync(current);
      }
    }
    current = path.dirname(current);
  }
  throw new Error(`Cannot locate metadata for ${PACKAGE_NAME}`);
}

function safeTarget(packageRoot, filePath) {
  if (
    typeof filePath !== 'string' ||
    !/^dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/.test(filePath) ||
    filePath.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe Zapo VOIP patch path: ${filePath}`);
  }
  const target = path.join(packageRoot, ...filePath.split('/'));
  const resolved = fs.realpathSync(target);
  const relative = path.relative(packageRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Zapo VOIP patch path escapes package: ${filePath}`);
  }
  if (!fs.lstatSync(target).isFile()) {
    throw new Error(`Zapo VOIP patch target must be a regular file: ${filePath}`);
  }
  return resolved;
}

function applyPatch({ projectRoot = path.resolve(__dirname, '..'), check = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, MANIFEST_PATH), 'utf8'));
  if (
    manifest.package !== PACKAGE_NAME ||
    manifest.version !== PACKAGE_VERSION ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error('Invalid Zapo VOIP patch manifest');
  }

  const packageRoot = resolvePackageRoot(projectRoot);
  const seen = new Set();
  const pending = [];
  // Validate every file and its resulting hash before writing any dependency file.
  for (const entry of manifest.files) {
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(entry.beforeSha256) ||
      !/^[a-f0-9]{64}$/.test(entry.afterSha256) ||
      entry.beforeSha256 === entry.afterSha256 ||
      !Array.isArray(entry.replacements) ||
      entry.replacements.length === 0
    ) {
      throw new Error('Invalid Zapo VOIP patch file definition');
    }
    const target = safeTarget(packageRoot, entry.path);
    if (seen.has(target)) throw new Error(`Duplicate Zapo VOIP patch target: ${entry.path}`);
    seen.add(target);
    for (const replacement of entry.replacements) {
      if (
        !replacement ||
        typeof replacement.before !== 'string' ||
        replacement.before.length === 0 ||
        typeof replacement.after !== 'string'
      ) {
        throw new Error(`Invalid Zapo VOIP replacement: ${entry.path}`);
      }
    }

    const current = fs.readFileSync(target);
    const currentHash = sha256(current);
    if (currentHash === entry.afterSha256) continue;
    if (currentHash !== entry.beforeSha256) {
      throw new Error(`Unexpected Zapo VOIP content in ${entry.path}; refusing to patch an unknown build`);
    }
    let updated = current.toString('utf8');
    for (const replacement of entry.replacements) {
      const position = updated.indexOf(replacement.before);
      if (position === -1 || updated.indexOf(replacement.before, position + replacement.before.length) !== -1) {
        throw new Error(`Zapo VOIP replacement must match exactly once: ${entry.path}`);
      }
      updated = updated.slice(0, position) + replacement.after + updated.slice(position + replacement.before.length);
    }
    if (sha256(updated) !== entry.afterSha256) {
      throw new Error(`Zapo VOIP patched hash mismatch: ${entry.path}`);
    }
    pending.push({ target, updated, mode: fs.statSync(target).mode });
  }

  if (check && pending.length > 0) {
    throw new Error(`Zapo VOIP patch missing from ${pending.length} file(s); run npm run patch:zapo-voip`);
  }
  const staged = [];
  try {
    for (const item of pending) {
      const temporary = `${item.target}.argws-${crypto.randomUUID()}.tmp`;
      staged.push(temporary);
      fs.writeFileSync(temporary, item.updated, { flag: 'wx', mode: item.mode });
    }
    for (let index = 0; index < pending.length; index += 1) {
      fs.renameSync(staged[index], pending[index].target);
    }
  } finally {
    for (const temporary of staged) fs.rmSync(temporary, { force: true });
  }
  return { package: PACKAGE_NAME, version: PACKAGE_VERSION, files: manifest.files.length, applied: pending.length };
}

if (require.main === module) {
  try {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.some((argument) => argument !== '--check')) {
      throw new Error('Usage: node scripts/apply-zapo-voip-patch.cjs [--check]');
    }
    const result = applyPatch({ check: argumentsList.includes('--check') });
    console.log(`Zapo VOIP patch OK (${result.version}, ${result.files} files verified, ${result.applied} applied)`);
  } catch (error) {
    console.error(`Zapo VOIP patch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { applyPatch };
