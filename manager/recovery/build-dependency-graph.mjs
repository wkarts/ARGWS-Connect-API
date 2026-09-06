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

const scopeForNode = new WeakMap();
const namedRecordsBySymbol = new Map();
const allNamedRecords = [];
let scopeSequence = 0;

const createScope = (type, node, parent = null) => ({
  id: ++scopeSequence,
  type,
  node,
  parent,
  bindings: new Map(),
});

const nearestFunctionOrProgramScope = (scope) => {
  let current = scope;
  while (current && current.type !== 'function' && current.type !== 'program') {
    current = current.parent;
  }
  return current ?? scope;
};

const collectPatternIdentifiers = (pattern, output = []) => {
  if (!pattern || typeof pattern !== 'object') return output;

  switch (pattern.type) {
    case 'Identifier':
      output.push(pattern);
      break;
    case 'RestElement':
      collectPatternIdentifiers(pattern.argument, output);
      break;
    case 'AssignmentPattern':
      collectPatternIdentifiers(pattern.left, output);
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements ?? []) collectPatternIdentifiers(element, output);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties ?? []) {
        if (property.type === 'RestElement') {
          collectPatternIdentifiers(property.argument, output);
        } else {
          collectPatternIdentifiers(property.value, output);
        }
      }
      break;
    default:
      break;
  }

  return output;
};

const addBinding = ({ scope, identifier, kind, declarationNode, symbol = null }) => {
  if (!scope || !identifier?.name) return;

  const binding = {
    name: identifier.name,
    kind,
    declarationNode,
    symbol,
    scopeId: scope.id,
    sourceStart: declarationNode?.start ?? identifier.start ?? null,
    sourceEnd: declarationNode?.end ?? identifier.end ?? null,
  };

  if (!scope.bindings.has(identifier.name)) {
    scope.bindings.set(identifier.name, binding);
  }

  if (symbol) {
    allNamedRecords.push(binding);
    if (!namedRecordsBySymbol.has(symbol)) namedRecordsBySymbol.set(symbol, []);
    namedRecordsBySymbol.get(symbol).push(binding);
  }
};

const registerPattern = ({ scope, pattern, kind, declarationNode, symbolForIdentifier = false }) => {
  for (const identifier of collectPatternIdentifiers(pattern)) {
    addBinding({
      scope,
      identifier,
      kind,
      declarationNode,
      symbol: symbolForIdentifier && pattern.type === 'Identifier' ? identifier.name : null,
    });
  }
};

const visitChildren = (node, scope, walk) => {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'tokens' || key === 'comments') continue;

    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object') walk(child, scope, node, key);
      }
    } else if (value && typeof value === 'object') {
      walk(value, scope, node, key);
    }
  }
};

const programScope = createScope('program', ast.program, null);

const buildScopes = (node, scope, parent = null, parentKey = null) => {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'Program') {
    scopeForNode.set(node, programScope);
    for (const child of node.body ?? []) buildScopes(child, programScope, node, 'body');
    return;
  }

  if (node.type === 'FunctionDeclaration') {
    if (node.id?.type === 'Identifier') {
      addBinding({
        scope,
        identifier: node.id,
        kind: 'function',
        declarationNode: node,
        symbol: node.id.name,
      });
    }

    const functionScope = createScope('function', node, scope);
    scopeForNode.set(node, functionScope);

    if (node.id?.type === 'Identifier') {
      addBinding({
        scope: functionScope,
        identifier: node.id,
        kind: 'function-self',
        declarationNode: node,
        symbol: null,
      });
      scopeForNode.set(node.id, functionScope);
    }

    for (const parameter of node.params ?? []) {
      registerPattern({
        scope: functionScope,
        pattern: parameter,
        kind: 'parameter',
        declarationNode: parameter,
      });
      buildScopes(parameter, functionScope, node, 'params');
    }

    if (node.body) buildScopes(node.body, functionScope, node, 'body');
    return;
  }

  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    const functionScope = createScope('function', node, scope);
    scopeForNode.set(node, functionScope);

    if (node.type === 'FunctionExpression' && node.id?.type === 'Identifier') {
      addBinding({
        scope: functionScope,
        identifier: node.id,
        kind: 'function-self',
        declarationNode: node,
        symbol: null,
      });
      scopeForNode.set(node.id, functionScope);
    }

    for (const parameter of node.params ?? []) {
      registerPattern({
        scope: functionScope,
        pattern: parameter,
        kind: 'parameter',
        declarationNode: parameter,
      });
      buildScopes(parameter, functionScope, node, 'params');
    }

    if (node.body) buildScopes(node.body, functionScope, node, 'body');
    return;
  }

  if (node.type === 'BlockStatement') {
    const blockScope = createScope('block', node, scope);
    scopeForNode.set(node, blockScope);
    for (const child of node.body ?? []) buildScopes(child, blockScope, node, 'body');
    return;
  }

  if (node.type === 'CatchClause') {
    const catchScope = createScope('catch', node, scope);
    scopeForNode.set(node, catchScope);

    if (node.param) {
      registerPattern({
        scope: catchScope,
        pattern: node.param,
        kind: 'catch-parameter',
        declarationNode: node.param,
      });
      buildScopes(node.param, catchScope, node, 'param');
    }

    if (node.body) buildScopes(node.body, catchScope, node, 'body');
    return;
  }

  if (node.type === 'VariableDeclaration') {
    scopeForNode.set(node, scope);
    const bindingScope = node.kind === 'var' ? nearestFunctionOrProgramScope(scope) : scope;

    for (const declarator of node.declarations ?? []) {
      scopeForNode.set(declarator, scope);
      registerPattern({
        scope: bindingScope,
        pattern: declarator.id,
        kind: `variable-${node.kind}`,
        declarationNode: declarator,
        symbolForIdentifier: true,
      });

      buildScopes(declarator.id, scope, declarator, 'id');
      if (declarator.init) buildScopes(declarator.init, scope, declarator, 'init');
    }
    return;
  }

  if (node.type === 'ClassDeclaration' && node.id?.type === 'Identifier') {
    addBinding({
      scope,
      identifier: node.id,
      kind: 'class',
      declarationNode: node,
      symbol: node.id.name,
    });
  }

  scopeForNode.set(node, scope);
  visitChildren(node, scope, buildScopes);
};

buildScopes(ast.program, programScope);

const resolveBinding = (scope, name) => {
  let current = scope;
  while (current) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
    current = current.parent;
  }
  return null;
};

const isReferenceIdentifier = (node, parent, parentKey) => {
  if (!parent) return false;

  if (parent.type === 'VariableDeclarator' && parentKey === 'id') return false;

  if (
    ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type) &&
    (parentKey === 'id' || parentKey === 'params')
  ) {
    return false;
  }

  if ((parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && parentKey === 'id') {
    return false;
  }

  if (parent.type === 'CatchClause' && parentKey === 'param') return false;

  if (
    (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod') &&
    parentKey === 'key' &&
    parent.computed !== true &&
    parent.shorthand !== true
  ) {
    return false;
  }

  if (
    (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') &&
    parentKey === 'property' &&
    parent.computed !== true
  ) {
    return false;
  }

  if (
    ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type) &&
    parentKey === 'label'
  ) {
    return false;
  }

  if (
    ['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(parent.type)
  ) {
    return false;
  }

  return true;
};

const containsRange = (outer, inner) =>
  Number.isInteger(outer?.start) &&
  Number.isInteger(outer?.end) &&
  Number.isInteger(inner?.sourceStart) &&
  Number.isInteger(inner?.sourceEnd) &&
  inner.sourceStart >= outer.start &&
  inner.sourceEnd <= outer.end;

const recordKey = (binding) =>
  `${binding.symbol ?? binding.name}:${binding.sourceStart ?? 'na'}:${binding.sourceEnd ?? 'na'}`;

const findRecoveredRootRecord = (entry) => {
  const candidates = namedRecordsBySymbol.get(entry.symbol) ?? [];

  if (Number.isInteger(entry.sourceStart) && Number.isInteger(entry.sourceEnd)) {
    const exact = candidates.find(
      (candidate) =>
        candidate.sourceStart === entry.sourceStart && candidate.sourceEnd === entry.sourceEnd,
    );
    if (exact) return exact;
  }

  return candidates[0] ?? null;
};

const collectReferences = (rootRecord) => {
  const rootNode = rootRecord.declarationNode;
  const dependencies = new Map();
  const unresolved = new Set();
  const visited = new Set();

  const walk = (node, parent = null, parentKey = null) => {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);

    if (node.type === 'Identifier' && isReferenceIdentifier(node, parent, parentKey)) {
      const scope = scopeForNode.get(node) ?? scopeForNode.get(parent) ?? null;
      const binding = resolveBinding(scope, node.name);

      if (!binding) {
        unresolved.add(node.name);
      } else if (
        binding.symbol &&
        binding.declarationNode !== rootNode &&
        !containsRange(rootNode, binding)
      ) {
        dependencies.set(recordKey(binding), binding);
      }
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

  return {
    dependencies: [...dependencies.values()].sort(
      (a, b) =>
        (a.sourceStart ?? Number.MAX_SAFE_INTEGER) - (b.sourceStart ?? Number.MAX_SAFE_INTEGER) ||
        (a.symbol ?? '').localeCompare(b.symbol ?? ''),
    ),
    unresolved: [...unresolved].sort(),
  };
};

const recoveredByRange = new Map(
  (inventory.extracted ?? []).map((entry) => [
    `${entry.sourceStart ?? 'na'}:${entry.sourceEnd ?? 'na'}`,
    entry,
  ]),
);

const recoveredBySymbol = new Map(
  (inventory.extracted ?? []).map((entry) => [entry.symbol, entry]),
);

const graph = {};
const candidateMap = new Map();
const unresolvedFrequency = new Map();
const rootResolutionFailures = [];

for (const entry of inventory.extracted ?? []) {
  const rootRecord = findRecoveredRootRecord(entry);
  if (!rootRecord) {
    rootResolutionFailures.push(entry.symbol);
    continue;
  }

  const { dependencies: resolvedDependencies, unresolved } = collectReferences(rootRecord);

  const dependencies = resolvedDependencies.map((binding) => {
    const recoveredEntry = recoveredByRange.get(
      `${binding.sourceStart ?? 'na'}:${binding.sourceEnd ?? 'na'}`,
    ) ?? recoveredBySymbol.get(binding.symbol);

    return {
      symbol: binding.symbol,
      bindingKind: binding.kind,
      sourceStart: binding.sourceStart,
      sourceEnd: binding.sourceEnd,
      recovered: Boolean(recoveredEntry),
      recoveredFile: recoveredEntry?.file ?? null,
    };
  });

  graph[entry.symbol] = {
    file: entry.file,
    sourceStart: entry.sourceStart ?? null,
    sourceEnd: entry.sourceEnd ?? null,
    dependencies,
    unresolvedExternalIdentifiers: unresolved,
  };

  for (const dependency of dependencies) {
    if (dependency.recovered) continue;

    const key = `${dependency.symbol}:${dependency.sourceStart}:${dependency.sourceEnd}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, {
        symbol: dependency.symbol,
        bindingKind: dependency.bindingKind,
        sourceStart: dependency.sourceStart,
        sourceEnd: dependency.sourceEnd,
        referencedBy: [],
      });
    }

    candidateMap.get(key).referencedBy.push(entry.symbol);
  }

  for (const identifier of unresolved) {
    unresolvedFrequency.set(identifier, (unresolvedFrequency.get(identifier) ?? 0) + 1);
  }
}

const candidateDependencies = [...candidateMap.values()]
  .map((candidate) => ({
    ...candidate,
    referencedBy: [...new Set(candidate.referencedBy)].sort(),
    referencedByRecoveredSymbols: new Set(candidate.referencedBy).size,
  }))
  .sort(
    (a, b) =>
      b.referencedByRecoveredSymbols - a.referencedByRecoveredSymbols ||
      (a.sourceStart ?? Number.MAX_SAFE_INTEGER) - (b.sourceStart ?? Number.MAX_SAFE_INTEGER) ||
      a.symbol.localeCompare(b.symbol),
  );

const unresolvedExternalIdentifiers = [...unresolvedFrequency.entries()]
  .map(([identifier, referencedByRecoveredSymbols]) => ({
    identifier,
    referencedByRecoveredSymbols,
  }))
  .sort(
    (a, b) =>
      b.referencedByRecoveredSymbols - a.referencedByRecoveredSymbols ||
      a.identifier.localeCompare(b.identifier),
  );

const report = {
  generatedAt: new Date().toISOString(),
  input: path.normalize(inputFile),
  analysisMode: 'lexical-scope-aware',
  recoveredSymbolCount: Object.keys(graph).length,
  indexedNamedDeclarationCount: allNamedRecords.length,
  lexicalScopeCount: scopeSequence,
  rootResolutionFailures,
  graph,
  candidateDependencies,
  unresolvedExternalIdentifiers,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);

if (rootResolutionFailures.length) {
  console.error(`Unable to resolve recovered roots: ${rootResolutionFailures.join(', ')}`);
  process.exit(2);
}

console.log(`Dependency graph written to ${outputFile}`);
console.log(`Recovered symbols analyzed: ${report.recoveredSymbolCount}`);
console.log(`Lexical scopes indexed: ${report.lexicalScopeCount}`);
console.log(`Unrecovered dependency candidates: ${candidateDependencies.length}`);
