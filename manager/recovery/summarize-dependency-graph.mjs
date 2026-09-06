import fs from 'node:fs';
import path from 'node:path';

const [graphFile, outputFile, limitArg = '120'] = process.argv.slice(2);

if (!graphFile || !outputFile) {
  console.error('Usage: node summarize-dependency-graph.mjs <graph.json> <output.json> [limit]');
  process.exit(1);
}

const limit = Math.max(1, Number.parseInt(limitArg, 10) || 120);
const graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));

const recoveredSymbols = new Set(Object.keys(graph.graph ?? {}));
const noisyRuntimeSymbols = new Set([
  'i', // JSX runtime alias in the legacy bundle
  'y', // React alias in the legacy bundle
]);

const candidates = (graph.candidateDependencies ?? []).map((candidate) => ({
  ...candidate,
  category: noisyRuntimeSymbols.has(candidate.symbol) ? 'runtime' : 'application-or-library',
}));

const applicationCandidates = candidates
  .filter((candidate) => candidate.category !== 'runtime')
  .slice(0, limit);

const runtimeCandidates = candidates
  .filter((candidate) => candidate.category === 'runtime')
  .slice(0, limit);

const report = {
  generatedAt: new Date().toISOString(),
  sourceGraph: path.normalize(graphFile),
  analysisMode: graph.analysisMode ?? null,
  recoveredSymbolCount: recoveredSymbols.size,
  totalCandidates: candidates.length,
  limit,
  applicationCandidates,
  runtimeCandidates,
  unresolvedExternalIdentifiers: (graph.unresolvedExternalIdentifiers ?? []).slice(0, limit),
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Dependency candidate summary written to ${outputFile}`);
console.log(`Application/library candidates: ${applicationCandidates.length}`);
console.log(`Runtime candidates: ${runtimeCandidates.length}`);
