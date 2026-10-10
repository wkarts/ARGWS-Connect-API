import { randomUUID } from 'crypto';

import {
  SPEECH_ACTIVE_STATUSES,
  SPEECH_PROTOCOL_VERSION,
  SPEECH_TERMINAL_STATUSES,
  speechDeadline,
  speechInteger,
  speechPoolId,
  speechScopeKey,
  TranscriptionServiceError,
} from './speech-policy';

type Database = any;
type ControlMessage = Record<string, any>;

/** Durable authority shared by all HTTP replicas. The worker has no SQL credentials. */
export class SpeechDurableService {
  constructor(
    private readonly database: Database,
    private readonly payloadFor: (job: any) => any,
  ) {}

  async transaction<T>(action: (tx: Database) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx: Database) => {
            const id = speechPoolId();
            await tx.speechPool.upsert({ where: { id }, create: { id }, update: { revision: { increment: 1 } } });
            // The upsert creates/locks the same row before reading counters. Serializable plus
            // a bounded retry also covers concurrent first-time creation on PostgreSQL/MySQL.
            return action(tx);
          },
          { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15_000 },
        );
      } catch (error: any) {
        if (attempt >= 3 || !['P2034', 'P2002'].includes(error?.code)) throw error;
      }
    }
  }

  private async assertQuota(
    tx: Database,
    scopeKey: string,
    additionalDurationMs: number,
    reservationId?: string,
    additionalBytes = 0,
  ) {
    const poolId = speechPoolId();
    const active = { poolId, status: { in: SPEECH_ACTIVE_STATUSES } };
    const reservations = {
      poolId,
      expiresAt: { gt: new Date() },
      ...(reservationId ? { id: { not: reservationId } } : {}),
    };
    const [poolJobs, scopeJobs, poolUploads, scopeUploads, duration, poolTotals] = await Promise.all([
      tx.transcriptionJob.count({ where: active }),
      tx.transcriptionJob.count({ where: { ...active, scopeKey } }),
      tx.speechUploadReservation.count({ where: reservations }),
      tx.speechUploadReservation.count({ where: { ...reservations, scopeKey } }),
      tx.transcriptionJob.aggregate({
        where: { ...active, scopeKey },
        _sum: { reservedDurationMs: true, reservedBytes: true },
      }),
      tx.transcriptionJob.aggregate({ where: active, _sum: { reservedDurationMs: true, reservedBytes: true } }),
    ]);
    if (poolJobs + poolUploads >= speechInteger('SPEECH_MAX_PENDING_JOBS', 50)) {
      throw new TranscriptionServiceError('O pool de voz atingiu o limite de trabalhos pendentes.', 429, 15);
    }
    if (scopeJobs + scopeUploads >= speechInteger('SPEECH_MAX_PENDING_JOBS_PER_INSTANCE', 5)) {
      throw new TranscriptionServiceError('A instância atingiu o limite de trabalhos de voz pendentes.', 429, 15);
    }
    const perJobSeconds = speechInteger('TRANSCRIPTION_MAX_DURATION_SECONDS', 3600, 1, 14_400);
    const durationLimit =
      speechInteger('SPEECH_MAX_PENDING_AUDIO_SECONDS_PER_INSTANCE', perJobSeconds * 5, 1, 604_800) * 1000;
    if (Number(duration?._sum?.reservedDurationMs || 0) + additionalDurationMs > durationLimit) {
      throw new TranscriptionServiceError('A instância atingiu a cota de duração de áudio pendente.', 429, 15);
    }
    const poolDurationLimit =
      speechInteger('SPEECH_MAX_PENDING_AUDIO_SECONDS', perJobSeconds * 50, 1, 2_592_000) * 1000;
    const poolByteLimit = speechInteger('SPEECH_MAX_PENDING_AUDIO_BYTES', 1_310_720_000, 1024, 2_000_000_000);
    const scopeByteLimit = speechInteger(
      'SPEECH_MAX_PENDING_AUDIO_BYTES_PER_INSTANCE',
      131_072_000,
      1024,
      2_000_000_000,
    );
    if (
      Number(poolTotals?._sum?.reservedDurationMs || 0) + additionalDurationMs > poolDurationLimit ||
      Number(poolTotals?._sum?.reservedBytes || 0) + additionalBytes > poolByteLimit ||
      Number(duration?._sum?.reservedBytes || 0) + additionalBytes > scopeByteLimit
    ) {
      throw new TranscriptionServiceError('O orçamento de bytes ou duração pendente de voz foi atingido.', 429, 15);
    }
  }

  async reserveUpload(instanceId: string | undefined, reservedBytes: number) {
    const poolId = speechPoolId();
    const scopeKey = speechScopeKey(instanceId);
    return this.transaction(async (tx) => {
      await this.assertQuota(tx, scopeKey, 0);
      const where = { poolId, expiresAt: { gt: new Date() } };
      const [count, perScope, bytes] = await Promise.all([
        tx.speechUploadReservation.count({ where }),
        tx.speechUploadReservation.count({ where: { ...where, scopeKey } }),
        tx.speechUploadReservation.aggregate({ where, _sum: { reservedBytes: true } }),
      ]);
      if (
        count >= speechInteger('SPEECH_MAX_UPLOADS', 2) ||
        perScope >= speechInteger('SPEECH_MAX_UPLOADS_PER_INSTANCE', 1)
      ) {
        throw new TranscriptionServiceError('Todas as vagas de recepção de áudio estão ocupadas.', 429, 5);
      }
      if (
        Number(bytes?._sum?.reservedBytes || 0) + reservedBytes >
        speechInteger('SPEECH_MAX_UPLOAD_BYTES', 52_428_800, 1024, 1_073_741_824)
      ) {
        throw new TranscriptionServiceError('O orçamento de bytes de upload de voz foi atingido.', 429, 5);
      }
      return tx.speechUploadReservation.create({
        data: {
          id: randomUUID(),
          poolId,
          scopeKey,
          reservedBytes,
          expiresAt: new Date(Date.now() + speechInteger('SPEECH_UPLOAD_RESERVATION_SECONDS', 180, 30, 900) * 1000),
        },
      });
    });
  }

  /** Global administrators may use the historical multipart instanceId field.
   * The pool budget was reserved before the body; bind the instance atomically
   * before any object-store write. Scoped/header admissions cannot be reassigned.
   */
  async reassignAdministrativeUpload(reservationId: string, instanceId: string) {
    return this.transaction(async (tx) => {
      const reservation = await tx.speechUploadReservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.poolId !== speechPoolId() || reservation.expiresAt <= new Date()) {
        throw new TranscriptionServiceError('A reserva de upload expirou.', 408);
      }
      const scopeKey = speechScopeKey(instanceId);
      if (reservation.scopeKey === scopeKey) return reservation;
      if (reservation.scopeKey !== speechScopeKey(null)) {
        throw new TranscriptionServiceError('O escopo de uma reserva autenticada não pode ser substituído.', 403);
      }
      await this.assertQuota(tx, scopeKey, 0, reservationId);
      const active = await tx.speechUploadReservation.count({
        where: {
          poolId: speechPoolId(),
          scopeKey,
          expiresAt: { gt: new Date() },
          id: { not: reservationId },
        },
      });
      if (active >= speechInteger('SPEECH_MAX_UPLOADS_PER_INSTANCE', 1)) {
        throw new TranscriptionServiceError('A instância atingiu o limite de recepções de áudio.', 429, 5);
      }
      return tx.speechUploadReservation.update({ where: { id: reservationId }, data: { scopeKey } });
    });
  }

  async createJob(data: any, reservationId?: string) {
    return this.transaction(async (tx) => {
      const duplicate = await tx.transcriptionJob.findFirst({
        where: {
          OR: [
            { dedupKey: data.dedupKey },
            ...(data.idempotencyHash ? [{ idempotencyHash: data.idempotencyHash }] : []),
          ],
        },
      });
      if (duplicate) {
        if (
          data.idempotencyHash &&
          duplicate.idempotencyHash === data.idempotencyHash &&
          duplicate.dedupKey !== data.dedupKey
        ) {
          throw new TranscriptionServiceError('Idempotency-Key já utilizada com outro áudio ou configuração.', 409);
        }
        // A concurrent content duplicate may already have uploaded another object.
        // Keep its source ledger until that redundant object is confirmed deleted.
        if (reservationId)
          await tx.speechUploadReservation.deleteMany({ where: { id: reservationId, sourceKey: null } });
        return duplicate;
      }
      if (reservationId) {
        const reservation = await tx.speechUploadReservation.findUnique({ where: { id: reservationId } });
        if (
          !reservation ||
          reservation.expiresAt <= new Date() ||
          reservation.poolId !== speechPoolId() ||
          reservation.scopeKey !== data.scopeKey ||
          reservation.sourceKey !== data.sourceKey ||
          reservation.sourceBucket !== data.sourceBucket ||
          Number(data.sizeBytes) > reservation.reservedBytes
        ) {
          throw new TranscriptionServiceError('A reserva de upload expirou. Envie o áudio novamente.', 408);
        }
      }
      await this.assertQuota(
        tx,
        data.scopeKey,
        data.reservedDurationMs,
        reservationId,
        Number(data.reservedBytes) || 0,
      );
      const job = await tx.transcriptionJob.create({
        data: {
          ...data,
          id: data.id || randomUUID(),
          protocolVersion: SPEECH_PROTOCOL_VERSION,
          poolId: speechPoolId(),
          status: 'queued',
          stage: 'queued',
          generation: 1,
          attempts: 1,
          deadlineAt: speechDeadline(data.mode),
        },
      });
      await this.writeOutbox(tx, job);
      if (reservationId) await tx.speechUploadReservation.deleteMany({ where: { id: reservationId } });
      return job;
    });
  }

  async writeOutbox(tx: Database, job: any, delayMs = 0) {
    const payload = this.payloadFor(job);
    await tx.speechOutbox.upsert({
      where: { jobId_generation: { jobId: job.id, generation: job.generation } },
      create: {
        id: randomUUID(),
        jobId: job.id,
        generation: job.generation,
        poolId: job.poolId,
        mode: job.mode,
        payload,
        availableAt: new Date(Date.now() + delayMs),
      },
      update: {
        payload,
        status: 'pending',
        dispatchToken: null,
        lockedUntil: null,
        availableAt: new Date(Date.now() + delayMs),
        publishedAt: null,
      },
    });
  }

  async cancel(jobId: string, instanceId?: string) {
    return this.transaction(async (tx) => {
      const job = await tx.transcriptionJob.findFirst({ where: { id: jobId, ...(instanceId ? { instanceId } : {}) } });
      if (!job) throw new TranscriptionServiceError('Job de voz não encontrado.', 404);
      if (job.status === 'cancelled') return job;
      if (!SPEECH_ACTIVE_STATUSES.includes(job.status))
        throw new TranscriptionServiceError('O job já foi concluído.', 409);
      const now = new Date();
      return tx.transcriptionJob.update({
        where: { id: job.id },
        data: {
          status: 'cancelled',
          stage: 'cancelled',
          cancelRequestedAt: now,
          completedAt: now,
          // Keep the token and its lease until the supervisor confirms death or it expires.
          // A cancelled native process must not immediately free the pool's resource budget.
        },
      });
    });
  }

  async retry(jobId: string, instanceId?: string) {
    return this.transaction(async (tx) => {
      const job = await tx.transcriptionJob.findFirst({ where: { id: jobId, ...(instanceId ? { instanceId } : {}) } });
      if (!job) throw new TranscriptionServiceError('Job de voz não encontrado.', 404);
      if (job.status !== 'failed')
        throw new TranscriptionServiceError('Somente jobs que falharam podem ser repetidos.', 409);
      if (
        job.sourceDeletedAt ||
        job.sourceDeletionStartedAt ||
        (job.sourceExpiresAt && job.sourceExpiresAt <= new Date())
      ) {
        throw new TranscriptionServiceError('O áudio deste job expirou ou está sendo removido.', 410);
      }
      if (job.leaseExpiresAt && job.leaseExpiresAt > new Date()) {
        throw new TranscriptionServiceError('Aguardando encerramento da execução anterior.', 409);
      }
      await this.assertQuota(tx, job.scopeKey, job.reservedDurationMs || 0, undefined, Number(job.reservedBytes) || 0);
      const next = await tx.transcriptionJob.update({
        where: { id: job.id },
        data: {
          protocolVersion: SPEECH_PROTOCOL_VERSION,
          poolId: speechPoolId(),
          status: 'queued',
          stage: 'queued',
          generation: { increment: 1 },
          attempts: 1,
          executionId: null,
          leaseExpiresAt: null,
          cancelRequestedAt: null,
          errorCode: null,
          errorMessage: null,
          completedAt: null,
          startedAt: null,
          heartbeatAt: null,
          controlHeartbeatAt: null,
          deadlineAt: speechDeadline(job.mode),
        },
      });
      await this.writeOutbox(tx, next);
      return next;
    });
  }

  async control(message: ControlMessage): Promise<Record<string, any>> {
    if (message.version !== SPEECH_PROTOCOL_VERSION || message.poolId !== speechPoolId()) {
      return { ok: false, granted: false, reason: 'UNSUPPORTED_PROTOCOL_OR_POOL', terminal: true };
    }
    const workerId = String(message.workerId || '').trim();
    if (!/^[A-Za-z0-9._:@-]{1,128}$/.test(workerId)) return { ok: false, reason: 'INVALID_WORKER_ID', terminal: true };
    if (message.action === 'health') return this.recordHealth(message, workerId);
    if (!['claim', 'lease', 'checkpoint', 'finish', 'release'].includes(message.action)) {
      return { ok: false, reason: 'INVALID_ACTION', terminal: true };
    }
    return this.transaction(async (tx) => {
      const job = await tx.transcriptionJob.findUnique({ where: { id: String(message.jobId || '') } });
      if (!job || job.poolId !== speechPoolId() || job.protocolVersion !== SPEECH_PROTOCOL_VERSION) {
        return { ok: true, granted: false, reason: 'JOB_ABSENT_OR_LEGACY', terminal: true };
      }
      const now = new Date();
      const terminal = SPEECH_TERMINAL_STATUSES.includes(job.status);
      const sameExecution =
        job.executionId &&
        job.executionId === message.executionId &&
        job.generation === Number(message.generation) &&
        job.workerId === workerId;
      if (message.action === 'finish' && terminal && sameExecution) {
        // Redelivery after a lost reply is safe. Also acknowledges cancellation after
        // the supervisor has really stopped the child process, freeing its lease.
        await tx.transcriptionJob.update({ where: { id: job.id }, data: { leaseExpiresAt: null } });
        return { ok: true, applied: true, terminal: true, cancelRequested: job.status === 'cancelled' };
      }
      if (terminal)
        return {
          ok: true,
          granted: false,
          reason: job.status.toUpperCase(),
          terminal: true,
          cancelRequested: job.status === 'cancelled',
        };
      if (job.deadlineAt && job.deadlineAt <= now) {
        await tx.transcriptionJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            stage: 'failed',
            errorCode: 'JOB_DEADLINE_EXCEEDED',
            errorMessage: 'O prazo absoluto do job expirou.',
            completedAt: now,
          },
        });
        return { ok: true, granted: false, reason: 'DEADLINE_EXCEEDED', terminal: true, cancelRequested: true };
      }
      if (job.generation !== Number(message.generation))
        return { ok: true, granted: false, reason: 'STALE_GENERATION', terminal: true };
      if (message.action === 'claim') {
        if (job.status !== 'queued' || job.executionId)
          return { ok: true, granted: false, reason: 'ALREADY_CLAIMED', terminal: true };
        const reclaimBefore = new Date(now.getTime() - 5000);
        const active = await tx.transcriptionJob.count({
          where: {
            poolId: job.poolId,
            executionId: { not: null },
            leaseExpiresAt: { gt: reclaimBefore },
          },
        });
        if (active >= speechInteger('SPEECH_GLOBAL_CONCURRENCY', 1, 1, 8)) {
          return { ok: true, granted: false, reason: 'CAPACITY_EXHAUSTED', retryAfterMs: 1000, terminal: false };
        }
        const executionId = randomUUID();
        const leaseExpiresAt = this.leaseExpiry(job, now);
        const updated = await tx.transcriptionJob.update({
          where: { id: job.id },
          data: {
            status: 'processing',
            stage: 'claimed',
            executionId,
            workerId,
            leaseExpiresAt,
            heartbeatAt: now,
            controlHeartbeatAt: now,
            startedAt: job.startedAt || now,
          },
        });
        return {
          ok: true,
          granted: true,
          executionId,
          generation: updated.generation,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          deadlineAt: updated.deadlineAt?.toISOString(),
          checkpoint: updated.checkpoint,
          job: this.payloadFor(updated),
          cancelRequested: false,
        };
      }
      if (!sameExecution || !job.leaseExpiresAt || job.leaseExpiresAt <= now || job.status !== 'processing') {
        return {
          ok: true,
          granted: false,
          applied: false,
          reason: 'LEASE_LOST',
          terminal: true,
          cancelRequested: true,
        };
      }
      if (message.action === 'finish') {
        const result = message.result || message.payload || {};
        const status = ['completed', 'failed', 'cancelled'].includes(message.status) ? message.status : 'failed';
        const modelMismatch =
          status === 'completed' &&
          (String(result.effectiveModel || result.model || '') !== String(job.requestedModel || job.model) ||
            String(result.engine || '') !== String(job.requestedEngine || '') ||
            String(result.modelRevision || '') !== String(job.requestedRevision || ''));
        const data: any = {
          status: modelMismatch ? 'failed' : status,
          stage: modelMismatch ? 'failed' : status,
          leaseExpiresAt: null,
          heartbeatAt: now,
          controlHeartbeatAt: now,
          completedAt: now,
        };
        if (status === 'completed' && !modelMismatch) {
          const checkpoint = this.validateCheckpoint(result, job);
          Object.assign(data, {
            text: String(result.text || '').slice(0, 100_000),
            segments: checkpoint.segments || [],
            durationMs: checkpoint.durationMs || null,
            processedDurationMs: checkpoint.durationMs || 0,
            progressPercent: 100,
            detectedLanguage: String(result.language || '').slice(0, 32) || null,
            provider: String(result.provider || 'local').slice(0, 32),
            effectiveModel: String(result.effectiveModel || result.model).slice(0, 100),
            engine: String(result.engine || '').slice(0, 32) || null,
            modelRevision: String(result.modelRevision || '').slice(0, 128) || null,
            engineProgressAt: now,
            errorCode: null,
            errorMessage: null,
          });
        } else if (status === 'failed' || modelMismatch) {
          Object.assign(data, {
            errorCode: modelMismatch
              ? 'EFFECTIVE_MODEL_MISMATCH'
              : String(message.errorCode || message.error?.code || result.errorCode || 'TRANSCRIPTION_FAILED').slice(
                  0,
                  64,
                ),
            errorMessage: modelMismatch
              ? 'O modelo executado diverge do modelo solicitado.'
              : String(
                  message.errorMessage || message.error?.message || result.errorMessage || 'Falha no worker de voz.',
                ).slice(0, 2000),
          });
        }
        await tx.transcriptionJob.update({ where: { id: job.id }, data });
        return { ok: true, applied: true, terminal: true };
      }
      const checkpoint = message.checkpoint || message.payload?.checkpoint;
      const checkpointData = checkpoint ? this.validateCheckpoint(checkpoint, job) : null;
      if (message.action === 'release') {
        const yielding = message.reason === 'yield';
        const maxAttempts = speechInteger('SPEECH_MAX_ATTEMPTS', 3, 1, 10);
        if (!yielding && job.attempts >= maxAttempts) {
          await tx.transcriptionJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              stage: 'failed',
              leaseExpiresAt: null,
              errorCode: 'MAX_ATTEMPTS_EXCEEDED',
              errorMessage: String(message.reason || 'Falha repetida do motor.').slice(0, 2000),
              completedAt: now,
            },
          });
          return { ok: true, applied: true, terminal: true };
        }
        const next = await tx.transcriptionJob.update({
          where: { id: job.id },
          data: {
            status: 'queued',
            stage: yielding ? 'queued' : 'retrying',
            generation: { increment: 1 },
            ...(!yielding ? { attempts: { increment: 1 } } : {}),
            executionId: null,
            leaseExpiresAt: null,
            controlHeartbeatAt: now,
            ...(checkpointData ? this.checkpointFields(checkpointData, now) : {}),
          },
        });
        await this.writeOutbox(
          tx,
          next,
          yielding ? 0 : Math.min(Math.max(Number(message.delayMs) || 30_000, 1000), 600_000),
        );
        return { ok: true, applied: true, terminal: false, generation: next.generation };
      }
      const leaseExpiresAt = this.leaseExpiry(job, now);
      const stage = String(message.stage || job.stage || 'processing').slice(0, 32);
      await tx.transcriptionJob.update({
        where: { id: job.id },
        data: {
          leaseExpiresAt,
          heartbeatAt: now,
          controlHeartbeatAt: now,
          stage,
          ...(checkpointData ? this.checkpointFields(checkpointData, now) : {}),
        },
      });
      return {
        ok: true,
        granted: true,
        applied: true,
        executionId: job.executionId,
        generation: job.generation,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        deadlineAt: job.deadlineAt?.toISOString(),
        cancelRequested: false,
      };
    });
  }

  private leaseExpiry(job: any, now: Date): Date {
    return new Date(
      Math.min(
        now.getTime() + speechInteger('SPEECH_LEASE_SECONDS', 30, 10, 120) * 1000,
        job.deadlineAt?.getTime() || Infinity,
      ),
    );
  }

  private validateCheckpoint(value: any, job: any) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Buffer.byteLength(JSON.stringify(value)) > 262_144
    ) {
      throw new TranscriptionServiceError('Checkpoint de voz inválido ou excessivo.', 400);
    }
    const durationMs = Math.max(0, Math.round(Number(value.durationMs) || 0));
    if (durationMs > Number(job.reservedDurationMs || 14_400_000)) {
      throw new TranscriptionServiceError('A duração verificada do áudio excede a reserva autorizada.', 413);
    }
    if (value.sourceSha256 && job.audioHash && value.sourceSha256 !== job.audioHash) {
      throw new TranscriptionServiceError('Checkpoint não pertence ao áudio deste job.', 409);
    }
    const previous = Number(job.checkpoint?.nextChunkIndex || 0);
    if (
      value.nextChunkIndex !== undefined &&
      (!Number.isInteger(value.nextChunkIndex) || value.nextChunkIndex < previous)
    ) {
      throw new TranscriptionServiceError('Checkpoint regressivo ou inválido.', 409);
    }
    return {
      ...value,
      text: String(value.text || '').slice(0, 100_000),
      segments: Array.isArray(value.segments) ? value.segments.slice(0, 10_000) : [],
      durationMs,
    };
  }

  private checkpointFields(checkpoint: any, now: Date) {
    const processedDurationMs = Math.max(
      0,
      Math.round(Number(checkpoint.processedDurationMs) || Number(checkpoint.offsetSamples || 0) / 16),
    );
    return {
      checkpoint,
      text: checkpoint.text,
      processedDurationMs,
      engineProgressAt: now,
      progressPercent:
        checkpoint.durationKnown === true && checkpoint.durationMs
          ? Math.min(99, Math.floor((processedDurationMs / checkpoint.durationMs) * 100))
          : 0,
    };
  }

  private async recordHealth(message: ControlMessage, workerId: string) {
    const input = message.health || message.payload || message;
    const modes = Array.isArray(input.modes)
      ? input.modes.filter((mode: string) => ['dictation', 'transcription'].includes(mode))
      : [];
    const last = Date.parse(String(input.lastSuccessfulInferenceAt || ''));
    const health = {
      processAlive: input.processAlive === true,
      brokerConnected: input.brokerConnected === true,
      modelVerified: input.modelVerified === true,
      engineReady: input.engineReady === true,
      acceptingJobs: input.acceptingJobs === true,
      state: String(input.state || 'warming').slice(0, 32),
      lastSuccessfulInferenceAt: Number.isFinite(last) ? new Date(Math.min(last, Date.now())).toISOString() : null,
      engine: String(input.engine || '').slice(0, 32),
      effectiveModel: String(input.effectiveModel || '').slice(0, 100),
      modelRevision: String(input.modelRevision || '').slice(0, 128),
    };
    // A consumer or a health timer alone never makes the engine ready.
    health.engineReady = health.engineReady && health.modelVerified && Boolean(health.lastSuccessfulInferenceAt);
    await this.database.speechWorker.upsert({
      where: { id: workerId },
      create: { id: workerId, poolId: speechPoolId(), modes, health, heartbeatAt: new Date() },
      update: { poolId: speechPoolId(), modes, health, heartbeatAt: new Date() },
    });
    return { ok: true, applied: true, heartbeatSeconds: 10 };
  }
}
