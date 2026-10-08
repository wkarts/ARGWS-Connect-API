'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyModelDirectory } = require('./model-checksum');
const { decodeNormalizedWav, speechWindow, isDigitalSilence } = require('./audio-normalizer');

const SAMPLE_RATE = 16000;
let pipelinePromise = null;

function withCode(error, code) {
  if (!error.code) error.code = code;
  return error;
}

async function decodeAudio(filePath, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'speech-pcm-'));
  const pcmPath = path.join(directory, 'audio.pcm');
  const maximum = Math.ceil(Math.max(1 / SAMPLE_RATE, options.maxDurationSeconds || 3600) * SAMPLE_RATE) * 4;
  const startedAt = Date.now();
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
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-filter_threads', '1',
        '-protocol_whitelist', 'file,pipe',
        ...(options.startSeconds ? ['-ss', String(options.startSeconds)] : []),
        '-i', filePath, '-vn',
        ...(options.chunkSeconds ? ['-t', String(options.chunkSeconds)] : []),
        '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      options.onMemory?.('ffmpeg_spawn', 0, child.pid);
      const fail = (error) => {
        failure ||= error;
        child.kill('SIGKILL');
      };
      timer = setInterval(() => {
        if (options.isCancelled?.()) fail(new SpeechCancelledError());
        if (Date.now() - startedAt > (options.deadlineMs || 60000)) {
          fail(withCode(new Error('A normalização excedeu o prazo permitido.'), 'AUDIO_DECODE_TIMEOUT'));
        }
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
          void Promise.resolve(options.onProgress?.({ stage: 'normalizing', processedDurationMs: Math.round(written / (SAMPLE_RATE * 4) * 1000) })).catch(() => {});
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
    if ((!written && !options.allowEmpty) || written % 4 !== 0) throw withCode(new Error('O áudio não contém amostras PCM válidas.'), 'INVALID_AUDIO');
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
      if (offset) await input.onProgress?.({ stage: 'voice_activity_detection', processedDurationMs: 0 });
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
          revision: config.local.revision || undefined,
          session_options: {
            intraOpNumThreads: config.inferenceThreads || 1,
            interOpNumThreads: config.inferenceInterThreads || 1,
            executionMode: 'sequential',
            extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
          },
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
  const maximum = Math.max(1, Math.floor(Math.min(30, Number(chunkSeconds) || 30) * SAMPLE_RATE));
  const stride = Math.min(maximum - 1, Math.max(0, Math.floor(Number(strideSeconds || 0) * SAMPLE_RATE)));
  // Merge nearby voiced fragments into the same bounded window. Running one
  // inference per syllable/phrase repeatedly padded every call to 30 seconds.
  const aggregated = [];
  for (const region of regions) {
    const previous = aggregated[aggregated.length - 1];
    if (previous && region.end - previous.start <= maximum) previous.end = Math.max(previous.end, region.end);
    else aggregated.push({ start: region.start, end: region.end });
  }
  const chunks = [];
  for (const region of aggregated) {
    for (let start = region.start; start < region.end; start += maximum - stride) {
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

async function modelIdentity(config) {
  const engine = config.engine || 'transformers';
  const model = config.local?.model || null;
  let manifest = {};
  let manifestBytes;
  if (config.local?.modelPath) {
    manifestBytes = await fsp.readFile(path.join(path.resolve(config.local.modelPath), '.speech-model-checksums.json'));
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.engine && manifest.engine !== engine) throw withCode(new Error('O formato do modelo não corresponde ao engine.'), 'MODEL_FORMAT_MISMATCH');
    if (manifest.model && manifest.model !== model) throw withCode(new Error('SPEECH_MODEL diverge do modelo provisionado.'), 'MODEL_MISMATCH');
  }
  return {
    engine, effectiveModel: manifest.model || model, model: manifest.model || model,
    modelRevision: manifest.revision || (manifestBytes ? 'sha256:' + require('node:crypto').createHash('sha256').update(manifestBytes).digest('hex') : null),
    threads: config.inferenceThreads || 1, interThreads: config.inferenceInterThreads || 1,
    timestamps: true, incrementalChunks: true, maxChunkSeconds: Math.min(30, config.chunkSeconds || 30),
  };
}

function createProvider(config, dependencies = {}) {
  if (config.provider !== 'local') throw new Error('SPEECH_PROVIDER não suportado: ' + config.provider);
  const engine = config.engine || 'transformers';
  if (!['transformers', 'whisper.cpp'].includes(engine)) throw withCode(new Error('Engine não suportado; não há fallback automático.'), 'ENGINE_UNSUPPORTED');
  let enginePipeline;
  const loadPipeline = dependencies.createPipeline || (() => {
    if (engine === 'whisper.cpp') {
      enginePipeline ||= require('./whisper-cpp').createWhisperCpp(config);
      return Promise.resolve(enginePipeline);
    }
    return createPipeline(config);
  });
  const decode = dependencies.decodeAudio || (async (filePath, options) => {
    if (config.pcmFastPath) {
      const pcm = await decodeNormalizedWav(filePath, options);
      if (pcm) return pcm;
    }
    return decodeAudio(filePath, options);
  });
  let identity;
  const identityForJob = async () => identity ||= dependencies.createPipeline
    ? { engine, effectiveModel: config.local?.model || null, modelRevision: null }
    : await modelIdentity(config);

  const provider = {
    async warmup() {
      identity = await identityForJob();
      const transcriber = await loadPipeline();
      await transcriber.warmup?.();
      // This tests model execution and backend compatibility, not pt-BR quality.
      await transcriber(new Float32Array(1600), { task: 'transcribe', return_timestamps: false });
      return { ...identity, loaded: true, modelVerified: true, lastSuccessfulInferenceAt: new Date().toISOString() };
    },

    async transcribeChunk(filePath, input = {}) {
      const effective = await identityForJob();
      if (input.engine && input.engine !== effective.engine) throw withCode(new Error('O job requer outro engine.'), 'ENGINE_MISMATCH');
      if (input.modelRevision && input.modelRevision !== effective.modelRevision) throw withCode(new Error('O job requer outra revisão do modelo.'), 'MODEL_REVISION_MISMATCH');
      if (input.model && input.model !== effective.effectiveModel) throw withCode(new Error('O job requer um modelo diferente do carregado.'), 'MODEL_MISMATCH');
      const checkpoint = input.checkpoint || {};
      if (checkpoint.engine && (checkpoint.engine !== effective.engine || checkpoint.effectiveModel !== effective.effectiveModel || checkpoint.modelRevision !== effective.modelRevision)) {
        throw withCode(new Error('O checkpoint pertence a outra revisão do motor/modelo.'), 'CHECKPOINT_MODEL_MISMATCH');
      }
      if (checkpoint.sourceSha256 && input.sourceSha256 && checkpoint.sourceSha256 !== input.sourceSha256) throw withCode(new Error('Checkpoint pertence a outra fonte.'), 'SOURCE_HASH_MISMATCH');
      const nextOffset = Number(checkpoint.nextOffsetSamples || 0);
      const nextChunkIndex = Number(checkpoint.nextChunkIndex || 0);
      if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || !Number.isSafeInteger(nextChunkIndex) || nextChunkIndex < 0) {
        throw withCode(new Error('Checkpoint inválido.'), 'INVALID_CHECKPOINT');
      }
      const configuredDuration = input.mode === 'dictation' ? (config.dictationMaxDurationSeconds || 60) : (config.maxDurationSeconds || 3600);
      const maximumDuration = input.maxDurationMs ? Math.min(configuredDuration, input.maxDurationMs / 1000) : configuredDuration;
      const maximumSamples = maximumDuration * SAMPLE_RATE;
      if (nextOffset > maximumSamples) throw withCode(new Error('O áudio excedeu a duração permitida.'), 'AUDIO_TOO_LONG');
      const window = speechWindow(config, input.mode);
      const windowSamples = Math.min(Math.floor(window.seconds * SAMPLE_RATE), maximumSamples - nextOffset);
      const stride = Math.min(Math.floor(window.strideSeconds * SAMPLE_RATE), Math.floor(windowSamples / 2));
      const decoded = await decode(filePath, {
        isCancelled: input.isCancelled,
        onProgress: input.onProgress,
        onMemory: input.onMemory,
        startSeconds: nextOffset / SAMPLE_RATE,
        // One sentinel sample distinguishes an exact boundary from true EOF.
        chunkSeconds: (windowSamples + 1) / SAMPLE_RATE,
        maxDurationSeconds: (windowSamples + 1) / SAMPLE_RATE,
        allowEmpty: nextOffset > 0,
        deadlineMs: (config.chunkDeadlineSeconds || 180) * 1000,
      });
      let handle;
      try {
        if (input.isCancelled?.()) throw new SpeechCancelledError();
        const decodedCount = decoded.samples?.length ?? decoded.samplesCount;
        if (decodedCount > windowSamples && nextOffset + windowSamples >= maximumSamples) {
          throw withCode(new Error('O áudio excedeu a duração permitida.'), 'AUDIO_TOO_LONG');
        }
        const sampleCount = Math.min(windowSamples, decodedCount);
        const done = decodedCount <= windowSamples;
        if (!sampleCount) {
          if (!checkpoint.text) throw withCode(new Error('O áudio não contém fala reconhecível.'), 'NO_SPEECH');
          return { done: true, checkpoint, result: {
            text: checkpoint.text, segments: checkpoint.segments || [], durationMs: checkpoint.durationMs,
            language: languageCode(input.language) || null, ...effective,
          } };
        }
        if (decoded.pcmPath) handle = await fsp.open(decoded.pcmPath, 'r');
        const detected = handle
          ? await detectSpeechRegionsFromFile(handle, sampleCount, config.vadThresholdDb, input)
          : detectSpeechRegions(decoded.samples.subarray(0, sampleCount), config.vadThresholdDb);
        // Aggregate every VAD fragment inside this window. Silence between
        // phrases is preserved; fixed-threshold VAD never rejects quiet speech.
        const region = detected.length
          ? { start: detected[0].start, end: detected[detected.length - 1].end }
          : { start: 0, end: sampleCount };
        const samples = handle ? await readPcmChunk(handle, region.start, region.end)
          : decoded.samples.subarray(region.start, region.end);
        const returnTimestamps = input.mode !== 'dictation';
        await input.onProgress?.({ stage: 'transcribing', processedDurationMs: checkpoint.durationMs || 0,
          processedChunks: nextChunkIndex });
        // Skip exact digital silence only. Never discard quiet speech via an
        // energy threshold, and never hallucinate words in an all-zero chunk.
        const result = config.skipDigitalSilence && isDigitalSilence(samples) ? { text: '', chunks: [] } : await (await loadPipeline())(samples, {
          task: 'transcribe', return_timestamps: returnTimestamps,
          ...(languageCode(input.language) ? { language: languageCode(input.language) } : {}),
        });
        if (input.isCancelled?.()) throw new SpeechCancelledError();
        const text = mergeOverlappingText(checkpoint.text || '', String(result?.text || '').trim());
        const endMs = Math.round((nextOffset + sampleCount) / SAMPLE_RATE * 1000);
        const previousSegments = Array.isArray(checkpoint.segments) ? checkpoint.segments : [];
        const previousEnd = previousSegments[previousSegments.length - 1]?.endMs || 0;
        const currentSegments = returnTimestamps
          ? normalizeSegments(result?.chunks, nextOffset + region.start, endMs)
            .filter((segment) => segment.endMs > previousEnd)
            .map((segment) => ({ ...segment, startMs: Math.max(previousEnd, segment.startMs) }))
          : [];
        const nextCheckpoint = {
          version: 1, ...effective, sourceSha256: input.sourceSha256 || checkpoint.sourceSha256 || null,
          nextChunkIndex: nextChunkIndex + 1,
          nextOffsetSamples: done ? nextOffset + sampleCount : nextOffset + windowSamples - stride,
          offsetSamples: nextOffset + sampleCount, processedDurationMs: endMs,
          durationMs: endMs, durationKnown: done, text, segments: [...previousSegments, ...currentSegments],
        };
        if (Buffer.byteLength(JSON.stringify(nextCheckpoint), 'utf8') > 250 * 1024) {
          throw withCode(new Error('O resultado parcial excedeu o limite permitido.'), 'CHECKPOINT_TOO_LARGE');
        }
        await input.onProgress?.({ stage: done ? 'finalizing' : 'chunk_completed',
          processedDurationMs: endMs,
          processedChunks: nextChunkIndex + 1, partialText: text });
        if (done && !text) throw withCode(new Error('O motor local não reconheceu fala neste áudio.'), 'NO_SPEECH');
        return {
          done, checkpoint: nextCheckpoint,
          result: done ? { text, language: languageCode(input.language) || null,
            durationMs: endMs, segments: nextCheckpoint.segments, ...effective } : null,
        };
      } finally {
        await handle?.close();
        await decoded.dispose?.();
      }
    },

    async transcribe(filePath, input = {}) {
      let checkpoint = input.checkpoint;
      for (;;) {
        const part = await provider.transcribeChunk(filePath, { ...input, checkpoint });
        if (part.done) return part.result;
        checkpoint = part.checkpoint;
        await input.onCheckpoint?.(checkpoint);
      }
    },
  };
  return provider;
}

module.exports = {
  createProvider, decodeAudio, prepareModelCache, detectSpeechRegions,
  chunkRegions, mergeOverlappingText, SpeechCancelledError, modelIdentity,
};
