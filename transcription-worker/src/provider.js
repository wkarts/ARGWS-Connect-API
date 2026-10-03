'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const path = require('node:path');
const { createClient, restoreModelCache, persistModelCache } = require('./storage');

let pipelinePromise = null;

function decodeAudio(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn',
      '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error('Não foi possível decodificar o áudio localmente: ' + Buffer.concat(errors).toString('utf8').trim()));
        return;
      }
      const raw = Buffer.concat(chunks);
      if (!raw.length || raw.length % 4 !== 0) {
        reject(new Error('O áudio não contém amostras PCM válidas.'));
        return;
      }
      const samples = new Float32Array(raw.length / 4);
      for (let index = 0; index < samples.length; index += 1) samples[index] = raw.readFloatLE(index * 4);
      resolve({ samples, durationMs: Math.round((samples.length / 16000) * 1000) });
    });
  });
}

async function prepareModelCache(config) {
  const cacheDir = path.resolve(config.local.cacheDir);
  const namespace = String(config.local.model || '').split('/').filter(Boolean)[0];

  // The cache is ephemeral inside the worker. Its durable copy lives in the
  // application MinIO bucket, so container recreation never depends on a
  // host bind mount.
  await fsp.mkdir(cacheDir, { recursive: true });
  if (namespace) await fsp.mkdir(path.join(cacheDir, namespace), { recursive: true });
  if (config.s3?.bucket && config.modelStoragePrefix) {
    const client = createClient(config.s3);
    await restoreModelCache(
      client,
      config.s3.bucket,
      config.modelStoragePrefix,
      config.local.model,
      cacheDir,
    );
  }
  return cacheDir;
}

async function createPipeline(config) {
  if (!pipelinePromise) {
    pipelinePromise = prepareModelCache(config)
      .then((cacheDir) => import('@huggingface/transformers').then(({ env, pipeline }) => {
        env.cacheDir = cacheDir;
        env.allowRemoteModels = true;
        env.allowLocalModels = true;
        return pipeline('automatic-speech-recognition', config.local.model, {
          device: config.local.device,
          dtype: config.local.dtype,
        });
      }))
      .then(async (transcriber) => {
        const client = createClient(config.s3);
        await persistModelCache(
          client,
          config.s3.bucket,
          config.modelStoragePrefix,
          config.local.model,
          path.resolve(config.local.cacheDir),
        );
        return transcriber;
      })
      .catch((error) => {
        pipelinePromise = null;
        throw error;
      });
  }
  return pipelinePromise;
}

function languageCode(value) {
  const language = String(value || '').trim();
  if (!language) return undefined;
  return language.split('-')[0].toLowerCase();
}

function normalizeChunks(chunks) {
  if (!Array.isArray(chunks)) return null;
  return chunks.map((chunk) => ({
    text: String(chunk?.text || '').trim(),
    timestamp: Array.isArray(chunk?.timestamp) ? chunk.timestamp : null,
  })).filter((chunk) => chunk.text);
}

function createProvider(config) {
  if (config.provider !== 'local') throw new Error('TRANSCRIPTION_PROVIDER não suportado: ' + config.provider);

  return {
    async transcribe(filePath, input = {}) {
      const decoded = await decodeAudio(filePath);
      const transcriber = await createPipeline(config);
      const result = await transcriber(decoded.samples, {
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(languageCode(input.language) ? { language: languageCode(input.language) } : {}),
      });
      const text = String(result?.text || '').trim();
      if (!text) throw new Error('O motor local não retornou texto para este áudio.');
      return {
        text,
        language: result?.language ? String(result.language) : (languageCode(input.language) || null),
        durationMs: decoded.durationMs,
        segments: normalizeChunks(result?.chunks),
      };
    },
  };
}

module.exports = { createProvider, decodeAudio, prepareModelCache };
