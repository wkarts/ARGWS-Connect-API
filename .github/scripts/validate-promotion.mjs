#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const [baseSha, headSha] = process.argv.slice(2);
if (!baseSha || !headSha) {
  console.error('Usage: validate-promotion.mjs <base-sha> <head-sha>');
  process.exit(2);
}

const allowGovernance = String(process.env.ALLOW_GOVERNANCE_CHANGES || '').toLowerCase() === 'true';
const run = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const readAt = (sha, path) => {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8' });
  } catch {
    return null;
  }
};

const changed = run('diff', '--name-only', `${baseSha}...${headSha}`)
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean);

const errors = [];
const notes = [];

const governancePaths = changed.filter(
  (path) =>
    path.startsWith('.github/workflows/') ||
    path.startsWith('.github/actions/') ||
    path === '.github/scripts/compute-next-version.mjs' ||
    path === '.github/scripts/apply-version.mjs' ||
    path === '.github/CODEOWNERS',
);

if (governancePaths.length > 0 && !allowGovernance) {
  errors.push(
    `Canonical governance files changed without label governance:ci: ${governancePaths.join(', ')}`,
  );
}

for (const immutable of ['VERSION', 'RELEASE-MANIFEST.json']) {
  if (changed.includes(immutable)) {
    errors.push(`${immutable} is release-owned and cannot be modified by a pull request to main.`);
  }
}

const compareJsonField = (path, selector, label) => {
  if (!changed.includes(path)) return;
  const beforeRaw = readAt(baseSha, path);
  const afterRaw = readAt(headSha, path);
  if (!beforeRaw || !afterRaw) return;

  try {
    const before = selector(JSON.parse(beforeRaw));
    const after = selector(JSON.parse(afterRaw));
    if (before !== after) {
      errors.push(`${label} changed in ${path} (${before ?? '<empty>'} -> ${after ?? '<empty>'}).`);
    }
  } catch (error) {
    errors.push(`Unable to validate release-owned field in ${path}: ${error.message}`);
  }
};

compareJsonField('package.json', (value) => value.version, 'package version');
compareJsonField('package-lock.json', (value) => value.version, 'package-lock version');
compareJsonField(
  'package-lock.json',
  (value) => value.packages?.['']?.version,
  'package-lock root package version',
);

const extractEnv = (raw, key) => {
  if (!raw) return null;
  const line = raw
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : null;
};

if (changed.includes('deploy/canonical/env.example')) {
  const before = extractEnv(readAt(baseSha, 'deploy/canonical/env.example'), 'ARGWS_CONNECT_API_IMAGE');
  const after = extractEnv(readAt(headSha, 'deploy/canonical/env.example'), 'ARGWS_CONNECT_API_IMAGE');
  if (before !== after) {
    errors.push(
      `deploy/canonical/env.example image version is release-owned (${before ?? '<empty>'} -> ${after ?? '<empty>'}).`,
    );
  }
}

const extractCanonicalImage = (raw) => {
  if (!raw) return null;
  const match = raw.match(/ghcr\.io\/wkarts\/argws-connect-api:([0-9]+\.[0-9]+\.[0-9]+)/);
  return match?.[1] ?? null;
};

if (changed.includes('deploy/canonical/compose.yaml')) {
  const before = extractCanonicalImage(readAt(baseSha, 'deploy/canonical/compose.yaml'));
  const after = extractCanonicalImage(readAt(headSha, 'deploy/canonical/compose.yaml'));
  if (before !== after) {
    errors.push(
      `deploy/canonical/compose.yaml image version is release-owned (${before ?? '<empty>'} -> ${after ?? '<empty>'}).`,
    );
  }
}

if (governancePaths.length > 0 && allowGovernance) {
  notes.push(`Governance change explicitly authorized: ${governancePaths.join(', ')}`);
}

console.log(`Promotion Guard checked ${changed.length} changed file(s).`);
for (const note of notes) console.log(`NOTICE: ${note}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('Promotion Guard OK: release-owned metadata and canonical governance are protected.');
