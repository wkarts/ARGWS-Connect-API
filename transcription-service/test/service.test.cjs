'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { serviceConfig, createServiceClass } = require('../src/service');

class BaseFixture {
  constructor(config) { this.config = config; this.events = []; }
  async connect() {
    this.connection = {}; this.residentLease = {};
    this.pump(); // Broker may deliver immediately after registering a consumer.
    this.events.push('connected');
  }
  async loadProvider() { this.events.push('warmup'); }
  async reportHealth() { this.events.push('health'); }
  pump() { this.events.push('pump'); }
  scheduleIdleUnload() { this.events.push('idle-unload'); }
}
const Service = createServiceClass(BaseFixture);

test('service consumes both queues without increasing per-process concurrency', () => {
  const config = serviceConfig({ concurrency: 8, mode: 'dictation', queues: { transcription: 't', dictation: 'd' } }, {});
  assert.equal(config.concurrency, 1); assert.equal(config.mode, 'pool'); assert.equal(config.queue, 't');
  assert.deepEqual(config.modes, ['dictation', 'transcription']);
  assert.equal(config.pcmFastPath, true); assert.equal(config.skipDigitalSilence, true);
  assert.equal(config.prewarm, false); assert.equal(config.modelKeepWarm, false);
  assert.equal(config.dictationChunkSeconds, 5); assert.equal(config.dictationStrideSeconds, 1);
});

test('warm model is opt-in and prewarm serializes with deliveries', async () => {
  const service = new Service(serviceConfig({}, { SPEECH_PREWARM: 'true', SPEECH_MODEL_KEEP_WARM: 'true' }));
  await service.connect(); service.scheduleIdleUnload();
  assert.deepEqual(service.events, ['connected', 'warmup', 'health', 'pump']);
});

test('default remains on-demand and supports idle model unloading', async () => {
  const service = new Service(serviceConfig({}, {}));
  await service.connect(); service.scheduleIdleUnload();
  assert.deepEqual(service.events, ['connected', 'pump', 'idle-unload']);
});

test('keep-warm never suppresses the shutdown path', () => {
  const service = new Service(serviceConfig({}, { SPEECH_MODEL_KEEP_WARM: 'true' }));
  service.stopping = true; service.scheduleIdleUnload();
  assert.deepEqual(service.events, ['idle-unload']);
});

test('failed warmup cannot dispatch a queued job', async () => {
  const service = new Service(serviceConfig({}, { SPEECH_PREWARM: 'true' }));
  service.loadProvider = async () => { throw new Error('model missing'); };
  await assert.rejects(service.connect(), /model missing/);
  assert.equal(service.preparing, false);
  assert.deepEqual(service.events, ['connected']);
});

test('disabled service starts without a model, broker, S3, ASR token or dependency loading', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../src/service.js')], {
    env: { PATH: process.env.PATH, SPEECH_ENABLED: 'false', TRANSCRIPTION_ENABLED: 'false' },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nenhum consumidor ou modelo/);
});

test('explicit tuning respects bounds and can disable fast path independently', () => {
  const config = serviceConfig({}, { SPEECH_DICTATION_CHUNK_SECONDS: '999', SPEECH_DICTATION_STRIDE_SECONDS: '-1',
    SPEECH_PCM_FAST_PATH: 'false', SPEECH_SKIP_DIGITAL_SILENCE: 'false' });
  assert.equal(config.dictationChunkSeconds, 30); assert.equal(config.dictationStrideSeconds, 1);
  assert.equal(config.pcmFastPath, false); assert.equal(config.skipDigitalSilence, false);
});
