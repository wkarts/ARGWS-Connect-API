'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const amqp = require('amqplib');
const { TranscriptionWorker, normalizeJob, REQUESTED, PROCESSING, COMPLETED, FAILED } = require('../src/worker');
const { validateConfig } = require('../src/config');
const { createProvider, prepareModelCache } = require('../src/provider');

test('worker local mantém os tópicos do contrato', () => {
  assert.equal(REQUESTED, 'transcription.requested');
  assert.equal(PROCESSING, 'transcription.processing');
  assert.equal(COMPLETED, 'transcription.completed');
  assert.equal(FAILED, 'transcription.failed');
});

test('voz desabilitada encerra sem carregar modelo ou abrir MinIO', async () => {
  const worker = new TranscriptionWorker({ enabled: false, s3: {}, mode: 'transcription' });
  await worker.start();
  assert.equal(worker.provider, null);
  assert.equal(worker.client, null);
  assert.equal(fs.existsSync('/tmp/transcription-worker.ready'), false);
});

test('worker ocioso atende a fila sem carregar a pipeline nativa', async () => {
  const events = [];
  const worker = new TranscriptionWorker({
    enabled: true, mode: 'transcription', local: { modelPath: '/models/model' },
    s3: { endpoint: 'localhost', port: 9000, accessKey: 'key', secretKey: 'secret' },
  }, {
    verifyModel: async () => { events.push('verify'); },
    createInferenceClient: () => { events.push('load'); throw new Error('modelo não pode carregar ocioso'); },
  });
  worker.waitForPersistentModel = async () => {};
  worker.connect = async () => { events.push('consumer'); };
  worker.logMemory = () => {};
  try {
    await worker.start();
    assert.deepEqual(events, ['verify', 'consumer']);
    assert.equal(worker.provider, null);
  } finally {
    await worker.stop();
  }
});

test('o slot global cobre carregamento, processamento e liberação do modelo', async () => {
  const events = [];
  const worker = new TranscriptionWorker({
    enabled: true, mode: 'transcription', maxAudioBytes: 1024, maxAttempts: 3,
    heartbeatIntervalSeconds: 5, modelWarmupTimeoutSeconds: 1,
    local: { model: 'Xenova/whisper-small' }, provider: 'local',
  }, {
    acquireSlot: async () => {
      events.push('acquire');
      return { slot: 0, release: async () => { events.push('release'); } };
    },
    downloadAudio: async () => { events.push('download'); return { filePath: '/tmp/mock.ogg' }; },
    createInferenceClient: () => {
      events.push('load');
      return {
        warmup: async () => { events.push('warmup'); },
        transcribe: async () => { events.push('infer'); return { text: 'olá', durationMs: 1000 }; },
        stop: async () => { events.push('unload'); },
      };
    },
  });
  worker.channel = { ack: () => { events.push('ack'); } };
  worker.publish = async (status) => { if (status === 'completed') events.push('completed'); };
  worker.logMemory = () => {};
  const message = { content: Buffer.from(JSON.stringify({
    jobId: 'job-1', mode: 'transcription', source: { key: 'media/voice.ogg', mimeType: 'audio/ogg' },
  })) };
  await worker.handle(message, worker.channel);
  assert.deepEqual(events, ['acquire', 'download', 'load', 'warmup', 'infer', 'completed', 'ack', 'unload', 'release']);
  assert.equal(worker.provider, null);
});

test('warm-up sem progresso devolve erro recuperável e libera a thread', async () => {
  let stopped = 0;
  const worker = new TranscriptionWorker({ mode: 'transcription', modelWarmupTimeoutSeconds: 0.02 }, {
    createInferenceClient: () => ({
      warmup: () => new Promise(() => {}),
      stop: async () => { stopped += 1; },
    }),
  });
  worker.logMemory = () => {};
  await assert.rejects(worker.loadProvider({ jobId: 'slow-1' }), { code: 'MODEL_WARMUP_TIMEOUT' });
  assert.equal(stopped, 1);
  assert.equal(worker.provider, null);
});

test('mensagem recebida por canal antigo não recebe ACK no canal substituto', () => {
  const worker = Object.create(TranscriptionWorker.prototype);
  let acknowledged = 0;
  const oldChannel = { ack() { acknowledged += 1; }, nack() { acknowledged += 1; } };
  const newChannel = { ack() { acknowledged += 1; }, nack() { acknowledged += 1; } };
  worker.channel = newChannel;

  assert.equal(worker.acknowledge(oldChannel, { fields: { deliveryTag: 1 } }), false);
  assert.equal(worker.negativeAcknowledge(oldChannel, { fields: { deliveryTag: 1 } }, true), false);
  assert.equal(worker.acknowledge(newChannel, { fields: { deliveryTag: 2 } }), true);
  assert.equal(acknowledged, 1);
});

test('ACK e NACK repetidos não reutilizam a mesma delivery tag', () => {
  const worker = Object.create(TranscriptionWorker.prototype);
  let acknowledged = 0;
  let rejected = 0;
  const channel = {
    ack() { acknowledged += 1; },
    nack() { rejected += 1; },
  };
  const message = { fields: { deliveryTag: 6 } };
  worker.channel = channel;

  assert.equal(worker.acknowledge(channel, message), true);
  assert.equal(worker.acknowledge(channel, message), false);
  assert.equal(worker.negativeAcknowledge(channel, message, true), false);
  assert.equal(acknowledged, 1);
  assert.equal(rejected, 0);
});

test('SIGTERM cancela novas entregas e aguarda a confirmação do job ativo', async () => {
  const events = [];
  const worker = Object.create(TranscriptionWorker.prototype);
  worker.config = { shutdownGraceSeconds: 1 };
  worker.channel = { cancel: async () => { events.push('cancel'); }, close: async () => { events.push('channel-close'); } };
  worker.consumerTag = 'speech-1';
  worker.controlChannel = { close: async () => { events.push('control-close'); } };
  worker.connection = { close: async () => { events.push('connection-close'); } };
  worker.provider = { stop: async () => { events.push('provider-stop'); } };
  let finish;
  worker.activeTask = new Promise((resolve) => { finish = resolve; });
  const stopping = worker.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['cancel']);
  finish();
  await stopping;
  assert.deepEqual(events, ['cancel', 'provider-stop', 'control-close', 'channel-close', 'connection-close']);
});

test('cancelamento chega durante job ocupado e alcança cada réplica', async () => {
  const originalConnect = amqp.connect;
  const connections = [];
  amqp.connect = async () => {
    const makeChannel = () => ({
      handlers: new Map(), prefetchCount: null, acknowledgements: 0,
      on() {},
      async assertExchange() {},
      async assertQueue(name) { return { queue: name || `cancel-${connections.length}` }; },
      async bindQueue() {},
      async prefetch(count) { this.prefetchCount = count; },
      async consume(queue, callback) { this.handlers.set(queue, callback); return { consumerTag: `tag-${queue}` }; },
      ack() { this.acknowledgements += 1; },
      async close() {},
    });
    const job = makeChannel();
    const control = makeChannel();
    const connection = {
      on() {}, async createConfirmChannel() { return job; },
      async createChannel() { return control; }, async close() {},
    };
    connections.push({ job, control, connection });
    return connection;
  };

  const workers = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const worker = Object.create(TranscriptionWorker.prototype);
      worker.config = {
        rabbitmq: { uri: 'amqp://fixture', exchange: 'speech' },
        queue: 'speech.transcription', mode: 'transcription',
        requestRoutingKey: 'transcription.requested', cancelRoutingKey: 'speech.cancel.transcription',
        concurrency: 1,
      };
      worker.stopping = false;
      worker.cancelledJobs = new Set();
      worker.activeJobId = 'busy-job';
      worker.provider = { cancel() { worker.cancelled = true; } };
      await worker.connect();
      workers.push(worker);
    }
    for (let index = 0; index < workers.length; index += 1) {
      const { job, control } = connections[index];
      assert.equal(job.prefetchCount, 1);
      assert.equal(control.prefetchCount, 10);
      assert.notEqual(job, control);
      const delivery = { content: Buffer.from('{"jobId":"busy-job"}') };
      control.handlers.get(`cancel-${index + 1}`)(delivery);
      assert.equal(workers[index].cancelled, true);
      assert.equal(control.acknowledgements, 1);
      assert.equal(job.acknowledgements, 0);
    }
  } finally {
    amqp.connect = originalConnect;
    await fs.promises.rm('/tmp/transcription-worker.ready', { force: true });
  }
});

test('normaliza um job de áudio sem credencial externa', () => {
  const job = normalizeJob({ jobId: 'job-1', source: { key: 'audio/test.ogg', mimeType: 'audio/ogg' } });
  assert.equal(job.jobId, 'job-1');
  assert.equal(job.sourceMimeType, 'audio/ogg');
});

test('job inválido com ID conhecido termina com falha observável antes do ACK', async () => {
  const worker = Object.create(TranscriptionWorker.prototype);
  const events = [];
  const channel = { ack: () => events.push('ack') };
  worker.channel = channel;
  worker.config = { mode: 'dictation', maxAudioBytes: 1024 };
  worker.publish = async (status, payload) => { events.push(status); assert.equal(payload.errorCode, 'INVALID_JOB'); };
  worker.publishDeadLetter = async () => { events.push('dead-letter'); };
  await worker.handle({ content: Buffer.from(JSON.stringify({ jobId: 'invalid-1', mode: 'dictation',
    source: { key: 'dictation/invalid-1.webm', mimeType: 'audio/webm' }, inlineAudio: '?' })) }, channel);
  assert.deepEqual(events, ['failed', 'dead-letter', 'ack']);
});

test('retry preserva source, áudio do ditado e data para a próxima entrega', async () => {
  for (const mode of ['transcription', 'dictation']) {
    const worker = Object.create(TranscriptionWorker.prototype);
    const queuedAt = new Date(Date.now() - 10_000).toISOString();
    const input = { jobId: `retry-${mode}`, mode, attempts: 1, queuedAt,
      source: { key: `${mode}/audio.webm`, mimeType: 'audio/webm' },
      ...(mode === 'dictation' ? { inlineAudio: Buffer.from('audio').toString('base64') } : {}) };
    const job = normalizeJob(input);
    let next;
    const channel = { sendToQueue(_queue, body, _options, done) { next = JSON.parse(body.toString()); done(); } };
    worker.channel = channel;
    worker.config = { retryQueue: `${mode}.retry` };
    worker.publish = async () => {};
    await worker.scheduleRetry(job, { code: 'INFERENCE_STALLED' }, channel);
    const retried = normalizeJob(next);
    assert.equal(retried.attempts, 2);
    assert.equal(retried.sourceKey, job.sourceKey);
    assert.equal(retried.queuedAt, job.queuedAt);
    assert.equal(retried.inlineAudio?.toString('utf8'), job.inlineAudio?.toString('utf8'));
  }
});

test('aceita MIME de gravações WebM do navegador', () => {
  const withCodec = normalizeJob({ jobId: 'job-webm-1', source: { key: 'audio/test.webm', mimeType: 'audio/webm;codecs=opus' } });
  const browserVideoMime = normalizeJob({ jobId: 'job-webm-2', source: { key: 'audio/test.webm', mimeType: 'video/webm' } });
  assert.equal(withCodec.sourceMimeType, 'audio/webm');
  assert.equal(browserVideoMime.sourceMimeType, 'audio/webm');
});

test('configuração local não exige OPENAI_API_KEY_GLOBAL', () => {
  const config = {
    enabled: true,
    provider: 'local',
    queue: 'argws-connect.transcription',
    local: { model: 'Xenova/whisper-small', device: 'cpu', dtype: 'q8' },
    rabbitmq: { uri: 'amqp://rabbitmq', exchange: 'argws_connect' },
    s3: { accessKey: 'key', secretKey: 'secret', bucket: 'bucket' },
    modelStoragePrefix: 'transcription-models',
  };
  assert.doesNotThrow(() => validateConfig(config));
});

test('usa o modelo verificado diretamente do volume persistente', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'argws-transcription-model-'));
  const modelPath = path.join(root, 'Xenova', 'whisper-small');
  try {
    await fs.promises.mkdir(modelPath, { recursive: true });
    const model = Buffer.from('fixture-model');
    const digest = require('node:crypto').createHash('sha256').update(model).digest('hex');
    await fs.promises.writeFile(path.join(modelPath, 'model.onnx'), model);
    await fs.promises.writeFile(path.join(modelPath, '.speech-model-checksums.json'), JSON.stringify({
      algorithm: 'sha256',
      files: { 'model.onnx': digest },
    }));
    const preparedPath = await prepareModelCache({
      local: { cacheDir: path.join(root, 'cache-unused'), modelPath, model: 'Xenova/whisper-small' },
    });
    assert.equal(preparedPath, path.resolve(modelPath));
    assert.equal(fs.existsSync(path.join(root, 'cache-unused')), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('ditado local não calcula timestamps que não são exibidos', async () => {
  const calls = [];
  const provider = createProvider({
    provider: 'local',
    vadThresholdDb: -45,
    chunkSeconds: 30,
    strideSeconds: 5,
  }, {
    decodeAudio: async () => ({ samples: new Float32Array(16_000).fill(0.2), durationMs: 1000 }),
    createPipeline: async () => async (_samples, options) => {
      calls.push(options);
      return { text: 'teste', chunks: [{ text: 'teste', timestamp: [0, 1] }] };
    },
  });

  const result = await provider.transcribe('audio.webm', { mode: 'dictation' });

  assert.equal(calls[0].return_timestamps, false);
  assert.deepEqual(result.segments, []);
  assert.equal(result.text, 'teste');
});
