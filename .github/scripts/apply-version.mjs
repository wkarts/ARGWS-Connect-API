#!/usr/bin/env node

import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node .github/scripts/apply-version.mjs X.Y.Z');
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const pkg = readJson('package.json');
pkg.version = version;
writeJson('package.json', pkg);

const lock = readJson('package-lock.json');
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
writeJson('package-lock.json', lock);

if (fs.existsSync('RELEASE-MANIFEST.json')) {
  const manifest = readJson('RELEASE-MANIFEST.json');
  manifest.version = version;
  manifest.revision_date = new Date().toISOString().slice(0, 10);
  writeJson('RELEASE-MANIFEST.json', manifest);
}

fs.writeFileSync('VERSION', `${version}\n`);
console.log(`ARGWS Connect API version set to ${version}`);
console.log('Production tracks :latest. Canonical is an independent deployment pinned explicitly to a stable SemVer.');
