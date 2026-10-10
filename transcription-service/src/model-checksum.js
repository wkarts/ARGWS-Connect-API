'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createHash } = require('node:crypto');

function safePath(rootPath, relativePath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Caminho de modelo fora do diretório permitido.');
  return target;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyModelDirectory(modelDir) {
  const manifestPath = safePath(modelDir, '.speech-model-checksums.json');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    throw Object.assign(new Error('O modelo local não possui um manifesto SHA-256 válido.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
  }
  if (manifest?.algorithm !== 'sha256' || !manifest.files || typeof manifest.files !== 'object') {
    throw Object.assign(new Error('Manifesto SHA-256 do modelo local inválido.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
  }
  const entries = Object.entries(manifest.files);
  if (!entries.length) throw Object.assign(new Error('Manifesto SHA-256 do modelo local vazio.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
  for (const [relativePath, expectedValue] of entries) {
    if (typeof expectedValue !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedValue)) {
      throw Object.assign(new Error('Checksum do modelo local malformado.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
    }
    const filePath = safePath(modelDir, relativePath);
    const stat = await fsp.lstat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw Object.assign(new Error('Arquivo ausente ou inválido no modelo local.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
    }
    if (await hashFile(filePath) !== expectedValue.toLowerCase()) {
      throw Object.assign(new Error('Checksum inválido no modelo local.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
    }
  }
  return entries.length;
}

module.exports = { verifyModelDirectory };
