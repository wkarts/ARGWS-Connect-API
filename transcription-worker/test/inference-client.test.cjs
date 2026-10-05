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
