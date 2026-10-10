'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');

async function filesUnder(root, relative = '') {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const item = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink não permitido no modelo: ${item}`);
    if (entry.isDirectory()) files.push(...await filesUnder(root, item));
    else if (entry.isFile() && entry.name !== '.speech-model-checksums.json') files.push(item);
  }
  return files;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const modelDir = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Uso: node scripts/create-model-manifest.cjs <diretório-do-modelo>');
  const files = await filesUnder(modelDir);
  if (!files.length) throw new Error('O diretório do modelo está vazio.');
  const checksums = {};
  for (const relativePath of files) {
    checksums[relativePath.split(path.sep).join('/')] = await hashFile(path.join(modelDir, relativePath));
  }
  const manifest = { algorithm: 'sha256', files: checksums };
  await fs.writeFile(path.join(modelDir, '.speech-model-checksums.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
  process.stdout.write(`Manifesto SHA-256 criado para ${files.length} arquivos em ${modelDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
