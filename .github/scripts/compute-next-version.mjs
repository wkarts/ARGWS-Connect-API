#!/usr/bin/env node

/**
 * ARGWS Connect API release version planner.
 *
 * Rules:
 * - No existing vX.Y.Z tag => 1.0.0
 * - version:major label => major bump
 * - version:minor label => minor bump
 * - version:patch label => patch bump
 * - Conventional PR title with breaking marker => major
 * - Conventional PR title feat(...) / feat: => minor
 * - Any other merge => patch
 */

const [latestTagRaw = '', labelsRaw = '', prTitleRaw = ''] = process.argv.slice(2);
const initial = '1.0.0';

function parseTag(tag) {
  const normalized = String(tag || '').trim().replace(/^v/, '');
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bump(v, type) {
  if (type === 'major') return `${v.major + 1}.0.0`;
  if (type === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

const latest = parseTag(latestTagRaw);
if (!latest) {
  process.stdout.write(JSON.stringify({ version: initial, bump: 'initial', previous: null }));
  process.exit(0);
}

const labels = labelsRaw
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
const title = prTitleRaw.trim();

let type = 'patch';
if (labels.includes('version:major')) type = 'major';
else if (labels.includes('version:minor')) type = 'minor';
else if (labels.includes('version:patch')) type = 'patch';
else if (/^[a-z]+(?:\([^)]*\))?!:/.test(title) || /BREAKING[ -]CHANGE/i.test(title)) type = 'major';
else if (/^feat(?:\([^)]*\))?:/i.test(title)) type = 'minor';

process.stdout.write(
  JSON.stringify({
    version: bump(latest, type),
    bump: type,
    previous: `${latest.major}.${latest.minor}.${latest.patch}`,
  }),
);
