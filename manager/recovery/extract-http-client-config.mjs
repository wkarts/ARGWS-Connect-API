import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const [inputFile, outputDir] = process.argv.slice(2);

if (!inputFile || !outputDir) {
  console.error('Usage: node extract-http-client-config.mjs <input.js> <output-dir>');
  process.exit(1);
}

const source = fs.readFileSync(inputFile, 'utf8');
const ast = parse(source, {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  errorRecovery: false,
});

const clientSymbols = new Set(['sn', 'bd', 'Ee']);
const interestingTokens = ['interceptors', 'defaults', 'baseURL', 'headers', 'apikey'];
const matches = [];
const visited = new Set();

const collectIdentifiers = (node, output = new Set(), localVisited = new Set()) => {
  if (!node || typeof node !== 'object' || localVisited.has(node)) return output;
  localVisited.add(node);

  if (node.type === 'Identifier') output.add(node.name);

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) collectIdentifiers(child, output, localVisited);
    } else if (value && typeof value === 'object') {
      collectIdentifiers(value, output, localVisited);
    }
  }

  return output;
};

const inspectStatement = (node) => {
  if (!Number.isInteger(node.start) || !Number.isInteger(node.end)) return;

  const text = source.slice(node.start, node.end).trim();
  if (!interestingTokens.some((token) => text.includes(token))) return;

  const identifiers = collectIdentifiers(node);
  const clients = [...clientSymbols].filter((symbol) => identifiers.has(symbol));
  if (!clients.length) return;

  matches.push({
    clients,
    statementType: node.type,
    sourceStart: node.start,
    sourceEnd: node.end,
    text,
  });
};

const walk = (node) => {
  if (!node || typeof node !== 'object' || visited.has(node)) return;
  visited.add(node);

  if (
    node.type === 'ExpressionStatement' ||
    node.type === 'VariableDeclaration' ||
    node.type === 'IfStatement'
  ) {
    inspectStatement(node);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
    } else if (value && typeof value === 'object') {
      walk(value);
    }
  }
};

walk(ast.program);

const unique = [];
const seen = new Set();
for (const match of matches) {
  const key = `${match.sourceStart}:${match.sourceEnd}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(match);
}

unique.sort((a, b) => a.sourceStart - b.sourceStart);

fs.mkdirSync(outputDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  input: path.normalize(inputFile),
  clients: [...clientSymbols],
  matchCount: unique.length,
  matches: unique,
};

fs.writeFileSync(
  path.join(outputDir, 'http-client-config.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

const recoveredSource = unique
  .map(
    (match, index) =>
      `// recovered HTTP client config #${index + 1} (${match.clients.join(', ')})\n${match.text}\n`,
  )
  .join('\n');

fs.writeFileSync(path.join(outputDir, 'http-client-config.js'), recoveredSource);

console.log(`Recovered ${unique.length} HTTP client configuration statements.`);
