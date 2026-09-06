import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const [inputFile, outputDir] = process.argv.slice(2);

if (!inputFile || !outputDir) {
  console.error('Usage: node extract-components.mjs <input.js> <output-dir>');
  process.exit(1);
}

const source = fs.readFileSync(inputFile, 'utf8');
const ast = parse(source, {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  errorRecovery: false,
});

fs.mkdirSync(outputDir, { recursive: true });

const wantedFunctions = new Map([
  ['Fse', 'LandingPage.Fse.js'],
  ['Dse', 'LoginPage.Dse.js'],
]);

const wantedVariables = new Map([
  ['Lse', 'Router.Lse.js'],
  ['Dae', 'SidebarPtBR.Dae.js'],
  ['goe', 'SidebarEnUS.goe.js'],
  ['Boe', 'SidebarEsES.Boe.js'],
  ['dae', 'SidebarFrFR.dae.js'],
]);

const extracted = [];
const topLevel = [];

const writeNode = (node, fileName, symbol, kind) => {
  const content = source.slice(node.start, node.end).trimEnd() + '\n';
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, content);
  extracted.push({ symbol, kind, file: fileName, bytes: Buffer.byteLength(content) });
};

for (const node of ast.program.body) {
  if (node.type === 'FunctionDeclaration' && node.id?.name) {
    topLevel.push({ kind: 'function', name: node.id.name, start: node.start, end: node.end });
    const fileName = wantedFunctions.get(node.id.name);
    if (fileName) writeNode(node, fileName, node.id.name, 'function');
    continue;
  }

  if (node.type === 'VariableDeclaration') {
    for (const declaration of node.declarations) {
      if (declaration.id?.type !== 'Identifier') continue;
      const name = declaration.id.name;
      topLevel.push({ kind: 'variable', name, start: node.start, end: node.end });
      const fileName = wantedVariables.get(name);
      if (fileName) writeNode(node, fileName, name, 'variable');
    }
  }
}

const expected = [...wantedFunctions.keys(), ...wantedVariables.keys()];
const found = new Set(extracted.map((entry) => entry.symbol));
const missing = expected.filter((symbol) => !found.has(symbol));

const inventory = {
  generatedAt: new Date().toISOString(),
  input: path.normalize(inputFile),
  parser: '@babel/parser',
  topLevelSymbolCount: topLevel.length,
  extracted,
  missing,
};

fs.writeFileSync(path.join(outputDir, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);

const readme = `# Manager recovered — análise de componentes\n\n` +
  `Arquivos extraídos automaticamente do bundle legado formatado. Eles ainda usam identificadores minificados e não são o fonte final.\n\n` +
  `## Mapeamentos confirmados\n\n` +
  `- \`Fse\` → landing page raiz do Manager.\n` +
  `- \`Dse\` → página de login do Manager.\n` +
  `- \`Lse\` → tabela principal de rotas React Router.\n` +
  `- \`Dae\` → labels pt-BR da sidebar, incluindo os links públicos legados.\n` +
  `- \`goe\`, \`Boe\`, \`dae\` → variantes en-US, es-ES e fr-FR dessas labels.\n\n` +
  `## Regra desta fase\n\n` +
  `Esses arquivos servem como prova e referência para reconstrução. O \`manager/dist\` de produção não é substituído nesta etapa.\n`;

fs.writeFileSync(path.join(outputDir, 'README.md'), readme);

if (missing.length) {
  console.error(`Expected symbols not found: ${missing.join(', ')}`);
  process.exit(2);
}

console.log(`Extracted ${extracted.length} recovered symbols into ${outputDir}`);
