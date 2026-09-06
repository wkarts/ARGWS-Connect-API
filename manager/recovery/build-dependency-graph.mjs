import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const [inputFile, inventoryFile, outputFile] = process.argv.slice(2);

if (!inputFile || !inventoryFile || !outputFile) {
  console.error('Usage: node build-dependency-graph.mjs <input.js> <inventory.json> <output.json>');
  process.exit(1);
}

const source = fs.readFileSync(inputFile, 'utf8');
const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
const ast = parse(source, {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  errorRecovery: false,
});

const declarationBySymbol = new Map();
const visitedIndex = new Set();

const indexNode = (node) => {
  if (!node || typeof node !== 'object' || visitedIndex.has(node)) return;
  visitedIndex.add(node);

  if (node.type === 'FunctionDeclaration' && node.id?.name && !declarationBySymbol.has(node.id.name)) {
    declarationBySymbol.set(node.id.name, node);
  }

  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations ?? []) {
      if (declarator.id?.type === 'Identifier' && !declarationBySymbol.has(declarator.id.name)) {
        declarationBySymbol.set(declarator.id.name, declarator);
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) indexNode(child);
    } else if (value && typeof value === 'object') {
      indexNode(value);
    }
  }
};

indexNode(ast.program);

const isBindingIdentifier = (node, parent, parentKey) => {
  if (!parent) return false;

  if (parent.type === 'FunctionDeclaration') {
    if (parent.id === node) return true;
    if ((parent.params ?? []).includes(node)) return true;
  }

  if (parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') {
    if ((parent.params ?? []).includes(node)) return true;
  }

  if (parent.type === 'VariableDeclarator' && parent.id === node) return true;
  if (parent.type === 'CatchClause' && parent.param === node) return true;

  if (
    (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') &&
    parentKey === 'key' &&
    parent.computed !== true
  ) {
    return true;
  }

  if (
    (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') &&
    parentKey === 'property' &&
    parent.computed !== true
  ) {
    return true;
  }

  if (parent.type === 'LabeledStatement' && parentKey === 'label') return true;

  return false;
};

const collectReferences = (rootNode, ownSymbol) => {
  const refs = new Set();
  const visited = new Set();

  const walk = (node, parent = null, parentKey = null) => {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);

    if (
      node.type === 'Identifier' &&
      node.name !== ownSymbol &&
      declarationBySymbol.has(node.name) &&
      !isBindingIdentifier(node, parent, parentKey)
    ) {
      refs.add(node.name);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;
      if (Array.isArray(value)) {
        for (const child of value) walk(child, node, key);
      } else if (value && typeof value === 'object') {
        walk(value, node, key);
      }
    }
  };

  walk(rootNode);
  return [...refs].sort();
};

const recoveredBySymbol = new Map(
  (inventory.extracted ?? []).map((entry) => [entry.symbol, entry.file]),
);

const graph = {};
const unrecoveredFrequency = new Map();

for (const entry of inventory.extracted ?? []) {
  const declaration = declarationBySymbol.get(entry.symbol);
  if (!declaration) continue;

  const dependencies = collectReferences(declaration, entry.symbol).map((symbol) => ({
    symbol,
    recovered: recoveredBySymbol.has(symbol),
    recoveredFile: recoveredBySymbol.get(symbol) ?? null,
  }));

  graph[entry.symbol] = {
    file: entry.file,
    dependencies,
  };

  for (const dependency of dependencies) {
    if (dependency.recovered) continue;
    unrecoveredFrequency.set(
      dependency.symbol,
      (unrecoveredFrequency.get(dependency.symbol) ?? 0) + 1,
    );
  }
}

const candidateDependencies = [...unrecoveredFrequency.entries()]
  .map(([symbol, referencedByRecoveredSymbols]) => ({ symbol, referencedByRecoveredSymbols }))
  .sort((a, b) => b.referencedByRecoveredSymbols - a.referencedByRecoveredSymbols || a.symbol.localeCompare(b.symbol));

const report = {
  generatedAt: new Date().toISOString(),
  input: path.normalize(inputFile),
  recoveredSymbolCount: Object.keys(graph).length,
  indexedDeclarationCount: declarationBySymbol.size,
  graph,
  candidateDependencies,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Dependency graph written to ${outputFile}`);
console.log(`Recovered symbols analyzed: ${report.recoveredSymbolCount}`);
console.log(`Unrecovered dependency candidates: ${candidateDependencies.length}`);
