import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { TranscriptionService } from '@api/services/transcription.service';

test('polling de health reutiliza a conexão RabbitMQ e serializa init concorrente', async () => {
  const previous = process.env.SPEECH_ENABLED;
  process.env.SPEECH_ENABLED = 'true';
  try {
    const service = new TranscriptionService({} as any);
    let connections = 0;
    (service as any).startDefaultModelDownload = () => {};
    (service as any).startSourceCleanup = () => {};
    (service as any).startStaleRecovery = () => {};
    let finishSetup: (() => void) | undefined;
    const setup = new Promise<void>((resolve) => { finishSetup = resolve; });
    (service as any).connect = async () => {
      connections += 1;
      (service as any).connection = {};
      (service as any).channel = {};
      (service as any).resultChannel = {};
      await setup;
    };

    const first = service.init();
    let secondSettled = false;
    const second = service.init().then(() => { secondSettled = true; });
    await Promise.resolve();
    assert.equal(secondSettled, false);
    finishSetup!();
    await Promise.all([first, second, ...Array.from({ length: 18 }, () => service.init())]);
    for (let index = 0; index < 20; index += 1) await service.init();
    assert.equal(connections, 1);
    (service as any).resultChannel = null;
    await service.init();
    assert.equal(connections, 2);
  } finally {
    if (previous === undefined) delete process.env.SPEECH_ENABLED;
    else process.env.SPEECH_ENABLED = previous;
  }
});

function withStaleThreshold(callback: () => Promise<void>) {
  const original = process.env.TRANSCRIPTION_STALE_JOB_SECONDS;
  process.env.TRANSCRIPTION_STALE_JOB_SECONDS = '60';
  return callback().finally(() => {
    if (original === undefined) delete process.env.TRANSCRIPTION_STALE_JOB_SECONDS;
    else process.env.TRANSCRIPTION_STALE_JOB_SECONDS = original;
  });
}

test('recovery targets stale processing jobs only, even when RabbitMQ has no ready messages', async () => {
  await withStaleThreshold(async () => {
    let query: any;
    const repository = {
      transcriptionJob: {
        findMany: async (input: any) => {
          query = input;
          return [];
        },
      },
    };
    const service = new TranscriptionService(repository as any);
    (service as any).channel = { checkQueue: async () => ({ consumerCount: 1, messageCount: 0 }) };

    await (service as any).recoverStaleJobs();

    assert.deepEqual(query.where.status, 'processing');
    assert.ok(query.where.updatedAt.lt instanceof Date);
  });
});

test('recuperação observa jobs em execução mesmo quando não há consumidores', async () => {
  await withStaleThreshold(async () => {
    let queried = false;
    const repository = {
      transcriptionJob: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    };
    const service = new TranscriptionService(repository as any);
    (service as any).channel = { checkQueue: async () => ({ consumerCount: 0, messageCount: 1 }) };

    await (service as any).recoverStaleJobs();

    assert.equal(queried, true);
  });
});

test('heartbeat vencido aguarda a entrega original sem criar cópia do job ou perder áudio inline', async () => {
  await withStaleThreshold(async () => {
    const old = new Date(Date.now() - 180_000);
    const job = { id: 'dictation-redelivery', mode: 'dictation', status: 'processing',
      stage: 'transcribing', attempts: 1, updatedAt: old };
    const updates: any[] = [];
    const repository = { transcriptionJob: {
      findMany: async (query: any) => query.where?.status === 'processing' && query.where.mode === job.mode ? [job] : [],
      updateMany: async (update: any) => { updates.push(update); return { count: 1 }; },
    } };
    const service = new TranscriptionService(repository as any);
    (service as any).channel = { checkQueue: async () => ({ consumerCount: 1, messageCount: 0 }) };
    (service as any).publish = async () => { throw new Error('não pode republicar'); };
    await (service as any).recoverStaleJobs();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.stage, 'awaiting_redelivery');
    assert.equal(updates[0].data.attempts, undefined);
    assert.equal(updates[0].data.status, undefined);
  });
});

test('entrega interrompida sem recuperação termina em falha identificável', async () => {
  await withStaleThreshold(async () => {
    const old = new Date(Date.now() - 180_000);
    const job = { id: 'lost-job', mode: 'transcription', status: 'processing',
      stage: 'awaiting_redelivery', attempts: 1, updatedAt: old };
    let update: any;
    const service = new TranscriptionService({ transcriptionJob: {
      findMany: async (query: any) => query.where?.status === 'processing' && query.where.mode === job.mode ? [job] : [],
      updateMany: async (input: any) => { update = input; return { count: 1 }; },
    } } as any);
    (service as any).channel = { checkQueue: async () => ({ consumerCount: 0, messageCount: 0 }) };
    await (service as any).recoverStaleJobs();
    assert.equal(update.data.status, 'failed');
    assert.equal(update.data.errorCode, 'WORKER_HEARTBEAT_EXPIRED');
  });
});

test('watchdog aguarda o retry atrasado antes de reenfileirar o job', async () => {
  await withStaleThreshold(async () => {
    let updated = false;
    const repository = {
      transcriptionJob: {
        findMany: async (input: any) => input.where?.status === 'processing' ? [{
          id: 'retrying-job', mode: 'transcription', status: 'processing', stage: 'retrying', attempts: 3,
          heartbeatAt: new Date(Date.now() - 120_000), updatedAt: new Date(Date.now() - 120_000),
        }] : [],
        updateMany: async () => { updated = true; return { count: 1 }; },
      },
    };
    const service = new TranscriptionService(repository as any);
    (service as any).channel = { checkQueue: async () => ({ consumerCount: 1, messageCount: 0 }) };
    await (service as any).recoverStaleJobs();
    assert.equal(updated, false);
    assert.equal((service as any).isStaleJob({
      status: 'processing', stage: 'retrying', attempts: 2,
      updatedAt: new Date(Date.now() - 190_000),
    }), true);
  });
});

test('primeiro resultado do retry avança a tentativa persistida sem descartar o texto', async () => {
  const updates: any[] = [];
  const repository = {
    transcriptionJob: {
      findUnique: async () => ({ startedAt: new Date() }),
      updateMany: async (input: any) => {
        updates.push(input);
        return { count: input.where.stage === 'retrying' && input.where.attempts === 1 ? 1 : 0 };
      },
    },
  };
  const channel = { acknowledgements: 0, ack() { this.acknowledgements += 1; } };
  const service = new TranscriptionService(repository as any);
  (service as any).resultChannel = channel;
  await (service as any).consumeResult({ content: Buffer.from(JSON.stringify({
    jobId: 'retry-job', workerId: 'speech-worker-2', attempts: 2, status: 'completed', text: 'teste teste',
  })) }, channel);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].data.attempts, 2);
  assert.equal(updates[1].data.text, 'teste teste');
  assert.equal(updates[1].data.workerId, 'speech-worker-2');
  assert.equal(channel.acknowledgements, 1);
});

test('falha transitória do banco fecha o consumidor para reentregar o resultado', async () => {
  const service = new TranscriptionService({ transcriptionJob: {
    updateMany: async () => { throw new Error('database offline'); },
  } } as any);
  let closed = 0;
  let settled = 0;
  const connection = { close: async () => { closed += 1; } };
  const channel = { ack() { settled += 1; }, nack() { settled += 1; } };
  (service as any).connection = connection;
  (service as any).resultChannel = channel;
  (service as any).scheduleReconnect = () => {};
  await (service as any).consumeResult({ content: Buffer.from(JSON.stringify({
    jobId: 'db-offline', attempts: 1, status: 'completed', text: 'texto',
  })) }, channel);
  assert.equal(closed, 1);
  assert.equal(settled, 0);
});

test('ditado expirado na fila termina com estado failed em vez de ficar queued', async () => {
  const previousRetention = process.env.DICTATION_AUDIO_RETENTION_MINUTES;
  process.env.DICTATION_AUDIO_RETENTION_MINUTES = '1';
  let failureUpdate: any;
  try {
    const expired = { id: 'expired-dictation', attempts: 1, createdAt: new Date(Date.now() - 180_000) };
    const repository = {
      transcriptionJob: {
        findMany: async (input: any) => input.where?.status === 'queued' ? [expired] : [],
        updateMany: async (input: any) => { failureUpdate = input; return { count: 1 }; },
      },
    };
    const service = new TranscriptionService(repository as any);
    (service as any).channel = { checkQueue: async () => ({ consumerCount: 0, messageCount: 0 }) };
    await (service as any).recoverStaleJobs();
    assert.equal(failureUpdate.where.id, expired.id);
    assert.equal(failureUpdate.data.status, 'failed');
    assert.equal(failureUpdate.data.errorCode, 'DICTATION_AUDIO_EXPIRED');
  } finally {
    if (previousRetention === undefined) delete process.env.DICTATION_AUDIO_RETENTION_MINUTES;
    else process.env.DICTATION_AUDIO_RETENTION_MINUTES = previousRetention;
  }
});

test('a queued job cannot be manually retried based only on its age', async () => {
  await withStaleThreshold(async () => {
    const repository = {
      transcriptionJob: {
        findUnique: async () => ({
          id: 'queued-job',
          instanceId: null,
          status: 'queued',
          createdAt: new Date(Date.now() - 3_600_000),
          updatedAt: new Date(Date.now() - 3_600_000),
        }),
      },
    };
    const service = new TranscriptionService(repository as any);

    await assert.rejects(service.retry('queued-job'), (error: any) => error.status === 409);
  });
});

test('não cria segunda mensagem para processamento antigo e não refaz ditado sem áudio', async () => {
  const old = new Date(Date.now() - 600_000);
  const service = new TranscriptionService({ transcriptionJob: {
    findUnique: async ({ where }: any) => ({ id: where.id, status: where.id === 'dictation' ? 'failed' : 'processing',
      mode: where.id === 'dictation' ? 'dictation' : 'transcription', updatedAt: old }),
  } } as any);
  (service as any).publish = async () => { throw new Error('não deve publicar'); };
  await assert.rejects(service.retry('transcription'), (error: any) => error.status === 409);
  await assert.rejects(service.retry('dictation'), (error: any) => error.status === 410);
});

test('resultado de voz não confirma no canal novo após reconexão do RabbitMQ', async () => {
  let finishUpdate: ((value: { count: number }) => void) | undefined;
  const updatePending = new Promise<{ count: number }>((resolve) => { finishUpdate = resolve; });
  const repository = {
    transcriptionJob: {
      updateMany: async () => updatePending,
    },
  };
  const oldChannel = {
    ackCount: 0,
    nackCount: 0,
    ack() { this.ackCount += 1; },
    nack() { this.nackCount += 1; },
  };
  const newChannel = {
    ackCount: 0,
    nackCount: 0,
    ack() { this.ackCount += 1; },
    nack() { this.nackCount += 1; },
  };
  const service = new TranscriptionService(repository as any);
  (service as any).resultChannel = oldChannel;
  const message = {
    content: Buffer.from(JSON.stringify({
      jobId: 'job-channel-race',
      status: 'completed',
      attempts: 1,
      text: 'teste teste',
    })),
  };

  const consuming = (service as any).consumeResult(message, oldChannel);
  for (let attempt = 0; attempt < 10 && !finishUpdate; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof finishUpdate, 'function');
  (service as any).resultChannel = newChannel;
  finishUpdate!({ count: 1 });
  await consuming;

  assert.equal(oldChannel.ackCount, 0);
  assert.equal(newChannel.ackCount, 0);
  assert.equal(oldChannel.nackCount, 0);
  assert.equal(newChannel.nackCount, 0);
});

test('resultado da fila recebe somente um ACK ou NACK por delivery', () => {
  const service = new TranscriptionService({} as any);
  const channel = {
    ackCount: 0,
    nackCount: 0,
    ack() { this.ackCount += 1; },
    nack() { this.nackCount += 1; },
  };
  const message = { content: Buffer.from('{}') };
  (service as any).resultChannel = channel;

  assert.equal((service as any).acknowledgeResult(channel, message), true);
  assert.equal((service as any).acknowledgeResult(channel, message), false);
  assert.equal((service as any).rejectResult(channel, message, true), false);
  assert.equal(channel.ackCount, 1);
  assert.equal(channel.nackCount, 0);
});

test('ditado rejeita áudio sem dados e aceita gravação não vazia abaixo de 256 bytes', async () => {
  const previousEnabled = process.env.SPEECH_ENABLED;
  const previousLegacyEnabled = process.env.TRANSCRIPTION_ENABLED;
  process.env.SPEECH_ENABLED = 'true';
  delete process.env.TRANSCRIPTION_ENABLED;
  try {
    const service = new TranscriptionService({} as any);
    const existingJob = { id: 'existing-short-dictation' };
    (service as any).findDuplicate = async () => existingJob;
    (service as any).publicJob = (job: any) => job;

    await assert.rejects(
      service.enqueueDictation({ buffer: Buffer.alloc(0), fileName: 'ditado.webm', mimeType: 'audio/webm' }),
      (error: any) => error.status === 400 && /não contém dados/.test(error.message),
    );

    const job = await service.enqueueDictation({
      buffer: Buffer.alloc(32, 1),
      fileName: 'ditado.webm',
      mimeType: 'audio/webm',
    });
    assert.equal(job.id, existingJob.id);
  } finally {
    if (previousEnabled === undefined) delete process.env.SPEECH_ENABLED;
    else process.env.SPEECH_ENABLED = previousEnabled;
    if (previousLegacyEnabled === undefined) delete process.env.TRANSCRIPTION_ENABLED;
    else process.env.TRANSCRIPTION_ENABLED = previousLegacyEnabled;
  }
});
