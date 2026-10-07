'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { decodeAudio, createProvider } = require('../src/provider');

// The API already ships a platform FFmpeg binary for its media tests. GitHub's
// bare Node runner does not install /usr/bin/ffmpeg; the worker image does.
try {
  const bundled = require('@ffmpeg-installer/ffmpeg').path;
  process.env.PATH = `${path.dirname(bundled)}${path.delimiter}${process.env.PATH || ''}`;
} catch { /* A standalone worker test can use the system FFmpeg. */ }

async function wav(directory, seconds) {
  const sampleCount = 16000 * seconds;
  const audio = Buffer.alloc(44 + sampleCount * 2);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i += 1) audio.writeInt16LE(Math.round(Math.sin(i / 8) * 12000), 44 + i * 2);
  const filePath = path.join(directory, 'input.wav');
  await fs.writeFile(filePath, audio);
  return filePath;
}

test('PCM longo fica em arquivo temporário e é lido em trechos com limpeza final', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-bound-test-'));
  try {
    const filePath = await wav(directory, 65);
    const decoded = await decodeAudio(filePath, { maxDurationSeconds: 66 });
    assert.equal(decoded.samples, undefined);
    assert.equal(decoded.samplesCount, 65 * 16000);
    assert.equal((await fs.stat(decoded.pcmPath)).size, 65 * 16000 * 4);
    await decoded.dispose();
    await assert.rejects(fs.stat(decoded.pcmPath), { code: 'ENOENT' });

    const seen = [];
    const provider = createProvider({ provider: 'local', vadThresholdDb: -45,
      chunkSeconds: 30, strideSeconds: 5, maxDurationSeconds: 66 }, {
      createPipeline: async () => async (samples) => {
        seen.push(samples.length);
        return { text: 'fala' };
      },
    });
    const result = await provider.transcribe(filePath);
    assert.equal(result.durationMs, 65000);
    assert.ok(seen.length >= 3);
    assert.ok(Math.max(...seen) <= 30 * 16000);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('áudio maior que o limite decodificado falha sem deixar PCM temporário', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-bound-test-'));
  try {
    const filePath = await wav(directory, 2);
    await assert.rejects(decodeAudio(filePath, { maxDurationSeconds: 1 }), { code: 'AUDIO_TOO_LONG' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
