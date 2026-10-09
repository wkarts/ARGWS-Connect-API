'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { verifyModelDirectory } = require('./model-checksum');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message, code) => Object.assign(new Error(message), { code, retryable: false });

function wavBuffer(samples) {
  if (!(samples instanceof Float32Array) || samples.length > 30 * 16000) {
    throw fail('O motor exige um chunk PCM de até 30 segundos.', 'CHUNK_TOO_LARGE');
  }
  const audio = Buffer.alloc(44 + samples.length * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.min(1, Math.max(-1, Number.isFinite(samples[index]) ? samples[index] : 0));
    audio.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + index * 2);
  }
  return audio;
}

function createWhisperCpp(config, dependencies = {}) {
  const spawnProcess = dependencies.spawn || spawn;
  const fetchLocal = dependencies.fetch || fetch;
  let server;
  let startup;
  let startupError;
  const requestPath = '/speech-' + randomUUID();
  const endpoint = `http://127.0.0.1:${config.whisper?.port || 8178}${requestPath}`;

  async function start() {
    if (startup) return startup;
    startup = (async () => {
      const directory = path.resolve(config.local.modelPath);
      const modelFile = path.resolve(config.whisper.modelFile);
      if (!modelFile.startsWith(directory + path.sep)) throw fail('Modelo GGML fora de SPEECH_MODEL_PATH.', 'MODEL_FORMAT_MISMATCH');
      await verifyModelDirectory(directory);
      const manifest = JSON.parse(await fs.readFile(path.join(directory, '.speech-model-checksums.json'), 'utf8'));
      const relative = path.relative(directory, modelFile).split(path.sep).join('/');
      if (!manifest.files?.[relative]) throw fail('O arquivo GGML não está no manifesto verificado.', 'MODEL_CHECKSUM_MISMATCH');
      if (manifest.engine && manifest.engine !== 'whisper.cpp') throw fail('Modelo provisionado para outro engine.', 'MODEL_FORMAT_MISMATCH');
      if (config.whisper.modelSha256 && manifest.files[relative] !== config.whisper.modelSha256) {
        throw fail('SHA-256 configurado diverge do modelo GGML verificado.', 'MODEL_CHECKSUM_MISMATCH');
      }
      // The child inherits the inference process group. Parent cancellation kills
      // server + decoders together; never open this endpoint outside loopback.
      server = spawnProcess(config.whisper.binary, [
        '--host', '127.0.0.1', '--port', String(config.whisper.port || 8178),
        '--request-path', requestPath,
        '--threads', String(config.inferenceThreads || 1), '--processors', '1',
        '--model', modelFile, '--language', 'auto', '--no-context', '--no-gpu',
        '--no-language-probabilities',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      server.stderr?.resume();
      server.once('error', (error) => { startupError = fail(error.message, error.code === 'ENOENT' ? 'ENGINE_BINARY_MISSING' : 'ENGINE_START_FAILED'); });
      server.once('exit', (code) => { startupError ||= fail(`whisper-server encerrou (${code}).`, 'ENGINE_PROCESS_FAILED'); });
      const until = Date.now() + (config.modelWarmupTimeoutSeconds || 300) * 1000;
      while (Date.now() < until) {
        if (startupError) throw startupError;
        try {
          const response = await fetchLocal(endpoint + '/health', { signal: AbortSignal.timeout(1000) });
          if (response.ok && (await response.json()).status === 'ok') return;
        } catch { /* Model startup is bounded by the supervisor and this deadline. */ }
        await delay(200);
      }
      throw fail('whisper-server não ficou pronto dentro do prazo.', 'MODEL_WARMUP_TIMEOUT');
    })();
    return startup;
  }

  const recognize = async (samples, options = {}) => {
    await start();
    if (startupError) throw startupError;
    const body = new FormData();
    body.set('file', new Blob([wavBuffer(samples)], { type: 'audio/wav' }), 'chunk.wav');
    body.set('response_format', options.return_timestamps ? 'verbose_json' : 'json');
    body.set('language', options.language || 'auto');
    body.set('no_language_probabilities', 'true');
    body.set('translate', 'false'); body.set('no_context', 'true');
    body.set('temperature', '0'); body.set('temperature_inc', '0');
    body.set('no_timestamps', options.return_timestamps ? 'false' : 'true');
    const response = await fetchLocal(endpoint + '/inference', {
      method: 'POST', body, signal: AbortSignal.timeout((config.chunkDeadlineSeconds || 180) * 1000),
    });
    if (!response.ok) throw Object.assign(new Error('whisper-server recusou a inferência.'), { code: 'ENGINE_INFERENCE_FAILED', retryable: true });
    const reader = response.body.getReader();
    let bytes = 0;
    const parts = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024 * 1024) { await reader.cancel(); throw fail('Resposta do motor excedeu o limite.', 'ENGINE_RESPONSE_TOO_LARGE'); }
      parts.push(Buffer.from(value));
    }
    const result = JSON.parse(Buffer.concat(parts, bytes).toString('utf8'));
    return {
      text: String(result.text || ''),
      language: result.language || null,
      chunks: Array.isArray(result.segments) ? result.segments.map((segment) => ({
        text: String(segment.text || ''), timestamp: [segment.start, segment.end],
      })) : [],
    };
  };
  recognize.warmup = start;
  return recognize;
}

module.exports = { createWhisperCpp, wavBuffer };
