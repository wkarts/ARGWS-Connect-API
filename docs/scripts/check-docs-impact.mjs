import { execFileSync } from 'node:child_process';

const baseRef = process.env.DOCS_BASE_REF;
const exempt = String(process.env.DOCS_IMPACT_EXEMPT || '').toLowerCase() === 'true';

if (!baseRef) {
  console.log('[docs] DOCS_BASE_REF not set; impact guard skipped.');
  process.exit(0);
}

const output = execFileSync('git', ['diff', '--name-only', `origin/${baseRef}...HEAD`], { encoding: 'utf8' });
const files = output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

const publicImpactPatterns = [
  /^src\/api\/routes\//,
  /^src\/api\/controllers\//,
  /^src\/api\/dto\//,
  /^src\/api\/compat\//,
  /^src\/api\/integrations\//,
  /^src\/api\/types\//,
  /^config\//,
  /^validate\//,
  /^docker-compose[^/]*\.ya?ml$/,
  /^Dockerfile/,
  /^\.env\.example$/,
];

const publicChanges = files.filter((file) => publicImpactPatterns.some((pattern) => pattern.test(file)));
if (publicChanges.length === 0) {
  console.log('[docs] No public/integration-facing changes detected.');
  process.exit(0);
}

const docsChanged = files.some((file) => file.startsWith('docs/'));
if (docsChanged) {
  console.log(`[docs] Documentation impact satisfied (${publicChanges.length} public file(s), docs updated).`);
  process.exit(0);
}

if (exempt) {
  console.log('[docs] Documentation impact explicitly exempted by PR body: DOCS IMPACT: NONE.');
  process.exit(0);
}

console.error('[docs] Public/integration-facing changes detected without docs update.');
for (const file of publicChanges) console.error(` - ${file}`);
console.error('Update docs/** or add "DOCS IMPACT: NONE" with an objective reason to the PR body.');
process.exit(1);
