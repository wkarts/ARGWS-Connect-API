'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { TranscriptionWorker, normalizeJob, queueArguments } = require('../src/worker');
const { loadConfig, validateConfig } = require('../src/config');
const { FairScheduler } = require('../src/fair-scheduler');
const { acquire } = require('../src/admission');

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
    async cancel() { events.push('cancel-consumer'); },
    async close() { events.push('channel-close'); },
    sendToQueue(_queue, _body, _options, done) { events.push('dlq'); done(); },
  };
  worker.connection = { async close() { events.push('connection-close'); } };
  worker.logMemory = () => {};
  worker.modelVerified = true;
  const close = async () => { await worker.stop(); await fs.promises.rm(root, { recursive: true, force: true }); };
  return { worker, control, events, close, providerCount: () => providerCount };
}

async function waitUntil(predicate, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), 'condition was not reached');
}

function waitForCancellation(h) {
  h.worker.acquireSlot = async (_config, cancelled) => {
    h.events.push('waiting-residency');
    while (!cancelled()) await new Promise((resolve) => setTimeout(resolve, 5));
    throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
  };
  h.worker.controlChannel = { ack: () => h.events.push('control-ack'), close: async () => {} };
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

test('dois coordenadores legados ociosos ficam disponíveis sem reservar modelo ou reiniciar conexão', async () => {
  const first = await harness({ config: { mode: 'transcription', modes: ['transcription'], modelIdleTtlSeconds: 0.01 } });
  const second = await harness({ config: { mode: 'dictation', modes: ['dictation'], modelIdleTtlSeconds: 0.01,
    local: { model: 'explicit-dictation-model', device: 'cpu', dtype: 'q8' } } });
  const owners = new Map();
  const trace = [];
  let nextTag = 0;
  const connect = (label) => async () => {
    const connection = new EventEmitter();
    let closed = false;
    connection.close = async () => {
      if (closed) return;
      closed = true;
      for (const [name, owner] of owners) if (owner === connection) owners.delete(name);
      connection.emit('close');
    };
    connection.createChannel = connection.createConfirmChannel = async () => {
      const channel = new EventEmitter();
      channel.assertExchange = async () => {};
      channel.assertQueue = async (name, options) => {
        if (name && options?.exclusive) {
          if (owners.has(name)) throw Object.assign(new Error('RESOURCE_LOCKED'), { code: 405 });
          owners.set(name, connection); trace.push(label + ':acquire');
        }
        return { queue: name || label + '-control' };
      };
      channel.deleteQueue = async (name) => {
        if (owners.get(name) === connection) { owners.delete(name); trace.push(label + ':release'); }
      };
      channel.bindQueue = channel.prefetch = async () => {};
      channel.prefetch = async (count) => { trace.push(label + ':prefetch:' + count); };
      channel.consume = async () => ({ consumerTag: 'consumer-' + ++nextTag });
      channel.cancel = async () => { trace.push(label + ':cancel'); };
      channel.close = async () => channel.emit('close');
      return channel;
    };
    return connection;
  };
  try {
    for (const [label, item] of [['transcription', first], ['dictation', second]]) {
      item.worker.connectBroker = connect(label);
      item.worker.acquireSlot = acquire;
      item.control.connect = async () => {};
    }
    await Promise.all([first.worker.connect(), second.worker.connect()]);
    const firstConnection = first.worker.connection;
    const secondConnection = second.worker.connection;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(first.worker.residentLease, null);
    assert.equal(second.worker.residentLease, null);
    assert.equal(first.worker.connection, firstConnection);
    assert.equal(second.worker.connection, secondConnection);
    assert.equal(first.worker.consumerTags.length, 1);
    assert.equal(second.worker.consumerTags.length, 1);
    assert.equal(first.providerCount(), 0); assert.equal(second.providerCount(), 0);
    assert.equal(first.worker.config.mode, 'transcription'); assert.equal(second.worker.config.mode, 'dictation');
    assert.equal(second.worker.config.local.model, 'explicit-dictation-model');
    assert.equal(owners.size, 0);
    assert.equal(trace.some((event) => /acquire|release|cancel/.test(event)), false);
    for (const [label, item] of [['transcription', first], ['dictation', second]]) {
      assert.ok(trace.includes(label + ':prefetch:1'));
      const health = item.control.calls.filter((call) => call.action === 'health').at(-1).data.health;
      assert.equal(health.acceptingJobs, true);
      assert.equal(health.engineReady, false);
      assert.equal(health.state, 'idle');
    }
  } finally {
    await first.close(); await second.close();
  }
  assert.equal(owners.size, 0);
});

test('entrega durante devolução ociosa aguarda stop nativo sem fechar conexão ou perder job', async () => {
  const h = await harness({ config: { mode: 'transcription', modes: ['transcription'], modelIdleTtlSeconds: 0.01 } });
  let finishStop;
  const stopped = new Promise((resolve) => { finishStop = resolve; });
  try {
    await h.worker.handle(message('first'));
    h.worker.provider.stop = async () => { h.events.push('stop-native-start'); await stopped; h.events.push('stop-native-done'); };
    h.worker.consumerTags = ['legacy-consumer'];
    h.worker.scheduleIdleUnload();
    const deadline = Date.now() + 1000;
    while (!h.events.includes('stop-native-start') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(h.events.includes('stop-native-start'));
    const delivery = message('arrived-during-stop');
    h.worker.scheduler.add(normalizeJob(JSON.parse(delivery.content)), { message: delivery,
      channel: h.worker.channel, queueMode: 'transcription' });
    h.worker.pump();
    assert.equal(h.providerCount(), 1);
    assert.equal(h.events.filter((event) => event === 'ack').length, 1);
    assert.equal(h.events.includes('release-residency'), false);
    finishStop();
    await h.worker.residencyReleaseTask;
    await new Promise((resolve) => setImmediate(resolve));
    await h.worker.pumpTask;
    assert.equal(h.events.filter((event) => event === 'ack').length, 2);
    assert.equal(h.providerCount(), 2);
    assert.ok(h.events.indexOf('stop-native-done') < h.events.indexOf('release-residency'));
    assert.equal(h.events.includes('connection-close'), false);
    assert.equal(h.worker.consumerTags.length, 1);
  } finally { finishStop(); await h.close(); }
});

test('encerramento concorrente com a devolução ociosa libera cada residência uma única vez', async () => {
  const h = await harness({ config: { mode: 'transcription', modes: ['transcription'], modelIdleTtlSeconds: 0.01 } });
  let finishRelease;
  let releaseCalls = 0;
  const released = new Promise((resolve) => { finishRelease = resolve; });
  try {
    await h.worker.ensureResidency();
    h.worker.residentLease.release = async () => { releaseCalls += 1; await released; };
    h.worker.scheduleIdleUnload();
    const deadline = Date.now() + 1000;
    while (!releaseCalls && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(releaseCalls, 1);
    const stopping = h.worker.stop();
    finishRelease();
    await stopping;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releaseCalls, 1);
    assert.equal(h.worker.residentLease, null);
    assert.equal(h.worker.stopping, true);
  } finally { finishRelease(); await h.close(); }
});

test('pedido de capacidade não libera residência quando a morte do engine não foi confirmada', async () => {
  const h = await harness();
  let provider;
  try {
    await h.worker.handle(message('before-handoff'));
    provider = h.worker.provider;
    const lease = h.worker.residentLease;
    provider.stop = async () => { throw Object.assign(new Error('native still alive'), { code: 'PROCESS_TERMINATION_FAILED' }); };
    h.worker.handleResidencyRequest({ content: Buffer.from(JSON.stringify({ version: 2, workerId: 'contender',
      poolId: 'fixture', requestedAt: Date.now() })) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.worker.stopping, true);
    assert.equal(h.worker.fatalError.code, 'PROCESS_TERMINATION_FAILED');
    assert.equal(h.worker.residentLease, lease);
    assert.equal(h.worker.provider, provider);
    assert.equal(h.events.includes('release-residency'), false);
    assert.equal(h.events.includes('connection-close'), false);
    await assert.rejects(h.worker.stop(), { code: 'PROCESS_TERMINATION_FAILED' });
    assert.equal(h.events.includes('release-residency'), false);
  } finally {
    if (provider) provider.stop = async () => h.events.push('stop-native');
    h.worker.stopPromise = null;
    await h.close();
  }
});

test('falha de warmup que não consegue matar o engine preserva referência e trava no shutdown', async () => {
  const h = await harness();
  let canStop = false;
  try {
    h.worker.createInferenceClient = () => ({
      warmup: async () => { throw new Error('warmup failed'); },
      stop: async () => { if (!canStop) throw Object.assign(new Error('still alive'), { code: 'PROCESS_TERMINATION_FAILED' }); },
    });
    await h.worker.handle(message('warmup-failure'));
    assert.equal(h.worker.stopping, true);
    assert.ok(h.worker.provider);
    assert.ok(h.worker.residentLease);
    assert.equal(h.events.includes('ack'), false);
    await assert.rejects(h.worker.stop(), { code: 'PROCESS_TERMINATION_FAILED' });
    assert.equal(h.events.includes('release-residency'), false);
  } finally { canStop = true; h.worker.stopPromise = null; await h.close(); }
});

test('perda de conexão aguarda unload já iniciado antes de liberar os recursos AMQP', async () => {
  const h = await harness();
  let finishStop;
  const stopped = new Promise((resolve) => { finishStop = resolve; });
  try {
    await h.worker.handle(message('before-loss'));
    h.worker.provider.stop = async () => { h.events.push('stop-native-start'); await stopped; h.events.push('stop-native-done'); };
    const unloading = h.worker.unloadProvider();
    const losing = h.worker.onConnectionLost(h.worker.connection);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.events.includes('connection-close'), false);
    finishStop();
    await Promise.all([unloading, losing]);
    assert.ok(h.events.indexOf('stop-native-done') < h.events.indexOf('connection-close'));
  } finally { finishStop(); await h.close(); }
});

test('aviso antigo, de outro pool ou sem identidade não provoca devolução', async () => {
  const h = await harness();
  try {
    await h.worker.handle(message('existing'));
    for (const override of [{ poolId: 'other' }, { workerId: '' }, { requestedAt: Date.now() - 60000 }]) {
      h.worker.handleResidencyRequest({ content: Buffer.from(JSON.stringify({ version: 2, workerId: 'contender',
        poolId: 'fixture', requestedAt: Date.now(), ...override })) });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(h.worker.provider); assert.ok(h.worker.residentLease);
    assert.equal(h.events.includes('stop-native'), false);
  } finally { await h.close(); }
});

test('aviso sob backpressure não espera confirmação nem acumula escritas ou listeners', async () => {
  const h = await harness();
  let writes = 0;
  const channel = new EventEmitter();
  channel.publish = (...args) => {
    writes += 1;
    assert.equal(args.length, 4, 'hint must not install a publisher-confirm callback');
    assert.equal(args[1], 'speech.residency.requested.v2');
    assert.ok(args[2].length <= 2048);
    assert.equal(args[3].expiration, '30000');
    return false;
  };
  channel.close = async () => channel.emit('close');
  h.worker.controlChannel = channel;
  try {
    await Promise.all(Array.from({ length: 50 }, () => h.worker.requestResidency(h.worker.connection)));
    assert.equal(writes, 1);
    assert.equal(channel.listenerCount('drain'), 1); assert.equal(channel.listenerCount('close'), 1);
    channel.emit('drain');
    await h.worker.requestResidency(h.worker.connection);
    assert.equal(writes, 2);
    channel.emit('close');
    assert.equal(h.worker.residencyHintBackpressure, null);
    assert.equal(channel.listenerCount('drain'), 0); assert.equal(channel.listenerCount('close'), 0);
    await h.worker.requestResidency(h.worker.connection);
    await h.worker.stop();
    assert.equal(channel.listenerCount('drain'), 0); assert.equal(channel.listenerCount('close'), 0);
  } finally { await h.close(); }
});

test('demanda durante unload ou delete pendente promove a devolução ociosa para handoff', async () => {
  for (const phase of ['native', 'delete']) {
    const h = await harness();
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    try {
      await h.worker.handle(message('first'));
      if (phase === 'native') h.worker.provider.stop = async () => { await pending; };
      else h.worker.residentLease.release = async () => { await pending; };
      const releasing = h.worker.releaseResidency();
      if (phase === 'delete') await waitUntil(() => h.worker.residentLease === null);
      h.worker.handleResidencyRequest({ content: Buffer.from(JSON.stringify({ version: 2,
        workerId: 'waiting-worker', poolId: 'fixture', requestedAt: Date.now() })) });
      finish();
      await releasing;
      assert.ok(h.worker.residencyCooldownUntil - Date.now() >= 5800);
      assert.equal(h.events.includes('connection-close'), false);
    } finally { finish(); await h.close(); }
  }
});

test('deadline enquanto aguarda capacidade consulta autoridade e não carrega modelo nem inventa falha', async () => {
  const h = await harness({ control: async (action) => action === 'claim'
    ? { ok: true, granted: false, terminal: true, reason: 'DEADLINE_EXCEEDED' } : undefined });
  try {
    waitForCancellation(h);
    await h.worker.handle(message('expires-waiting', { deadlineAt: new Date(Date.now() + 30).toISOString() }));
    assert.ok(h.events.includes('waiting-residency'));
    assert.equal(h.control.calls.filter((call) => call.action === 'claim').length, 1);
    assert.equal(h.events.filter((event) => event === 'ack').length, 1);
    assert.equal(h.events.includes('download'), false); assert.equal(h.providerCount(), 0);
    assert.equal(h.events.includes('finish'), false); assert.equal(h.events.includes('release'), false);
  } finally { await h.close(); }
});

test('cancelamento aguardando capacidade só confirma job após terminal autoritativo', async () => {
  const h = await harness({ control: async (action) => action === 'claim'
    ? { ok: true, granted: false, terminal: true, cancelRequested: true } : undefined });
  try {
    waitForCancellation(h);
    const processing = h.worker.handle(message('cancel-queued'));
    await waitUntil(() => h.events.includes('waiting-residency'));
    h.worker.handleControl({ content: Buffer.from(JSON.stringify({ jobId: 'cancel-queued', generation: 1 })) });
    await processing;
    assert.ok(h.events.indexOf('claim') < h.events.indexOf('ack'));
    assert.equal(h.events.includes('download'), false); assert.equal(h.providerCount(), 0);
    assert.equal(h.events.includes('finish'), false); assert.equal(h.events.includes('release'), false);
    assert.equal(h.control.calls.find((call) => call.action === 'claim').job.generation, 1);
  } finally { await h.close(); }
});

test('hint atrasado com claim válido devolve por yield confirmado sem inferência ou incremento de tentativa', async () => {
  let finishRelease;
  const released = new Promise((resolve) => { finishRelease = resolve; });
  const h = await harness({ control: async (action) => {
    if (action === 'release') { await released; return { ok: true, applied: true, generation: 2 }; }
  } });
  try {
    waitForCancellation(h);
    const processing = h.worker.handle(message('stale-hint'));
    await waitUntil(() => h.events.includes('waiting-residency'));
    h.worker.handleControl({ content: Buffer.from(JSON.stringify({ jobId: 'stale-hint', generation: 1 })) });
    await waitUntil(() => h.events.includes('release'));
    assert.equal(h.events.includes('ack'), false);
    const release = h.control.calls.find((call) => call.action === 'release');
    assert.equal(release.data.reason, 'yield'); assert.equal(release.job.attempts, 1);
    assert.equal(release.job.generation, 1); assert.equal(release.job.executionId, 'exec-stale-hint');
    finishRelease(); await processing;
    assert.equal(h.events.includes('ack'), true);
    assert.equal(h.events.includes('finish'), false); assert.equal(h.events.includes('download'), false);
    assert.equal(h.providerCount(), 0);
  } finally { finishRelease(); await h.close(); }
});

test('rechecagem sem capacidade devolve defer e mantém entrega sem ACK ou retry de execução', async () => {
  const h = await harness({ control: async (action) => action === 'claim'
    ? { ok: true, granted: false, terminal: false, reason: 'CAPACITY_EXHAUSTED', retryAfterMs: 1000 } : undefined });
  try {
    const outcome = await h.worker.handle(message('deadline-clock-race', { deadlineAt: new Date(Date.now() - 1000).toISOString() }));
    assert.equal(outcome.defer, true); assert.equal(outcome.job.attempts, 1); assert.equal(outcome.job.generation, 1);
    assert.equal(h.events.includes('ack'), false); assert.equal(h.events.includes('nack'), false);
    assert.equal(h.events.includes('acquire'), false); assert.equal(h.events.includes('download'), false);
    assert.equal(h.events.includes('release'), false); assert.equal(h.events.includes('finish'), false);
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
