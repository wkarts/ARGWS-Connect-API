'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { InferenceClient } = require('../src/inference-client');

test('heartbeats continuam na thread principal durante inferência síncrona', async () => {
  const client = new InferenceClient({}, { workerPath: path.join(__dirname, 'fixtures/blocking-inference.cjs') });
  let heartbeats = 0;
  try {
    await client.warmup();
    const interval = setInterval(() => { heartbeats += 1; }, 20);
    try {
      const result = await client.transcribe('audio.ogg');
      assert.equal(result.text, 'concluído');
      assert.ok(heartbeats >= 3, `apenas ${heartbeats} heartbeats durante a inferência`);
    } finally {
      clearInterval(interval);
    }
  } finally {
    await client.stop();
  }
});

test('inferência travada termina com erro recuperável e o próximo áudio usa uma thread nova', async () => {
  const client = new InferenceClient({}, {
    workerPath: path.join(__dirname, 'fixtures/stalling-inference.cjs'),
    stallTimeoutMs: 80,
  });
  try {
    await client.warmup();
    await assert.rejects(client.transcribe('travado.ogg', { stall: true }), (error) =>
      error.code === 'INFERENCE_STALLED' && error.retryable === true,
    );
    const result = await client.transcribe('seguinte.ogg');
    assert.equal(result.text, 'recuperado');
  } finally {
    await client.stop();
  }
});

test('parada durante inferência rejeita o job para que o canal possa devolvê-lo', async () => {
  const client = new InferenceClient({}, {
    workerPath: path.join(__dirname, 'fixtures/stalling-inference.cjs'),
    stallTimeoutMs: 10_000,
  });
  await client.warmup();
  const pending = assert.rejects(client.transcribe('em-curso.ogg', { stall: true }), {
    code: 'WORKER_STOPPING',
  });
  await client.stop();
  await pending;
});
