#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const [releaseSha, version] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(releaseSha || '') || !/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('Usage: node .github/scripts/sync-release-version.mjs RELEASE_SHA X.Y.Z');
}

const root = process.cwd();
const applyScript = fileURLToPath(new URL('./apply-version.mjs', import.meta.url));
const files = [
  'VERSION', 'package.json', 'package-lock.json', 'RELEASE-MANIFEST.json',
  'docs/openapi/connect-api.openapi.json', 'docs/openapi/meta-compatible.openapi.json',
  'docs/openapi/coverage.json', 'docs/asyncapi/connect-api-events.asyncapi.json',
];
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readVersion = (ref) => JSON.parse(git(['show', `${ref}:package.json`])).version;
const compare = (a, b) => {
  if (!/^\d+\.\d+\.\d+$/.test(a)) throw new Error(`Invalid branch version: ${a}`);
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
};
const report = (mode, sha) => {
  const result = { mode, sha, version, publish: mode !== 'superseded' };
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(JSON.stringify(result, null, 2));
};

// Every attempt starts from the current remote develop. A concurrent push is
// retried, never overwritten, and only this temporary worktree is cleaned up.
for (let attempt = 1; attempt <= 3; attempt++) {
  git(['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/develop:refs/remotes/origin/develop']);
  if (readVersion(releaseSha) !== version) throw new Error('Release commit does not match the planned version.');
  git(['merge-base', '--is-ancestor', releaseSha, 'origin/main']);
  const developSha = git(['rev-parse', 'origin/develop']);
  if (readVersion('origin/main') !== version || compare(readVersion(developSha), version) > 0) {
    report('superseded', developSha);
    break;
  }
  if (developSha === releaseSha) {
    report('aligned', developSha);
    break;
  }

  let fastForward = false;
  try { git(['merge-base', '--is-ancestor', developSha, releaseSha]); fastForward = true; } catch { /* Preserve divergent work. */ }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-release-sync-'));
  const worktree = path.join(temp, 'develop');
  let added = false;
  try {
    let targetSha = releaseSha;
    if (!fastForward) {
      git(['worktree', 'add', '--detach', worktree, developSha]);
      added = true;
      // Execute the trusted release script, without checking out main files over develop.
      execFileSync(process.execPath, [applyScript, version], { cwd: worktree, stdio: 'pipe' });
      const manifestPath = path.join(worktree, 'RELEASE-MANIFEST.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.revision_date = JSON.parse(git(['show', `${releaseSha}:RELEASE-MANIFEST.json`])).revision_date;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      for (const file of files.slice(4)) {
        const target = path.join(worktree, file);
        const data = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (file.endsWith('coverage.json')) {
          const released = JSON.parse(git(['show', `${releaseSha}:${file}`]));
          const contract = ({ version: _version, generatedAt: _generatedAt, ...rest }) => rest;
          // Equal contracts should not conflict on a generated timestamp during
          // the next promotion. New develop contracts retain their actual date.
          if (isDeepStrictEqual(contract(data), contract(released))) data.generatedAt = released.generatedAt;
          data.version = version;
        } else data.info.version = version;
        fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
      }
      git(['add', '--', ...files], worktree);
      const changed = git(['diff', '--cached', '--name-only'], worktree).split('\n').filter(Boolean);
      if (changed.some((file) => !files.includes(file))) throw new Error('Unexpected file in version synchronization.');
      if (changed.length === 0) {
        report('aligned', developSha);
        break;
      }
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        '-c', 'core.hooksPath=/dev/null', 'commit', '-m', `chore(release): sync develop with v${version} [skip release]`], worktree);
      targetSha = git(['rev-parse', 'HEAD'], worktree);
    }
    try {
      git(['push', 'origin', `${targetSha}:refs/heads/develop`]);
      report(fastForward ? 'fast-forward' : 'metadata', targetSha);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.error('develop changed or push failed; retrying synchronization from the remote branch.');
    }
  } finally {
    if (added) git(['worktree', 'remove', '--force', worktree]);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
