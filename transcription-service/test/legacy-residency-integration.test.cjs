'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const amqp = require('amqplib');
const { SpeechCoordinator } = require('../src/coordinator');
const { acquire } = require('../src/admission');

const uri = process.env.SPEECH_TEST_RABBITMQ_URI;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error('Timed out waiting for ' + label);
}

// The broker, delivery acknowledgements, exclusive leases, queue limits and
// notifications are real. Engine and durable API replies are instrumented here;
// native inference and PostgreSQL/MySQL authority have their own integration gates.
test('RabbitMQ real: legados ociosos estáveis, demanda justa e apenas uma residência/inferência',
  { skip: !uri, timeout: 90000 }, async () => {
    const namespace = 'residency-test-' + randomUUID();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), namespace));
    const queues = { transcription: namespace + '.transcription', dictation: namespace + '.dictation' };
    const admin = await amqp.connect(uri, { timeout: 5000 });
    const publishChannel = await admin.createConfirmChannel();
    const connections = { transcription: 0, dictation: 0 };
    const closes = { transcription: 0, dictation: 0 };
    const deliveries = new Map();
    const health = new Map();
    const trace = [];
    const completed = [];
    let residentModels = 0;
    let activeInferences = 0;
    let peakResidentModels = 0;
    let peakActiveInferences = 0;
    let releaseFirstChunk;
    const firstChunk = new Promise((resolve) => { releaseFirstChunk = resolve; });
    const workers = [];
    let oldLease;
    const models = { transcription: 'fixture-transcription-model', dictation: 'explicit-dictation-model' };

    const config = (mode) => ({
      enabled: true, provider: 'local', engine: 'whisper.cpp', mode, modes: [mode], poolId: namespace,
      local: { model: models[mode], device: 'cpu', dtype: 'q8' },
      s3: { bucket: 'fixture-audio' }, rabbitmq: { uri, exchange: namespace }, queues,
      globalConcurrency: 1, poolPrefetch: 10, modelIdleTtlSeconds: 300,
      heartbeatIntervalSeconds: 5, executionLeaseSeconds: 30, maxAttempts: 3,
      modelWarmupTimeoutSeconds: 1, maxAudioBytes: 1024,
    });

    const makeWorker = (mode) => {
      const worker = new SpeechCoordinator(config(mode), {
        connectBroker: async (...args) => {
          connections[mode] += 1;
          const connection = await amqp.connect(...args);
          connection.on('close', () => { closes[mode] += 1; });
          const createConfirmChannel = connection.createConfirmChannel.bind(connection);
          connection.createConfirmChannel = async () => {
            const channel = await createConfirmChannel();
            const consume = channel.consume.bind(channel);
            channel.consume = (queue, callback, options) => consume(queue, (message) => {
              if (message && Object.values(queues).includes(queue)) {
                const id = JSON.parse(message.content).jobId;
                deliveries.set(id, (deliveries.get(id) || 0) + 1);
              }
              callback(message);
            }, options);
            return channel;
          };
          return connection;
        },
        control: {
          connect: async () => {}, close: async () => {},
          request: async (action, job, data) => {
            trace.push({ action, mode, id: job.jobId });
            if (action === 'health') { health.set(mode, data.health); return { ok: true }; }
            if (action === 'claim' || action === 'lease') return {
              ok: true, granted: true, executionId: 'execution-' + job.jobId, generation: job.generation,
              leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
              deadlineAt: new Date(Date.now() + 120000).toISOString(),
            };
            if (action === 'finish') {
              assert.equal(data.status, 'completed');
              completed.push(job.jobId);
              return { ok: true, applied: true, terminal: true };
            }
            return { ok: true, applied: true };
          },
        },
        downloadAudio: async (job) => {
          trace.push({ action: 'download', mode, id: job.jobId });
          const sourceDirectory = await fs.mkdtemp(path.join(directory, 'audio-'));
          const filePath = path.join(sourceDirectory, job.jobId + '.ogg');
          await fs.writeFile(filePath, 'test');
          return { directory: sourceDirectory, filePath, bytes: 4 };
        },
        createInferenceClient: () => {
          let ready = false;
          let inferRunning = false;
          return {
            get ready() { return ready; },
            get status() { return { state: inferRunning ? 'transcribing' : 'idle', effectiveModel: models[mode] }; },
            async warmup() {
              if (!ready) {
                ready = true; residentModels += 1;
                peakResidentModels = Math.max(peakResidentModels, residentModels);
                trace.push({ action: 'model_loaded', mode });
              }
            },
            async stop() {
              assert.equal(inferRunning, false, 'handoff cannot kill an active chunk');
              if (ready) { await delay(75); ready = false; residentModels -= 1; trace.push({ action: 'model_stopped', mode }); }
            },
            async cancel() { throw new Error('Unexpected cancellation'); },
            async transcribeChunk(_file, job) {
              assert.equal(ready, true);
              inferRunning = true; activeInferences += 1;
              peakActiveInferences = Math.max(peakActiveInferences, activeInferences);
              trace.push({ action: 'infer', mode, id: job.jobId });
              try {
                if (job.jobId === 'transcription-0') await firstChunk;
                else await delay(75);
                this.lastSuccessfulInferenceAt = new Date().toISOString();
                return { done: true, result: { text: 'fixture', durationMs: 1000,
                  effectiveModel: models[mode], engine: 'whisper.cpp', segments: [] } };
              } finally { activeInferences -= 1; inferRunning = false; }
            },
          };
        },
      });
      worker.workerId = namespace + '-' + mode;
      worker.modelVerified = true;
      worker.logMemory = () => {};
      workers.push(worker);
      return worker;
    };

    const publish = (mode, number) => new Promise((resolve, reject) => {
      const id = mode + '-' + number;
      const body = Buffer.from(JSON.stringify({ version: 2, generation: 1, attempts: 1,
        jobId: id, poolId: namespace, mode, model: models[mode], instanceId: 'fixture-instance',
        source: { key: id + '.ogg', mimeType: 'audio/ogg', bytes: 4 } }));
      publishChannel.sendToQueue(queues[mode], body, { persistent: true, contentType: 'application/json' },
        (error) => error ? reject(error) : resolve());
    });

    try {
      const transcription = makeWorker('transcription');
      const dictation = makeWorker('dictation');
      await Promise.all(workers.map((worker) => worker.connect()));
      await delay(6500);
      assert.deepEqual(connections, { transcription: 1, dictation: 1 });
      assert.deepEqual(closes, { transcription: 0, dictation: 0 });
      assert.equal(residentModels, 0);
      assert.equal(workers.some((worker) => worker.residentLease), false);
      assert.equal(trace.some((entry) => entry.action === 'claim'), false);
      for (const mode of Object.keys(queues)) {
        assert.equal(health.get(mode).acceptingJobs, true);
        assert.equal(health.get(mode).engineReady, false);
        assert.equal(health.get(mode).effectiveModel, models[mode]);
        assert.equal((await publishChannel.checkQueue(queues[mode])).consumerCount, 1);
      }

      // A v2 owner that does not implement demand hints still excludes new
      // engines. The new worker cannot bypass the old exclusive residency queue.
      oldLease = await acquire(config('transcription'), () => false, () => {}, admin);
      await publish('transcription', 0);
      await until(() => deliveries.get('transcription-0') === 1, 'delivery behind older residence owner');
      await delay(700);
      assert.equal(residentModels, 0);
      await oldLease.release(); oldLease = null;
      await until(() => activeInferences === 1, 'first transcription chunk');

      // Both modes have backlog. Prefetch 1 keeps two of the three waiting
      // dictation jobs on RabbitMQ until the current chunk has yielded its slot.
      await Promise.all([publish('transcription', 1), publish('transcription', 2),
        publish('dictation', 0), publish('dictation', 1), publish('dictation', 2)]);
      await until(() => transcription.residencyRequestedAt, 'real contender notification');
      assert.equal((await publishChannel.checkQueue(queues.dictation)).messageCount, 2);
      assert.equal(completed.length, 0);
      assert.equal(residentModels, 1);
      releaseFirstChunk();
      await until(() => completed.length === 6, 'both queues drained without starvation', 30000);
      assert.equal(new Set(completed).size, 6);
      assert.ok(completed.indexOf('dictation-0') < completed.indexOf('transcription-1'));
      assert.equal(peakResidentModels, 1);
      assert.equal(peakActiveInferences, 1);
      assert.deepEqual(connections, { transcription: 1, dictation: 1 });
      assert.deepEqual(closes, { transcription: 0, dictation: 0 });
      assert.equal(dictation.config.local.model, 'explicit-dictation-model');
      for (const id of completed) {
        assert.equal(deliveries.get(id), 1, 'handoff must not cause a nack/redelivery loop');
        assert.ok(trace.findIndex((entry) => entry.action === 'claim' && entry.id === id) <
          trace.findIndex((entry) => entry.action === 'download' && entry.id === id));
      }
      const firstStopped = trace.findIndex((entry) => entry.action === 'model_stopped' && entry.mode === 'transcription');
      const secondLoaded = trace.findIndex((entry) => entry.action === 'model_loaded' && entry.mode === 'dictation');
      assert.ok(firstStopped >= 0 && firstStopped < secondLoaded);
      for (const queue of Object.values(queues)) assert.equal((await publishChannel.checkQueue(queue)).messageCount, 0);
    } finally {
      releaseFirstChunk();
      await oldLease?.release();
      await Promise.allSettled(workers.map((worker) => worker.stop()));
      for (const queue of Object.values(queues)) {
        await publishChannel.deleteQueue(queue).catch(() => {});
        await publishChannel.deleteQueue(queue + '.dead-letter').catch(() => {});
      }
      await publishChannel.deleteExchange(namespace).catch(() => {});
      await admin.close().catch(() => {});
      await fs.rm(directory, { recursive: true, force: true });
    }
    assert.equal(residentModels, 0);
  });
