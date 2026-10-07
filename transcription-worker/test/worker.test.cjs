'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TranscriptionWorker, normalizeJob, queueArguments } = require('../src/worker');
const { loadConfig, validateConfig } = require('../src/config');
const { FairScheduler } = require('../src/fair-scheduler');

const model = 'Xenova/whisper-small';
const config = () => ({
  enabled: true, provider: 'local', engine: 'transformers', mode: 'pool',
  modes: ['dictation', 'transcription'], poolId: 'fixture',
  local: { model, device: 'cpu', dtype: 'q8' },
  s3: { bucket: 'audio' }, rabbitmq: { uri: 'amqp://fixture', exchange: 'speech' },
  queues: { dictation: 'speech.dictation.v2', transcription: 'speech.transcription.v2' },
  heartbeatIntervalSeconds: 5, executionLeaseSeconds: 30, maxAttempts: 3,
  modelWarmupTimeoutSeconds: 1, modelIdleTtlSeconds: 300, maxAudioBytes: 1024,
});
const message = (id, extra = {}) => ({ content: Buffer.from(JSON.stringify({
  version: 2, generation: 1, attempts: 1, jobId: id, poolId: 'fixture', model,
  mode: 'transcription', instanceId: 'instance-a', source: { key: `audio/${id}.ogg`, mimeType: 'audio/ogg', bytes: 4 },
  ...extra,
})) });

async function harness(overrides = {}) {
  const events = [];
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'speech-worker-test-'));
  let providerCount = 0;
  const control = {
    calls: [],
    async request(action, job, data) {
      events.push(action); this.calls.push({ action, job: { ...job }, data });
      if (overrides.control) { const reply = await overrides.control(action, job, data); if (reply !== undefined) return reply; }
      if (action === 'claim') return { ok: true, granted: true, executionId: `exec-${job.jobId}`,
        generation: job.generation, leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
        deadlineAt: new Date(Date.now() + 600000).toISOString() };
      if (action === 'lease') return { ok: true, granted: true, leaseExpiresAt: new Date(Date.now() + 30000).toISOString() };
      return { ok: true, applied: true, terminal: action === 'finish' };
    }, async close() {},
  };
  const worker = new TranscriptionWorker({ ...config(), ...overrides.config }, {
    control,
    acquireSlot: async () => { events.push('acquire'); return { slot: 0, release: async () => events.push('release-residency') }; },
    downloadAudio: async (job) => {
      events.push('download');
      const directory = await fs.promises.mkdtemp(path.join(root, 'source-'));
      const filePath = path.join(directory, 'audio.ogg');
      await fs.promises.writeFile(filePath, 'test');
      return { filePath, directory, bytes: 4 };
    },
    createInferenceClient: () => {
      providerCount += 1; events.push('load');
      const provider = {
        ready: true, status: { engine: 'transformers', effectiveModel: model },
        async warmup() { events.push('warmup'); },
        async stop() { events.push('stop-native'); },
        async cancel() { events.push('cancel-native'); },
        async transcribeChunk(filePath, input) {
          events.push('infer');
          if (overrides.infer) return overrides.infer(filePath, input, provider, events);
          return { done: true, result: { text: 'olá', durationMs: 1000, effectiveModel: model, engine: 'transformers', segments: [] } };
        },
      };
      return provider;
    },
  });
  worker.channel = { ack: () => events.push('ack'), nack: () => events.push('nack'),
    async close() { events.push('channel-close'); },
    sendToQueue(_queue, _body, _options, done) { events.push('dlq'); done(); },
  };
  worker.connection = { async close() { events.push('connection-close'); } };
  worker.logMemory = () => {};
  worker.modelVerified = true;
  const close = async () => { await worker.stop(); await fs.promises.rm(root, { recursive: true, force: true }); };
  return { worker, control, events, close, providerCount: () => providerCount };
}

test('voz desabilitada não abre armazenamento, consumidor ou modelo', async () => {
  const worker = new TranscriptionWorker({ enabled: false, s3: {}, mode: 'transcription' });
  await worker.start();
  assert.equal(worker.provider, null); assert.equal(worker.client, null);
});

test('claim durável acontece antes de download e carga; dois jobs reutilizam a residência', async () => {
  const h = await harness();
  try {
    await h.worker.handle(message('a'));
    await h.worker.handle(message('b'));
    assert.equal(h.providerCount(), 1);
    assert.equal(h.events.filter((event) => event === 'acquire').length, 1);
    assert.equal(h.events.filter((event) => event === 'infer').length, 2);
    assert.ok(h.events.indexOf('claim') < h.events.indexOf('download'));
    assert.ok(h.events.indexOf('download') < h.events.indexOf('load'));
    assert.ok(h.events.indexOf('finish') < h.events.indexOf('ack'));
    assert.equal(h.events.includes('stop-native'), false);
  } finally { await h.close(); }
  assert.ok(h.events.indexOf('stop-native') < h.events.indexOf('release-residency'));
});

test('job terminal ou geração antiga nunca baixa áudio nem aquece modelo', async () => {
  for (const reason of ['CANCELLED', 'COMPLETED', 'STALE_GENERATION']) {
    const h = await harness({ control: async (action) => action === 'claim' ? { ok: true, granted: false, terminal: true, reason } : undefined });
    try {
      await h.worker.handle(message(reason));
      assert.equal(h.providerCount(), 0); assert.equal(h.events.includes('download'), false);
      assert.equal(h.events.includes('infer'), false); assert.ok(h.events.includes('ack'));
    } finally { await h.close(); }
  }
});

test('indisponibilidade da autoridade impede inferência e deixa o job para recuperação', async () => {
  const h = await harness({ control: async (action) => {
    if (action === 'claim') throw Object.assign(new Error('offline'), { code: 'CONTROL_TIMEOUT', retryable: true });
  } });
  try {
    await h.worker.handle(message('a'));
    assert.equal(h.providerCount(), 0); assert.equal(h.events.includes('ack'), false);
    assert.ok(h.events.includes('connection-close'));
  } finally { await h.close(); }
});

test('saturação de claims retém a entrega sem incrementar retry ou carregar modelo', async () => {
  const h = await harness({ control: async (action) => action === 'claim'
    ? { ok: true, granted: false, terminal: false, reason: 'CAPACITY_EXHAUSTED', retryAfterMs: 1000 } : undefined });
  try {
    const result = await h.worker.handle(message('a'));
    assert.equal(result.defer, true); assert.equal(h.providerCount(), 0);
    assert.equal(h.events.includes('ack'), false); assert.equal(h.events.includes('nack'), false);
  } finally { await h.close(); }
});

test('yield grava checkpoint antes do ACK e mantém modelo e fonte para o próximo chunk', async () => {
  const checkpoint = { nextChunkIndex: 1, nextOffsetSamples: 400000, text: 'primeira parte',
    durationMs: 30000, engine: 'transformers', effectiveModel: model, modelRevision: 'rev1' };
  let round = 0;
  const h = await harness({
    control: async (action, job) => action === 'claim' && job.generation === 2 ? {
      ok: true, granted: true, executionId: 'exec-next', generation: 2, checkpoint,
      leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
    } : undefined,
    infer: async (_file, input) => {
      if (round++ === 0) return { done: false, checkpoint };
      assert.deepEqual(input.checkpoint, checkpoint);
      return { done: true, result: { text: 'primeira parte segunda parte', durationMs: 45000,
        engine: 'transformers', effectiveModel: model, segments: [] } };
    },
  });
  try {
    await h.worker.handle(message('same'));
    const release = h.control.calls.find((call) => call.action === 'release');
    assert.equal(release.data.reason, 'yield'); assert.deepEqual(release.data.checkpoint, checkpoint);
    assert.equal(h.events.includes('stop-native'), false); assert.equal(h.worker.sourceCache.size, 1);
    await h.worker.handle(message('same', { generation: 2 }));
    assert.equal(h.events.filter((event) => event === 'download').length, 1);
    assert.equal(h.providerCount(), 1); assert.equal(h.worker.sourceCache.size, 0);
  } finally { await h.close(); }
});

test('resposta perdida após finish não permite ACK e encerra nativo antes de reconectar', async () => {
  const h = await harness({ control: async (action) => {
    if (action === 'finish') throw Object.assign(new Error('reply perdido'), { code: 'CONTROL_TIMEOUT', retryable: true });
  } });
  try {
    await h.worker.handle(message('a'));
    assert.equal(h.events.includes('ack'), false);
    assert.ok(h.events.indexOf('stop-native') < h.events.indexOf('connection-close'));
  } finally { await h.close(); }
});

test('falha recuperável usa outbox da API; não duplica áudio no broker', async () => {
  const h = await harness({ infer: async () => { throw Object.assign(new Error('engine stall'), { code: 'INFERENCE_STALLED', retryable: true }); } });
  try {
    await h.worker.handle(message('a'));
    const retry = h.control.calls.find((call) => call.action === 'release');
    assert.equal(retry.data.reason, 'INFERENCE_STALLED'); assert.equal(retry.data.delayMs, 30000);
    assert.equal(JSON.stringify(retry.data).includes('source'), false);
    assert.ok(h.events.includes('ack'));
  } finally { await h.close(); }
});

test('TTL ocioso encerra o processo sem liberar coordenação do pool', async () => {
  const h = await harness({ config: { modelIdleTtlSeconds: 0.02 } });
  try {
    await h.worker.handle(message('a'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(h.events.includes('stop-native')); assert.equal(h.worker.provider, null);
    assert.ok(h.worker.residentLease); assert.equal(h.events.includes('release-residency'), false);
  } finally { await h.close(); }
});

test('fila v2 recusa legado sem inferir ou alterar estado sem token', async () => {
  const h = await harness();
  try {
    await h.worker.handle(message('legacy', { version: 1 }));
    assert.equal(h.control.calls.length, 0); assert.equal(h.providerCount(), 0);
    assert.deepEqual(h.events, ['dlq', 'ack']);
  } finally { await h.close(); }
});

test('ACK/NACK são idempotentes e não usam canal substituto', async () => {
  const h = await harness();
  try {
    const delivery = message('x');
    assert.equal(h.worker.acknowledge({}, delivery), false);
    assert.equal(h.worker.acknowledge(h.worker.channel, delivery), true);
    assert.equal(h.worker.acknowledge(h.worker.channel, delivery), false);
    assert.equal(h.worker.negativeAcknowledge(h.worker.channel, delivery, true), false);
  } finally { await h.close(); }
});

test('pool escolhe ditado com peso sem impedir transcrição e alterna instâncias', () => {
  const scheduler = new FairScheduler(3);
  for (let index = 0; index < 4; index += 1) {
    scheduler.add({ mode: 'dictation', instanceId: 'a' }, `da${index}`);
    scheduler.add({ mode: 'dictation', instanceId: 'b' }, `db${index}`);
    scheduler.add({ mode: 'transcription', instanceId: 'c' }, `tc${index}`);
  }
  const selected = Array.from({ length: 8 }, () => scheduler.take());
  assert.deepEqual(selected, ['da0', 'db0', 'da1', 'tc0', 'db1', 'da2', 'db2', 'tc1']);
});

test('metadata v2 admite ditado em S3 e rejeita base64 em broker', () => {
  const parsed = JSON.parse(message('x', { mode: 'dictation' }).content);
  const job = normalizeJob(parsed); assert.equal(job.mode, 'dictation'); assert.equal(job.sourceBytes, 4);
  assert.throws(() => normalizeJob({ ...parsed, inlineAudio: 'dGVzdA==' }), /fora do broker/);
  assert.throws(() => normalizeJob({ ...parsed, generation: 0 }), /geração/);
});

test('filas e retenções são limitadas e dead-letter não recebe PCM', () => {
  const args = queueArguments(config(), 'dictation');
  assert.equal(args['x-max-length'], 50); assert.equal(args['x-message-ttl'], 300000);
  assert.equal(args['x-overflow'], 'reject-publish');
  assert.equal(args['x-dead-letter-routing-key'], 'speech.dictation.v2.dead-letter');
});

test('engine inválido falha explicitamente em configuração', () => {
  const value = { ...config(), queue: 'speech.transcription.v2', engine: 'unknown',
    s3: { accessKey: 'key', secretKey: 'secret', bucket: 'bucket' }, modelStoragePrefix: 'speech-models' };
  assert.throws(() => validateConfig(value), /SPEECH_ENGINE/);
});

test('provider legado openai não é silenciosamente convertido para local', () => {
  const before = process.env.SPEECH_PROVIDER;
  try {
    process.env.SPEECH_PROVIDER = 'openai';
    const loaded = loadConfig();
    assert.equal(loaded.provider, 'openai');
    assert.throws(() => validateConfig({ ...config(), provider: loaded.provider, queue: 'speech.transcription.v2',
      s3: { accessKey: 'key', secretKey: 'secret', bucket: 'bucket' }, modelStoragePrefix: 'speech-models' }), /migrar o provider/);
  } finally {
    if (before === undefined) delete process.env.SPEECH_PROVIDER; else process.env.SPEECH_PROVIDER = before;
  }
});

test('valores de filas fora do intervalo usam os mesmos limites da autoridade da API', () => {
  const names = ['SPEECH_QUEUE_MAX_BYTES', 'SPEECH_QUEUE_MAX_JOBS', 'SPEECH_MAX_ATTEMPTS'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.SPEECH_QUEUE_MAX_BYTES = '999999999';
    process.env.SPEECH_QUEUE_MAX_JOBS = '0';
    process.env.SPEECH_MAX_ATTEMPTS = '0';
    const loaded = loadConfig();
    assert.equal(loaded.queueMaxBytes, 268435456);
    assert.equal(loaded.queueMaxJobs, 50);
    assert.equal(loaded.maxAttempts, 3);
  } finally {
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});

test('reconfiguração de engine/model/revisão recusa backlog incompatível antes da carga', async () => {
  for (const extra of [{ engine: 'whisper.cpp' }, { model: 'different-model' }, { modelRevision: 'different-revision' }]) {
    const h = await harness();
    try {
      await h.worker.handle(message('incompatible', extra));
      assert.equal(h.events.includes('download'), false); assert.equal(h.providerCount(), 0);
      assert.equal(h.control.calls.find((call) => call.action === 'finish').data.status, 'failed');
      assert.ok(h.events.includes('ack'));
    } finally { await h.close(); }
  }
});

test('bucket privado é explícito e referências legadas mantêm a origem original', async () => {
  const h = await harness({ config: { s3: { bucket: 'media', speechBucket: 'private-speech' } } });
  try {
    assert.equal(h.worker.bucketFor({}), 'media');
    assert.equal(h.worker.bucketFor({ sourceBucket: 'media' }), 'media');
    assert.equal(h.worker.bucketFor({ sourceBucket: 'private-speech' }), 'private-speech');
    assert.throws(() => h.worker.bucketFor({ sourceBucket: 'another-tenant' }), { code: 'SOURCE_BUCKET_MISMATCH' });
    await h.worker.handle(message('forbidden', { source: { bucket: 'another-tenant', key: 'voice.ogg', mimeType: 'audio/ogg', bytes: 4 } }));
    assert.equal(h.providerCount(), 0); assert.equal(h.events.includes('download'), false);
    assert.equal(h.control.calls.find((call) => call.action === 'finish').data.errorCode, 'SOURCE_BUCKET_MISMATCH');
  } finally { await h.close(); }
});
