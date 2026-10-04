import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { TranscriptionService } from '@api/services/transcription.service';

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

test('recovery does not inspect or republish jobs while no worker consumes the queue', async () => {
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

    assert.equal(queried, false);
  });
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
