'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createProvider, detectSpeechRegions, chunkRegions, mergeOverlappingText } = require('../src/provider');
const { verifyModelDirectory } = require('../src/model-checksum');

test('ditado usa sua própria fila mesmo com uma fila antiga de transcrição configurada', () => {
  const names = ['SPEECH_WORKER_MODE', 'SPEECH_DICTATION_QUEUE', 'TRANSCRIPTION_QUEUE'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.SPEECH_WORKER_MODE = 'dictation';
    process.env.SPEECH_DICTATION_QUEUE = 'speech.dictation';
    process.env.TRANSCRIPTION_QUEUE = 'legacy.long-audio';
    assert.equal(loadConfig().queue, 'speech.dictation');
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('VAD descarta silêncio e o chunker aplica sobreposição configurada', () => {
  const samples = new Float32Array(16_000 * 2);
  samples.fill(0.1, 16_000 / 2, 16_000);
  const regions = detectSpeechRegions(samples, -45);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].start > 0);
  assert.ok(regions[0].end < samples.length);
  const chunks = chunkRegions([{ start: 0, end: 16_000 * 70 }], 30, 5);
  assert.deepEqual(chunks.map(({ start, end }) => [start / 16_000, end / 16_000]), [[0, 30], [25, 55], [50, 70]]);
  assert.equal(mergeOverlappingText('preciso verificar o pedido', 'o pedido do cliente'), 'preciso verificar o pedido do cliente');
});

test('VAD não descarta gravação não vazia com fala abaixo do limiar de energia', async () => {
  const quietSamples = new Float32Array(16_000).fill(0.001);
  const calls = [];
  const provider = createProvider({
    provider: 'local',
    vadThresholdDb: -45,
    chunkSeconds: 30,
    strideSeconds: 5,
    local: { model: 'Xenova/whisper-small' },
  }, {
    decodeAudio: async () => ({ samples: quietSamples, durationMs: 1000 }),
    createPipeline: async () => async (samples) => {
      calls.push(samples);
      return { text: 'fala em volume baixo' };
    },
  });

  const result = await provider.transcribe('quiet-audio.webm', { mode: 'dictation' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, quietSamples.length);
  assert.equal(result.text, 'fala em volume baixo');
});

test('modelo local exige manifesto e rejeita arquivo alterado', async () => {
  const modelDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-model-check-'));
  try {
    const model = Buffer.from('fixture-model');
    await fs.writeFile(path.join(modelDir, 'model.onnx'), model);
    const digest = createHash('sha256').update(model).digest('hex');
    await fs.writeFile(path.join(modelDir, '.speech-model-checksums.json'), JSON.stringify({ algorithm: 'sha256', files: { 'model.onnx': digest } }));
    assert.equal(await verifyModelDirectory(modelDir), 1);
    await fs.writeFile(path.join(modelDir, 'model.onnx'), 'tampered-model');
    await assert.rejects(verifyModelDirectory(modelDir), (error) => error.code === 'MODEL_CHECKSUM_MISMATCH');
  } finally {
    await fs.rm(modelDir, { recursive: true, force: true });
  }
});
