'use strict';
// Measures normalization only. Does not measure ASR accuracy, inference or VPS capacity.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { decodeAudio } = require('../src/provider');
const { decodeNormalizedWav } = require('../src/audio-normalizer');
const { wavBuffer } = require('../src/whisper-cpp');
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-normalization-benchmark-'));
  try {
    const input = path.join(directory, 'fixture.wav');
    const source = wavBuffer(Float32Array.from({ length: 30 * 16000 }, (_, i) => .3 * Math.sin(i / 10)));
    await fs.writeFile(input, source);
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    const results = { ffmpeg: [], nativeWav: [] };
    for (let index = 0; index < 8; index += 1) {
      for (const name of index % 2 ? ['nativeWav', 'ffmpeg'] : ['ffmpeg', 'nativeWav']) {
        const before = performance.now();
        const options = { startSeconds: 10, chunkSeconds: 5, maxDurationSeconds: 5 };
        const value = await (name === 'ffmpeg' ? decodeAudio(input, options) : decodeNormalizedWav(input, options));
        if (!value || value.samplesCount !== 80000) throw new Error('Unexpected normalization output');
        await value.dispose();
        results[name].push(Number((performance.now() - before).toFixed(3)));
      }
    }
    console.log(JSON.stringify({ scope: 'normalization-only', fixture: 'synthetic PCM16 mono WAV, 16 kHz, 30 seconds',
      windowSeconds: 5, iterations: 8, platform: process.platform, architecture: process.arch,
      node: process.version, timingsMs: results,
      medianMs: { ffmpeg: median(results.ffmpeg), nativeWav: median(results.nativeWav) },
      sourceUnchanged: digest(source) === digest(await fs.readFile(input)),
      limitations: 'Not an ASR benchmark; no WER, real-time or production throughput claim.' }, null, 2));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
