'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyModelDirectory } = require('./model-checksum');

const SAMPLE_RATE = 16000;
let pipelinePromise = null;

function withCode(error, code) {
  if (!error.code) error.code = code;
  return error;
}

async function decodeAudio(filePath, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'speech-pcm-'));
  const pcmPath = path.join(directory, 'audio.pcm');
  const maximum = Math.max(1, options.maxDurationSeconds || 3600) * SAMPLE_RATE * 4;
  const output = fs.createWriteStream(pcmPath, { flags: 'wx', mode: 0o600 });
  let child;
  let timer;
  let written = 0;
  let failure;
  let lastProgress = Date.now();
  let lastMemory = 0;
  try {
    await new Promise((resolve, reject) => {
      child = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn',
        '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      options.onMemory?.('ffmpeg_spawn', 0, child.pid);
      const fail = (error) => {
        failure ||= error;
        child.kill('SIGKILL');
      };
      timer = setInterval(() => {
        if (options.isCancelled?.()) fail(new SpeechCancelledError());
        if (options.onMemory && child.pid && process.platform === 'linux' && Date.now() - lastMemory >= 5000) {
          lastMemory = Date.now();
          fsp.readFile(`/proc/${child.pid}/status`, 'utf8').then((status) => {
            const kib = Number(/VmRSS:\s*(\d+)\s*kB/.exec(status)?.[1] || 0);
            options.onMemory('ffmpeg_decode', kib * 1024);
          }).catch(() => {});
        }
      }, 250);
      child.stdout.on('data', (chunk) => {
        if (failure) return;
        written += chunk.length;
        if (written > maximum) {
          fail(withCode(new Error('O áudio decodificado excedeu a duração permitida.'), 'AUDIO_TOO_LONG'));
        } else if (!output.write(chunk)) {
          child.stdout.pause();
        }
        if (!failure && Date.now() - lastProgress >= 1000) {
          lastProgress = Date.now();
          void Promise.resolve(options.onProgress?.({ stage: 'normalizing', progressPercent: 8,
            processedDurationMs: Math.round(written / (SAMPLE_RATE * 4) * 1000) })).catch(() => {});
        }
      });
      output.on('drain', () => child.stdout.resume());
      output.on('error', (error) => { output.destroy(); fail(withCode(error, 'AUDIO_DECODE_FAILED')); });
      child.once('error', (error) => { failure ||= withCode(error, error.code === 'ENOENT' ? 'FFMPEG_MISSING' : 'AUDIO_DECODE_FAILED'); });
      child.once('close', (code) => {
        options.onMemory?.('ffmpeg_exit', 0, child.pid);
        if (output.destroyed) {
          reject(failure || withCode(new Error('Não foi possível gravar o PCM temporário.'), 'AUDIO_DECODE_FAILED'));
          return;
        }
        output.end(() => {
          if (failure) reject(failure);
          else if (code !== 0) reject(withCode(new Error('Não foi possível normalizar este áudio com FFmpeg.'), 'INVALID_AUDIO'));
          else resolve();
        });
      });
    });
    if (!written || written % 4 !== 0) throw withCode(new Error('O áudio não contém amostras PCM válidas.'), 'INVALID_AUDIO');
    const samplesCount = written / 4;
    return {
      pcmPath, samplesCount,
      durationMs: Math.round(samplesCount / SAMPLE_RATE * 1000),
      dispose: () => fsp.rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    child?.kill('SIGKILL');
    output.destroy();
    await fsp.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    clearInterval(timer);
  }
}

async function detectSpeechRegionsFromFile(handle, samplesCount, thresholdDb, input = {}) {
  const frameSamples = Math.round(SAMPLE_RATE * 0.03);
  const frame = Buffer.allocUnsafe(frameSamples * 4);
  const threshold = 10 ** (Number(thresholdDb) / 20);
  const padding = Math.round(SAMPLE_RATE * 0.15);
  const maxGap = Math.round(SAMPLE_RATE * 0.45);
  const minimum = Math.round(SAMPLE_RATE * 0.09);
  const regions = [];
  let start = -1;
  let lastVoicedEnd = -1;
  for (let offset = 0; offset < samplesCount; offset += frameSamples) {
    if (offset % (frameSamples * 1000) === 0) {
      if (input.isCancelled?.()) throw new SpeechCancelledError();
      if (offset) await input.onProgress?.({ stage: 'voice_activity_detection', progressPercent: 14, processedDurationMs: 0 });
    }
    const count = Math.min(frameSamples, samplesCount - offset);
    const { bytesRead } = await handle.read(frame, 0, count * 4, offset * 4);
    if (bytesRead !== count * 4) throw withCode(new Error('Leitura de PCM incompleta.'), 'AUDIO_DECODE_FAILED');
    let squareSum = 0;
    for (let i = 0; i < count; i += 1) squareSum += frame.readFloatLE(i * 4) ** 2;
    if (Math.sqrt(squareSum / count) >= threshold) {
      if (start < 0) start = offset;
      lastVoicedEnd = offset + count;
    } else if (start >= 0 && offset - lastVoicedEnd > maxGap) {
      regions.push({ start: Math.max(0, start - padding), end: Math.min(samplesCount, lastVoicedEnd + padding) });
      start = -1;
    }
  }
  if (start >= 0) regions.push({ start: Math.max(0, start - padding), end: Math.min(samplesCount, lastVoicedEnd + padding) });
  return regions.filter(({ start: begin, end }) => end - begin >= minimum);
}

async function readPcmChunk(handle, start, end) {
  const raw = Buffer.allocUnsafe((end - start) * 4);
  let offset = 0;
  while (offset < raw.length) {
    const { bytesRead } = await handle.read(raw, offset, raw.length - offset, start * 4 + offset);
    if (!bytesRead) throw withCode(new Error('Leitura de PCM incompleta.'), 'AUDIO_DECODE_FAILED');
    offset += bytesRead;
  }
  const samples = new Float32Array(end - start);
  for (let i = 0; i < samples.length; i += 1) samples[i] = raw.readFloatLE(i * 4);
  return samples;
}

async function prepareModelCache(config) {
  if (config.local.modelPath) {
    const modelPath = path.resolve(config.local.modelPath);
    try {
      await fsp.access(modelPath);
    } catch {
      throw withCode(new Error('SPEECH_MODEL_PATH não existe: ' + modelPath), 'MODEL_MISSING');
    }
    await verifyModelDirectory(modelPath);
    return modelPath;
  }

  const cacheDir = path.resolve(config.local.cacheDir);
  await fsp.mkdir(cacheDir, { recursive: true });

  const namespace = String(config.local.model || '').split('/').filter(Boolean)[0];
  if (namespace) await fsp.mkdir(path.join(cacheDir, namespace), { recursive: true });
  if (config.s3?.bucket && config.modelStoragePrefix) {
    const { createClient, restoreModelCache } = require('./storage');
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
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        const modelRef = config.local.modelPath ? path.resolve(config.local.modelPath) : config.local.model;
        return pipeline('automatic-speech-recognition', modelRef, {
          device: config.local.device,
          dtype: config.local.dtype,
        });
      }))
      .then(async (transcriber) => {
        if (!config.local.modelPath && config.syncModelCache) {
          const { createClient, persistModelCache } = require('./storage');
          const client = createClient(config.s3);
          await persistModelCache(
            client,
            config.s3.bucket,
            config.modelStoragePrefix,
            config.local.model,
            path.resolve(config.local.cacheDir),
          );
        }
        return transcriber;
      })
      .catch((error) => {
        pipelinePromise = null;
        throw withCode(error, 'MODEL_MISSING');
      });
  }
  return pipelinePromise;
}

function languageCode(value) {
  const language = String(value || '').trim();
  if (!language) return undefined;
  return language.split('-')[0].toLowerCase();
}

function detectSpeechRegions(samples, thresholdDb = -45) {
  const frameSamples = Math.round(SAMPLE_RATE * 0.03);
  const threshold = 10 ** (Number(thresholdDb) / 20);
  const padding = Math.round(SAMPLE_RATE * 0.15);
  const maxGap = Math.round(SAMPLE_RATE * 0.45);
  const minimum = Math.round(SAMPLE_RATE * 0.09);
  const raw = [];
  let start = -1;
  let lastVoicedEnd = -1;

  for (let offset = 0; offset < samples.length; offset += frameSamples) {
    const end = Math.min(samples.length, offset + frameSamples);
    let squareSum = 0;
    for (let index = offset; index < end; index += 1) squareSum += samples[index] * samples[index];
    const rms = Math.sqrt(squareSum / Math.max(1, end - offset));
    if (rms >= threshold) {
      if (start < 0) start = offset;
      lastVoicedEnd = end;
    } else if (start >= 0 && offset - lastVoicedEnd > maxGap) {
      raw.push({ start: Math.max(0, start - padding), end: Math.min(samples.length, lastVoicedEnd + padding) });
      start = -1;
      lastVoicedEnd = -1;
    }
  }
  if (start >= 0) raw.push({ start: Math.max(0, start - padding), end: Math.min(samples.length, lastVoicedEnd + padding) });
  return raw.filter((region) => region.end - region.start >= minimum);
}

function chunkRegions(regions, chunkSeconds, strideSeconds) {
  const maximum = Math.max(1, Math.floor(Number(chunkSeconds) * SAMPLE_RATE));
  const stride = Math.min(maximum - 1, Math.max(0, Math.floor(Number(strideSeconds) * SAMPLE_RATE)));
  const step = maximum - stride;
  const chunks = [];
  for (const region of regions) {
    for (let start = region.start; start < region.end; start += step) {
      const end = Math.min(region.end, start + maximum);
      chunks.push({ start, end });
      if (end >= region.end) break;
    }
  }
  return chunks;
}

function normalizedWord(value) {
  return String(value || '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
}

function mergeOverlappingText(previous, next) {
  const left = String(previous || '').trim();
  const right = String(next || '').trim();
  if (!left) return right;
  if (!right) return left;
  const a = left.split(/\s+/);
  const b = right.split(/\s+/);
  const maximum = Math.min(16, a.length, b.length);
  for (let count = maximum; count >= 1; count -= 1) {
    const suffix = a.slice(-count).map(normalizedWord).join(' ');
    const prefix = b.slice(0, count).map(normalizedWord).join(' ');
    if (suffix && suffix === prefix) return `${left} ${b.slice(count).join(' ')}`.trim();
  }
  return `${left} ${right}`;
}

function normalizeSegments(chunks, offsetSamples, sourceDurationMs) {
  if (!Array.isArray(chunks)) return [];
  const offsetMs = (offsetSamples / SAMPLE_RATE) * 1000;
  return chunks.map((chunk) => {
    const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [];
    const hasStart = timestamp[0] !== null && timestamp[0] !== undefined && timestamp[0] !== '' && Number.isFinite(Number(timestamp[0]));
    const hasEnd = timestamp[1] !== null && timestamp[1] !== undefined && timestamp[1] !== '' && Number.isFinite(Number(timestamp[1]));
    const startMs = hasStart ? offsetMs + Number(timestamp[0]) * 1000 : offsetMs;
    const endMs = hasEnd ? offsetMs + Number(timestamp[1]) * 1000 : startMs;
    return {
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.min(sourceDurationMs, Math.max(0, Math.round(endMs))),
      text: String(chunk?.text || '').trim(),
    };
  }).filter((segment) => segment.text);
}

class SpeechCancelledError extends Error {
  constructor() {
    super('O processamento foi cancelado.');
    this.name = 'SpeechCancelledError';
    this.code = 'CANCELLED';
    this.retryable = false;
  }
}

function createProvider(config, dependencies = {}) {
  if (config.provider !== 'local') throw new Error('SPEECH_PROVIDER não suportado: ' + config.provider);
  const loadPipeline = dependencies.createPipeline || (() => createPipeline(config));
  const decode = dependencies.decodeAudio || decodeAudio;

  return {
    async warmup() {
      const transcriber = await loadPipeline();
      await transcriber(new Float32Array(1600), { task: 'transcribe', return_timestamps: false });
      return { model: config.local.model, loaded: true };
    },

    async transcribe(filePath, input = {}) {
      await input.onProgress?.({ stage: 'normalizing', progressPercent: 8, processedDurationMs: 0 });
      const decoded = await decode(filePath, {
        isCancelled: input.isCancelled,
        onProgress: input.onProgress,
        onMemory: input.onMemory,
        maxDurationSeconds: input.mode === 'dictation' ? config.dictationMaxDurationSeconds : config.maxDurationSeconds,
      });
      let handle;
      try {
      if (input.isCancelled?.()) throw new SpeechCancelledError();
      if (decoded.pcmPath) handle = await fsp.open(decoded.pcmPath, 'r');
      const samplesCount = decoded.samples?.length ?? decoded.samplesCount;
      await input.onProgress?.({ stage: 'voice_activity_detection', progressPercent: 14, processedDurationMs: 0 });
      const detectedRegions = handle
        ? await detectSpeechRegionsFromFile(handle, samplesCount, config.vadThresholdDb, input)
        : detectSpeechRegions(decoded.samples, config.vadThresholdDb);
      // VAD is an optimization, not a validation gate: quiet speech can fall
      // below a fixed energy threshold. Give Whisper the full non-empty audio
      // when VAD cannot confidently select any regions.
      const regions = detectedRegions.length
        ? detectedRegions
        : [{ start: 0, end: samplesCount }];
      const chunks = chunkRegions(regions, config.chunkSeconds, config.strideSeconds);
      const transcriber = await loadPipeline();
      let partialText = '';
      let processedSamples = 0;
      const segments = [];
      const requestedLanguage = languageCode(input.language);
      // Dictation inserts plain text and does not display word timings. Skipping
      // timestamp decoding removes extra work from the short, interactive path.
      const returnTimestamps = input.mode !== 'dictation';
      await input.onProgress?.({ stage: 'transcribing', progressPercent: 20, processedDurationMs: 0, partialText });

      for (let index = 0; index < chunks.length; index += 1) {
        if (input.isCancelled?.()) throw new SpeechCancelledError();
        const chunk = chunks[index];
        const samples = handle
          ? await readPcmChunk(handle, chunk.start, chunk.end)
          : decoded.samples.subarray(chunk.start, chunk.end);
        const result = await transcriber(samples, {
          task: 'transcribe',
          return_timestamps: returnTimestamps,
          ...(requestedLanguage ? { language: requestedLanguage } : {}),
        });
        const text = String(result?.text || '').trim();
        partialText = mergeOverlappingText(partialText, text);
        if (returnTimestamps) segments.push(...normalizeSegments(result?.chunks, chunk.start, decoded.durationMs));
        processedSamples += samples.length;
        await input.onProgress?.({
          stage: 'transcribing',
          progressPercent: 20 + Math.floor(((index + 1) / chunks.length) * 75),
          processedDurationMs: Math.min(decoded.durationMs, Math.round((processedSamples / SAMPLE_RATE) * 1000)),
          partialText,
          processedChunks: index + 1,
          totalChunks: chunks.length,
        });
      }

      if (input.isCancelled?.()) throw new SpeechCancelledError();
      if (!partialText) {
        throw Object.assign(new Error('O motor local não reconheceu fala neste áudio.'), { code: 'NO_SPEECH', retryable: false });
      }
      return {
        text: partialText,
        language: requestedLanguage || null,
        durationMs: decoded.durationMs,
        segments,
      };
      } finally {
        await handle?.close();
        await decoded.dispose?.();
      }
    },
  };
}

module.exports = {
  createProvider,
  decodeAudio,
  prepareModelCache,
  detectSpeechRegions,
  chunkRegions,
  mergeOverlappingText,
  SpeechCancelledError,
};
