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

// Read all metadata before writing. Release changes versions, not dependencies,
// installed configuration, historical deployments, workflows, or session data.
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const manifest = fs.existsSync('RELEASE-MANIFEST.json') ? readJson('RELEASE-MANIFEST.json') : null;

pkg.version = version;
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
writeJson('package.json', pkg);
writeJson('package-lock.json', lock);

if (manifest) {
  manifest.version = version;
  manifest.revision_date = new Date().toISOString().slice(0, 10);
  writeJson('RELEASE-MANIFEST.json', manifest);
}

fs.writeFileSync('VERSION', `${version}\n`);

// deploy/canonical is the frozen 1.0.21 fallback, not a moving release template.
// New deployments use the active production layout with :latest or an explicit
// immutable version/digest override. Existing tags and canonical files stay intact.
console.log(`Connect|API version set to ${version}`);
console.log('Production tracks :latest; explicit SemVer image overrides remain supported.');
console.log('Frozen canonical deployment and historical release tags preserved.');
