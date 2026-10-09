'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { InferenceClient } = require('../src/inference-client');
const { groupHasLiveProcesses } = require('../src/process-supervisor');

// Opt-in native validation uses pre-provisioned, checksum-pinned artifacts. The
// regular suite never downloads a model or silently treats fixtures as ASR.
const available = process.env.SPEECH_NATIVE_TEST_BINARY && process.env.SPEECH_NATIVE_TEST_MODEL_PATH && process.env.SPEECH_NATIVE_TEST_AUDIO;

test('whisper.cpp real: smoke, chunk, identidade, residência e cancelamento nativo', { skip: !available, timeout: 600000 }, async () => {
  const modelPath = process.env.SPEECH_NATIVE_TEST_MODEL_PATH;
  const manifest = JSON.parse(await fs.readFile(path.join(modelPath, '.speech-model-checksums.json'), 'utf8'));
  const modelFile = Object.keys(manifest.files).find((file) => file.endsWith('.bin'));
  const config = {
    provider: 'local', engine: 'whisper.cpp', inferenceThreads: 1, inferenceInterThreads: 1,
    processKillGraceMs: 500, modelWarmupTimeoutSeconds: 300, chunkDeadlineSeconds: 240,
    inferenceStallSeconds: 300, chunkSeconds: 30, strideSeconds: 5, vadThresholdDb: -45,
    maxDurationSeconds: 60, dictationMaxDurationSeconds: 60,
    local: { model: manifest.model, modelPath },
    whisper: { binary: process.env.SPEECH_NATIVE_TEST_BINARY, port: 8178,
      modelFile: path.join(modelPath, modelFile), modelSha256: manifest.files[modelFile] },
  };
  const client = new InferenceClient(config);
  const startedAt = Date.now();
  try {
    await client.warmup();
    const pid = client.child.pid;
    const warmupMs = Date.now() - startedAt;
    const inferenceStart = Date.now();
    const result = await client.transcribeChunk(process.env.SPEECH_NATIVE_TEST_AUDIO, {
      language: 'en', mode: 'transcription', model: manifest.model, engine: 'whisper.cpp', modelRevision: manifest.revision,
    });
    const inferenceMs = Date.now() - inferenceStart;
    assert.equal(result.done, true);
    assert.match(result.result.text.toLowerCase(), /country/);
    assert.equal(result.result.effectiveModel, manifest.model);
    assert.equal(result.result.modelRevision, manifest.revision);
    assert.equal(result.result.engine, 'whisper.cpp');
    assert.equal(client.child.pid, pid);
    await client.warmup();
    assert.equal(client.child.pid, pid);
    const dictationStartedAt = Date.now();
    const dictation = await client.transcribeChunk(process.env.SPEECH_NATIVE_TEST_AUDIO, {
      language: 'en', mode: 'dictation', model: manifest.model, engine: 'whisper.cpp', modelRevision: manifest.revision,
    });
    const warmDictationMs = Date.now() - dictationStartedAt;
    assert.match(dictation.result.text.toLowerCase(), /country/);
    assert.deepEqual(dictation.result.segments, []);
    assert.equal(client.child.pid, pid);
    const cancelled = assert.rejects(client.transcribeChunk(process.env.SPEECH_NATIVE_TEST_AUDIO, {
      mode: 'dictation', language: 'en', model: manifest.model, engine: 'whisper.cpp',
    }), { code: 'CANCELLED' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const cancelStart = Date.now();
    await client.cancel(); await cancelled;
    const cancellationMs = Date.now() - cancelStart;
    assert.equal(await groupHasLiveProcesses(pid), false);
    console.log(JSON.stringify({ event: 'native_worker_validation', engine: 'whisper.cpp', model: manifest.model,
      revision: manifest.revision, warmupMs, inferenceMs, warmDictationMs, durationMs: result.result.durationMs,
      rtf: inferenceMs / result.result.durationMs, cancellationMs,
      segments: result.result.segments.length, residencyReused: true, allNativeChildrenStopped: true }));
  } finally { await client.stop(); }
});
