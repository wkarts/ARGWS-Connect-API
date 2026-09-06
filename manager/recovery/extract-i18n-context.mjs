import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const [inputFile, outputDir] = process.argv.slice(2);

if (!inputFile || !outputDir) {
  console.error('Usage: node extract-i18n-context.mjs <input.js> <output-dir>');
  process.exit(1);
}

const source = fs.readFileSync(inputFile, 'utf8');
const ast = parse(source, {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  errorRecovery: false,
});

const localeSignals = new Set([
  'pt-BR',
  'en-US',
  'es-ES',
  'fr-FR',
  'pt_BR',
  'en_US',
  'es_ES',
  'fr_FR',
]);

const normalizedLocale = (value) => value.replace('_', '-');
const safeName = (value) => value.replace(/[^A-Za-z0-9_.-]/g, '_');

fs.mkdirSync(outputDir, { recursive: true });
const contextDir = path.join(outputDir, 'context');
fs.mkdirSync(contextDir, { recursive: true });

const occurrences = [];
const declarations = new Map();
const ancestors = [];
const visited = new Set();

const declarationInfo = (stack) => {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const node = stack[i];

    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      return {
        kind: 'function',
        symbol: node.id.name,
        node,
      };
    }

    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const declaration = stack[i - 1];
      if (declaration?.type === 'VariableDeclaration') {
        return {
          kind: 'variable',
          symbol: node.id.name,
          node: declaration,
        };
      }
    }
  }

  return null;
};

const recordLiteral = (node, value) => {
  if (!localeSignals.has(value)) return;

  const declaration = declarationInfo(ancestors);
  const normalized = normalizedLocale(value);

  const occurrence = {
    literal: value,
    locale: normalized,
    line: node.loc?.start?.line ?? null,
    column: node.loc?.start?.column ?? null,
    declaration: declaration
      ? {
          kind: declaration.kind,
          symbol: declaration.symbol,
        }
      : null,
  };

  occurrences.push(occurrence);

  if (!declaration) return;

  const key = `${declaration.kind}:${declaration.symbol}:${declaration.node.start}:${declaration.node.end}`;
  if (!declarations.has(key)) {
    declarations.set(key, declaration);
  }
};

const inspectNode = (node) => {
  if (!node || typeof node !== 'object' || visited.has(node)) return;
  visited.add(node);
  ancestors.push(node);

  if (node.type === 'StringLiteral') {
    recordLiteral(node, node.value);
  } else if (node.type === 'DirectiveLiteral') {
    recordLiteral(node, node.value);
  } else if (node.type === 'TemplateElement') {
    const raw = node.value?.raw;
    if (typeof raw === 'string') {
      for (const locale of localeSignals) {
        if (raw.includes(locale)) recordLiteral(node, locale);
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;

    if (Array.isArray(value)) {
      for (const child of value) inspectNode(child);
    } else if (value && typeof value === 'object') {
      inspectNode(value);
    }
  }

  ancestors.pop();
};

inspectNode(ast.program);

const extracted = [];
for (const declaration of declarations.values()) {
  const content = source.slice(declaration.node.start, declaration.node.end).trimEnd() + '\n';
  const fileName = `${safeName(declaration.symbol)}.${declaration.kind}.js`;
  fs.writeFileSync(path.join(contextDir, fileName), content);
  extracted.push({
    symbol: declaration.symbol,
    kind: declaration.kind,
    file: `context/${fileName}`,
    bytes: Buffer.byteLength(content),
  });
}

const locales = [...new Set(occurrences.map((entry) => entry.locale))].sort();
const report = {
  generatedAt: new Date().toISOString(),
  input: path.normalize(inputFile),
  policyTarget: {
    defaultLocale: 'pt-BR',
    extraLocalesDisabledByDefault: true,
    runtimeEnvironment: {
      MANAGER_DEFAULT_LOCALE: 'pt-BR',
      MANAGER_ENABLE_EXTRA_LOCALES: 'false',
      MANAGER_EXTRA_LOCALES: 'en-US,es-ES,fr-FR',
    },
  },
  detectedLocales: locales,
  occurrences,
  extracted,
};

fs.writeFileSync(path.join(outputDir, 'locale-context.json'), `${JSON.stringify(report, null, 2)}\n`);

if (!locales.includes('pt-BR')) {
  console.error('pt-BR locale signal was not found in the recovered Manager bundle.');
  process.exit(2);
}

console.log(`Detected locales: ${locales.join(', ')}`);
console.log(`Extracted ${extracted.length} i18n context declarations into ${contextDir}`);
