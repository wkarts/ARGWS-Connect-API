'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { decodeNormalizedWav, speechWindow, isDigitalSilence } = require('../src/audio-normalizer');
const { createProvider, decodeAudio } = require('../src/provider');
const { wavBuffer } = require('../src/whisper-cpp');

async function fixture(t, samples = Float32Array.from({ length: 16000 * 2 }, (_, i) => Math.sin(i / 8) / 4)) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-fast-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'audio.wav');
  await fs.writeFile(file, wavBuffer(samples));
  return { file, directory, samples };
}

test('canonical WAV uses no temporary PCM, keeps original bytes and matches FFmpeg samples', async (t) => {
  const { file, directory } = await fixture(t);
  const before = await fs.readFile(file);
  const fast = await decodeNormalizedWav(file, { startSeconds: .5, chunkSeconds: 1 });
  assert.equal(fast.samples.length, 16000);
  assert.equal(fast.pcmPath, undefined);
  assert.equal(fast.normalization, 'native-wav');
  const slow = await decodeAudio(file, { startSeconds: .5, chunkSeconds: 1, maxDurationSeconds: 1 });
  try {
    const bytes = await fs.readFile(slow.pcmPath);
    for (let i = 0; i < fast.samples.length; i += 1) assert.equal(fast.samples[i], bytes.readFloatLE(i * 4));
  } finally { await slow.dispose(); }
  await fast.dispose();
  assert.deepEqual(await fs.readFile(file), before);
  assert.deepEqual(await fs.readdir(directory), ['audio.wav']);
});

test('only the requested bounded window is read, including EOF sentinel', async (t) => {
  const { file } = await fixture(t);
  const decoded = await decodeNormalizedWav(file, { startSeconds: 1, chunkSeconds: 1 + 1 / 16000 });
  assert.equal(decoded.samples.length, 16000);
  assert.equal((await decodeNormalizedWav(file, { startSeconds: 2, chunkSeconds: 1, allowEmpty: true })).samples.length, 0);
  await assert.rejects(decodeNormalizedWav(file, { startSeconds: 2, chunkSeconds: 1 }), { code: 'INVALID_AUDIO' });
});

test('other formats/sample rates use the existing decoder, never reinterpret bytes as PCM', async (t) => {
  const { file } = await fixture(t);
  const data = await fs.readFile(file);
  data.writeUInt32LE(48000, 24);
  await fs.writeFile(file, data);
  assert.equal(await decodeNormalizedWav(file, { chunkSeconds: 1 }), null);
  await fs.writeFile(file, Buffer.from('OggS'.padEnd(40, 'x')));
  assert.equal(await decodeNormalizedWav(file, { chunkSeconds: 1 }), null);
});

test('truncated RIFF, incomplete PCM and inconsistent format fail safely', async (t) => {
  const { file } = await fixture(t);
  const original = await fs.readFile(file);
  for (const change of [b => b.writeUInt32LE(b.length + 99, 4), b => b.writeUInt32LE(3, 40), b => b.writeUInt16LE(8, 32)]) {
    const bytes = Buffer.from(original); change(bytes); await fs.writeFile(file, bytes);
    await assert.rejects(decodeNormalizedWav(file, { chunkSeconds: 1 }), { code: 'INVALID_AUDIO' });
  }
});

test('cancelled and unbounded requests never read PCM', async (t) => {
  const { file } = await fixture(t);
  await assert.rejects(decodeNormalizedWav(file, { chunkSeconds: 1, isCancelled: () => true }), { code: 'CANCELLED' });
  for (const chunkSeconds of [0, -1, 3600, NaN, Infinity]) assert.equal(await decodeNormalizedWav(file, { chunkSeconds }), null);
});

test('float32 WAV rejects NaN rather than passing it to the native runtime', async (t) => {
  const { file } = await fixture(t);
  const data = Buffer.alloc(48);
  wavBuffer(new Float32Array(2)).copy(data, 0, 0, 44);
  data.writeUInt32LE(40, 4); data.writeUInt16LE(3, 20); data.writeUInt32LE(64000, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(32, 34); data.writeUInt32LE(4, 40);
  data.writeFloatLE(NaN, 44);
  await fs.writeFile(file, data);
  await assert.rejects(decodeNormalizedWav(file, { chunkSeconds: 1 }), { code: 'INVALID_AUDIO' });
  data.writeFloatLE(.5, 44); await fs.writeFile(file, data);
  assert.equal((await decodeNormalizedWav(file, { chunkSeconds: 1 })).samples[0], .5);
});

test('overlap is capped to half a window, avoiding one-sample advancement', () => {
  assert.deepEqual(speechWindow({ chunkSeconds: 5, strideSeconds: 5 }, 'transcription'), { seconds: 5, strideSeconds: 2.5 });
  assert.deepEqual(speechWindow({ chunkSeconds: 30, strideSeconds: 5, dictationChunkSeconds: 5, dictationStrideSeconds: 1 }, 'dictation'), { seconds: 5, strideSeconds: 1 });
  assert.deepEqual(speechWindow({ chunkSeconds: 30, strideSeconds: 5 }, 'transcription'), { seconds: 30, strideSeconds: 5 });
  assert.equal(isDigitalSilence(new Float32Array(10)), true);
  assert.equal(isDigitalSilence(Float32Array.of(0, 1e-12)), false);
});

test('silent windows advance durable checkpoints without inference; quiet speech is retained', async () => {
  let calls = 0;
  const config = { provider: 'local', engine: 'whisper.cpp', chunkSeconds: 5, strideSeconds: 1, skipDigitalSilence: true };
  let samples = new Float32Array(5 * 16000 + 1);
  const provider = createProvider(config, { decodeAudio: async () => ({ samples }),
    createPipeline: async () => async () => { calls += 1; return { text: 'olá' }; } });
  const first = await provider.transcribeChunk('unused');
  assert.equal(first.done, false); assert.equal(first.checkpoint.nextOffsetSamples, 64000); assert.equal(calls, 0);
  samples = new Float32Array(1000).fill(1e-8);
  const last = await provider.transcribeChunk('unused', { checkpoint: first.checkpoint });
  assert.equal(last.result.text, 'olá'); assert.equal(calls, 1);
});

test('all-silent audio reports NO_SPEECH and performs zero ASR calls', async () => {
  const provider = createProvider({ provider: 'local', skipDigitalSilence: true }, {
    decodeAudio: async () => ({ samples: new Float32Array(16000) }),
    createPipeline: async () => { throw new Error('Must not allocate a model for silence'); },
  });
  await assert.rejects(provider.transcribeChunk('unused'), { code: 'NO_SPEECH' });
});

test('short dictation windows keep duration, source identity and checkpoint compatibility', async (t) => {
  const { file } = await fixture(t, new Float32Array(16000 * 12).fill(.2));
  const windows = [];
  const provider = createProvider({ provider: 'local', pcmFastPath: true, chunkSeconds: 30, strideSeconds: 5,
    dictationChunkSeconds: 5, dictationStrideSeconds: 1 }, {
    createPipeline: async () => async samples => { windows.push(samples.length); return { text: 'fala' }; },
  });
  const result = await provider.transcribe(file, { mode: 'dictation', sourceSha256: 'fixture' });
  assert.equal(result.durationMs, 12000); assert.equal(windows.length, 3);
  assert.ok(windows.every(size => size <= 5 * 16000));
});
