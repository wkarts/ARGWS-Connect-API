import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [inputFile, outputFile] = process.argv.slice(2);

if (!inputFile || !outputFile) {
  console.error('Usage: node analyze-bundle.mjs <input.js> <output.json>');
  process.exit(1);
}

const source = fs.readFileSync(inputFile, 'utf8');
const sha256 = crypto.createHash('sha256').update(source).digest('hex');

const unique = (items) => [...new Set(items)].sort();

const routes = unique(
  [...source.matchAll(/\bpath\s*:\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]),
);

const urls = unique(
  [...source.matchAll(/https?:\/\/[^\s"'`<>)]+/g)].map((match) => match[0]),
);

const mailtos = unique(
  [...source.matchAll(/mailto:[^\s"'`<>)]+/g)].map((match) => match[0]),
);

const functionNames = unique(
  [...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]),
);

const hardcodedSignals = [
  'Modern web interface for Connect|API management',
  'Version 2.0.0',
  'Welcome to Connect|API',
  'Access Manager Dashboard',
  'Resources & Support',
  'GitHub',
  'Postman',
  'Discord',
  'Support Premium',
  'Suporte Premium',
  'Documentation',
  'Documentação',
];

const signals = Object.fromEntries(
  hardcodedSignals.map((signal) => [signal, source.includes(signal)]),
);

const licenseLibraries = unique(
  [...source.matchAll(/@license\s+([^\n*]+)/g)].map((match) => match[1].trim()),
);

const report = {
  generatedAt: new Date().toISOString(),
  source: path.normalize(inputFile),
  sizeBytes: Buffer.byteLength(source),
  sha256,
  sourceMapReference: /sourceMappingURL\s*=/.test(source),
  routes,
  externalUrls: urls,
  mailtoLinks: mailtos,
  namedFunctions: functionNames,
  namedFunctionCount: functionNames.length,
  licenseLibraries,
  hardcodedSignals: signals,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Recovery report written to ${outputFile}`);
