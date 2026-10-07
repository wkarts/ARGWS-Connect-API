import { PrismaRepository } from '@api/repository/repository.service';
import {
  getConfiguredSpeechModel,
  SpeechModelDownloadService,
  SpeechModelDownloadStatus,
} from '@api/services/speech-model-download.service';
import { Logger } from '@config/logger.config';
import * as amqp from 'amqplib';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

import { SpeechDurableService } from './speech-durable.service';
import {
  publishSpeechConfirmed,
  SPEECH_ACTIVE_STATUSES,
  SPEECH_CONTROL_ROUTING_KEY,
  SPEECH_PROTOCOL_VERSION,
  speechDeadLetterArguments,
  speechDictationRetentionMs,
  speechHash,
  speechInteger,
  speechPoolId,
  speechQueue,
  speechQueueArguments,
  speechRequestRoutingKey,
  speechScopeKey,
  TranscriptionServiceError,
} from './speech-policy';
import { SpeechSourceStorage } from './speech-source-storage';

export { TranscriptionServiceError } from './speech-policy';

const SOURCE_PREFIX = 'transcriptions/';
const truthy = new Set(['1', 'true', 'yes', 'on']);
const audioMimeAliases: Record<string, string> = {
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/opus',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/webm': 'audio/webm',
  'video/webm': 'audio/webm',
  'audio/amr': 'audio/amr',
};
const audioMimeByExtension: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.amr': 'audio/amr',
};

/** Browser MIME normalization; the worker still probes the actual stream. */
export function normalizeTranscriptionAudioMime(value: unknown, fileName?: string): string {
  const declared = String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (audioMimeAliases[declared]) return audioMimeAliases[declared];
  return ['', 'application/octet-stream', 'video/webm'].includes(declared)
    ? audioMimeByExtension[path.extname(String(fileName || '')).toLowerCase()] || ''
    : '';
}
function enabledValue(value: unknown, fallback = false): boolean {
  return value === undefined || value === null ? fallback : truthy.has(String(value).trim().toLowerCase());
}
function safeLanguage(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(String(value).trim()))
    throw new TranscriptionServiceError('language inválido. Use pt ou pt-BR.', 400);
  return String(value).trim();
}
function safeModel(value: unknown): string {
  const configured = getConfiguredSpeechModel();
  if (!configured)
    throw new TranscriptionServiceError('O motor e o modelo configurados não constam do catálogo permitido.', 409);
  const requested = String(value || configured.id).trim();
  if (requested !== configured.id)
    throw new TranscriptionServiceError('O modelo solicitado não está provisionado neste pool.', 409);
  return requested;
}
function providerValue(): string {
  const provider = String(process.env.SPEECH_PROVIDER || process.env.TRANSCRIPTION_PROVIDER || 'local')
    .trim()
    .toLowerCase();
  if (!['local', 'transformers', 'whisper.cpp'].includes(provider))
    throw new TranscriptionServiceError('Provider de fala não suportado. Configure um adaptador explicitamente.', 409);
  return provider;
}
function safeIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const key = String(value).trim();
  if (key.length > 128 || [...key].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f))
    throw new TranscriptionServiceError('Idempotency-Key inválida.', 400);
  return key;
}
export function speechUploadLimit(mode: string): number {
  return mode === 'dictation'
    ? speechInteger('DICTATION_MAX_AUDIO_BYTES', 5_242_880, 1, 26_214_400)
    : speechInteger('TRANSCRIPTION_MAX_AUDIO_BYTES', 26_214_400, 1, 262_144_000);
}
type EnqueueInput = {
  messageId?: string;
  instanceId?: string;
  language?: string;
  model?: string;
  idempotencyKey?: string;
};
type UploadInput = {
  filePath?: string;
  buffer?: Buffer;
  fileName?: string;
  mimeType?: string;
  instanceId?: string;
  language?: string;
  model?: string;
  idempotencyKey?: string;
  reservationId?: string;
  durationMs?: number;
};

/** HTTP and SQL orchestrate metadata. Audio bytes never enter an AMQP message. */
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly modelDownloadService = new SpeechModelDownloadService();
  private readonly durable: SpeechDurableService;
  private readonly sourceStorage = new SpeechSourceStorage();
  private connection: any = null;
  private channel: any = null;
  private resultChannel: any = null;
  private initializing: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private outboxTimer: NodeJS.Timeout | null = null;
  private outboxInFlight = false;
  private sourceCleanupTimer: NodeJS.Timeout | null = null;
  private sourceCleanupInFlight = false;
  private sourceCleanupCursor: string | undefined;
  private reservationCleanupCursor: string | undefined;
  private staleRecoveryTimer: NodeJS.Timeout | null = null;
  private staleRecoveryInFlight = false;
  private staleRecoveryCursor: string | undefined;
  private modelBootstrapStarted = false;

  constructor(private readonly prismaRepository: PrismaRepository) {
    this.durable = new SpeechDurableService(prismaRepository, (job) => this.jobPayload(job));
  }
  public isEnabled(): boolean {
    return enabledValue(process.env.SPEECH_ENABLED, enabledValue(process.env.TRANSCRIPTION_ENABLED, false));
  }
  public isDictationEnabled(): boolean {
    return this.isEnabled() && enabledValue(process.env.DICTATION_ENABLED, true);
  }
  public async init(): Promise<void> {
    // Disabling new speech submissions does not suspend retention of existing audio.
    if (this.sourceStorage.enabled()) this.startSourceCleanup();
    if (!this.isEnabled()) return;
    this.startDefaultModelDownload();
    this.startStaleRecovery();
    if (!enabledValue(process.env.RABBITMQ_ENABLED, true)) return;
    if (this.initializing) return this.initializing;
    if (this.connection && this.channel && this.resultChannel) return;
    this.initializing = this.connect()
      .catch((error) => {
        this.logger.warn('Fila de voz indisponível: ' + (error?.message || error));
        this.scheduleReconnect();
      })
      .finally(() => {
        this.initializing = null;
      });
    return this.initializing;
  }
  private startDefaultModelDownload() {
    if (this.modelBootstrapStarted || !enabledValue(process.env.SPEECH_MODEL_AUTO_PROVISION)) return;
    this.modelBootstrapStarted = true;
    void this.modelDownloadService
      .status()
      .then(async (status) => {
        if (status.available && !status.installed) await this.modelDownloadService.start(status.id);
      })
      .catch((error) => this.logger.warn('Provisionamento de voz indisponível: ' + (error?.message || error)));
  }
  public async resolveInstanceName(instanceName: string): Promise<string> {
    const instance = await (this.prismaRepository.instance as any).findUnique({
      where: { name: instanceName },
      select: { id: true },
    });
    if (!instance) throw new TranscriptionServiceError('Instância não encontrada.', 404);
    return instance.id;
  }
  private async validateInstanceId(instanceId?: string) {
    if (!instanceId) return;
    if (typeof instanceId !== 'string' || instanceId.length > 128)
      throw new TranscriptionServiceError('Instância inválida.', 400);
    if (
      !(await (this.prismaRepository.instance as any).findUnique({ where: { id: instanceId }, select: { id: true } }))
    )
      throw new TranscriptionServiceError('Instância não encontrada.', 404);
  }
  public async reserveUpload(mode: string, instanceId?: string) {
    await this.ready(mode);
    if (!this.sourceStorage.enabled())
      throw new TranscriptionServiceError('O armazenamento privado de áudio não está disponível.', 503);
    await this.validateInstanceId(instanceId);
    await this.sourceStorage.ensurePrivate();
    return this.durable.reserveUpload(instanceId, speechUploadLimit(mode));
  }
  public async releaseUpload(reservationId?: string) {
    if (reservationId)
      await (this.prismaRepository as any).speechUploadReservation.deleteMany({
        where: { id: reservationId, sourceKey: null },
      });
  }
  public async reassignAdministrativeUpload(reservationId: string, instanceId: string) {
    await this.validateInstanceId(instanceId);
    return this.durable.reassignAdministrativeUpload(reservationId, instanceId);
  }
  public async list(limit = 30, mode = 'transcription', instanceId?: string) {
    if (!this.isEnabled()) return [];
    const take = Number.isFinite(Number(limit)) ? Math.min(Math.max(Math.floor(Number(limit)), 1), 100) : 30;
    const jobs = await (this.prismaRepository.transcriptionJob as any).findMany({
      where: {
        mode: mode === 'dictation' ? 'dictation' : 'transcription',
        ...(instanceId ? { instanceId } : {}),
      },
      take,
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((job: any) => this.publicJob(job));
  }
  public async health(instanceId?: string) {
    const poolId = speechPoolId();
    const configured = getConfiguredSpeechModel();
    const result: any = {
      enabled: this.isEnabled(),
      poolId,
      queue: speechQueue('transcription'),
      dictationQueue: speechQueue('dictation'),
      connected: false,
      consumerCount: 0,
      dictationConsumerCount: 0,
      workerReady: false,
      dictationWorkerReady: false,
      processAlive: false,
      brokerConnected: false,
      modelVerified: false,
      engineReady: false,
      acceptingJobs: false,
      lastSuccessfulInferenceAt: null,
      state: this.isEnabled() ? 'offline' : 'disabled',
      capabilities: { transcription: false, dictation: false },
      legacyProtocolPolicy: 'reject',
      protocolVersion: SPEECH_PROTOCOL_VERSION,
      globalConcurrency: speechInteger('SPEECH_GLOBAL_CONCURRENCY', 1, 1, 8),
      staleJobSeconds: this.staleJobSeconds(),
      maxUploadBytes: speechUploadLimit('transcription'),
      maxDictationBytes: speechUploadLimit('dictation'),
      pendingLimit: speechInteger('SPEECH_MAX_PENDING_JOBS', 50),
      instancePendingLimit: speechInteger('SPEECH_MAX_PENDING_JOBS_PER_INSTANCE', 5),
      uploadLimit: speechInteger('SPEECH_MAX_UPLOADS', 2),
      uploadBytesLimit: speechInteger('SPEECH_MAX_UPLOAD_BYTES', 52_428_800, 1024, 1_073_741_824),
      dictationAudioRetentionMinutes: Math.floor(speechDictationRetentionMs() / 60_000),
      queuedJobs: 0,
      processingJobs: 0,
      dictationQueuedJobs: 0,
      dictationProcessingJobs: 0,
      oldestQueuedSeconds: null,
      model: configured?.id || null,
      engine: configured?.engine || null,
      provider: String(process.env.SPEECH_PROVIDER || 'local'),
      allowRemoteModels: false,
      modelDownload: await this.modelDownloadStatus(),
    };
    if (!this.isEnabled()) return result;
    await this.init();
    result.connected = Boolean(this.connection && this.channel && this.resultChannel);
    const jobs = this.prismaRepository.transcriptionJob as any;
    const where = { poolId, ...(instanceId ? { instanceId } : {}) };
    const [queued, processing, dictationQueued, dictationProcessing, oldest, workers] = await Promise.all([
      jobs.count({ where: { ...where, mode: 'transcription', status: 'queued' } }),
      jobs.count({ where: { ...where, mode: 'transcription', status: 'processing' } }),
      jobs.count({ where: { ...where, mode: 'dictation', status: 'queued' } }),
      jobs.count({ where: { ...where, mode: 'dictation', status: 'processing' } }),
      jobs.findFirst({
        where: { ...where, status: 'queued' },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      (this.prismaRepository as any).speechWorker.findMany({
        where: { poolId, heartbeatAt: { gt: new Date(Date.now() - 35_000) } },
        take: 32,
      }),
    ]);
    Object.assign(result, {
      queuedJobs: queued,
      processingJobs: processing,
      dictationQueuedJobs: dictationQueued,
      dictationProcessingJobs: dictationProcessing,
      oldestQueuedSeconds: oldest
        ? Math.max(0, Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1000))
        : null,
    });
    for (const worker of workers) {
      const health = worker.health || {};
      if (
        health.effectiveModel !== configured?.id ||
        health.engine !== configured?.engine ||
        health.modelRevision !== configured?.revision
      )
        continue;
      result.processAlive ||= health.processAlive === true;
      result.brokerConnected ||= health.brokerConnected === true;
      result.modelVerified ||= health.modelVerified === true;
      result.engineReady ||= health.engineReady === true;
      result.acceptingJobs ||=
        health.acceptingJobs === true && health.processAlive === true && health.brokerConnected === true;
      const available = health.processAlive && health.brokerConnected && health.modelVerified && health.acceptingJobs;
      for (const mode of Array.isArray(worker.modes) ? worker.modes : []) {
        if (!['dictation', 'transcription'].includes(mode)) continue;
        result.capabilities[mode] ||= Boolean(available);
        if (mode === 'dictation') {
          result.dictationConsumerCount += 1;
          result.dictationWorkerReady ||= Boolean(available && health.engineReady);
        } else {
          result.consumerCount += 1;
          result.workerReady ||= Boolean(available && health.engineReady);
        }
      }
      if (
        health.lastSuccessfulInferenceAt &&
        (!result.lastSuccessfulInferenceAt || health.lastSuccessfulInferenceAt > result.lastSuccessfulInferenceAt)
      )
        result.lastSuccessfulInferenceAt = health.lastSuccessfulInferenceAt;
    }
    if (!this.isDictationEnabled()) {
      result.dictationWorkerReady = false;
      result.capabilities.dictation = false;
    }
    if (!result.connected || !result.processAlive) result.state = 'offline';
    else if (!result.modelVerified) result.state = 'degraded';
    else if (queued + processing + dictationQueued + dictationProcessing >= result.pendingLimit) {
      result.state = 'capacity_exhausted';
      result.acceptingJobs = false;
    } else if (processing + dictationProcessing > 0) result.state = 'busy';
    else result.state = result.engineReady ? 'ready' : 'warming';
    return result;
  }
  public async modelDownloadStatus(): Promise<SpeechModelDownloadStatus> {
    const status = await this.modelDownloadService.status();
    return { ...status, available: status.available && this.isEnabled() };
  }
  public async downloadModel(modelId: string, force = false): Promise<SpeechModelDownloadStatus> {
    if (!this.isEnabled()) throw new TranscriptionServiceError('A transcrição local está desabilitada.', 409);
    try {
      return await this.modelDownloadService.start(String(modelId || '').trim(), { force });
    } catch (error: any) {
      throw new TranscriptionServiceError(String(error?.message || error), 409);
    }
  }
  public async enqueue(input: EnqueueInput) {
    if (!this.isEnabled()) throw new TranscriptionServiceError('A transcrição local está desabilitada.', 409);
    const messageId = String(input.messageId || '').trim();
    if (!messageId || messageId.length > 128) throw new TranscriptionServiceError('Informe um messageId válido.', 400);
    const media = await (this.prismaRepository.media as any).findUnique({
      where: { messageId },
      select: { fileName: true, mimetype: true, instanceId: true },
    });
    if (!media || (input.instanceId && media.instanceId !== input.instanceId))
      throw new TranscriptionServiceError('A mídia da mensagem não foi encontrada.', 404);
    const mimeType = normalizeTranscriptionAudioMime(media.mimetype, media.fileName);
    if (!mimeType) throw new TranscriptionServiceError('A mensagem informada não contém áudio.', 400);
    const data = this.jobData(input, 'transcription', media.instanceId);
    Object.assign(data, {
      messageId,
      sourceType: 'message',
      sourceBucket: this.sourceStorage.mediaBucket(),
      sourceKey: String(media.fileName),
      sourceMimeType: mimeType,
      dedupKey: speechHash(
        data.scopeKey,
        data.mode,
        'message',
        messageId,
        data.model,
        data.language || '',
        data.requestedEngine,
        data.requestedRevision,
      ),
    });
    const duplicate = await this.findDuplicate(data);
    if (duplicate) return this.publicJob(duplicate);
    await this.ready('transcription');
    const job = await this.durable.createJob(data);
    void this.dispatchOutbox();
    return this.publicJob(job);
  }
  public async enqueueUpload(input: UploadInput) {
    return this.enqueueStoredAudio(input, 'transcription');
  }
  public async enqueueDictation(input: UploadInput) {
    return this.enqueueStoredAudio(input, 'dictation');
  }
  private jobData(input: EnqueueInput, mode: string, instanceId?: string) {
    const model = safeModel(input.model);
    const language = safeLanguage(input.language || process.env.SPEECH_LANGUAGE || 'pt-BR');
    const idempotencyKey = safeIdempotencyKey(input.idempotencyKey);
    const scopeKey = speechScopeKey(instanceId);
    return {
      instanceId: instanceId || null,
      mode,
      scopeKey,
      idempotencyKey,
      language,
      model,
      requestedModel: model,
      requestedEngine: getConfiguredSpeechModel()?.engine,
      requestedRevision: getConfiguredSpeechModel()?.revision,
      provider: providerValue(),
      reservedBytes: speechUploadLimit(mode),
      idempotencyHash: idempotencyKey ? speechHash(scopeKey, mode, idempotencyKey) : null,
      reservedDurationMs:
        (mode === 'dictation'
          ? speechInteger('DICTATION_MAX_DURATION_SECONDS', 60, 1, 1800)
          : speechInteger('TRANSCRIPTION_MAX_DURATION_SECONDS', 3600, 1, 14_400)) * 1000,
    } as any;
  }
  private async enqueueStoredAudio(input: UploadInput, mode: string) {
    if (!this.isEnabled() || (mode === 'dictation' && !this.isDictationEnabled()))
      throw new TranscriptionServiceError('O recurso de voz está desabilitado.', 409);
    if (!this.sourceStorage.enabled())
      throw new TranscriptionServiceError('O armazenamento privado de áudio não está disponível.', 503);
    await this.validateInstanceId(input.instanceId);
    const size = input.filePath
      ? (await stat(input.filePath)).size
      : Buffer.isBuffer(input.buffer)
        ? input.buffer.length
        : 0;
    if (!size) throw new TranscriptionServiceError('O arquivo de áudio não contém dados.', 400);
    if (size > speechUploadLimit(mode))
      throw new TranscriptionServiceError('O áudio excede o limite configurado.', 413);
    const mimeType = normalizeTranscriptionAudioMime(input.mimeType, input.fileName);
    if (!mimeType) throw new TranscriptionServiceError('Formato de áudio não suportado.', 415);
    const data = this.jobData(input, mode, input.instanceId);
    if (Number(input.durationMs) > data.reservedDurationMs)
      throw new TranscriptionServiceError('O áudio excede a duração máxima configurada.', 413);
    const hash = createHash('sha256');
    if (input.filePath) {
      for await (const chunk of createReadStream(input.filePath)) hash.update(chunk);
    } else hash.update(input.buffer!);
    data.reservedBytes = size;
    data.audioHash = hash.digest('hex');
    data.dedupKey = speechHash(
      data.scopeKey,
      mode,
      'audio',
      data.audioHash,
      data.model,
      data.language || '',
      data.requestedEngine,
      data.requestedRevision,
    );
    const duplicate = await this.findDuplicate(data);
    if (duplicate) return this.publicJob(duplicate);
    if (!input.reservationId) await this.ready(mode);
    const reservation =
      input.reservationId || (await this.durable.reserveUpload(input.instanceId, speechUploadLimit(mode))).id;
    const extension = Object.entries(audioMimeByExtension).find(([, type]) => type === mimeType)?.[0] || '.audio';
    const sourceKey = `${SOURCE_PREFIX}${randomUUID()}/audio${extension}`;
    const reservedUpload = await (this.prismaRepository as any).speechUploadReservation.update({
      where: { id: reservation },
      data: { sourceKey, sourceBucket: this.sourceStorage.privateBucket() },
    });
    const transferBudget = Math.min(60_000, new Date(reservedUpload.expiresAt).getTime() - Date.now() - 5000);
    if (transferBudget <= 0)
      throw new TranscriptionServiceError('A reserva de upload expirou antes do armazenamento.', 408);
    const stream = input.filePath ? createReadStream(input.filePath) : Readable.from(input.buffer!);
    let timeout: NodeJS.Timeout | undefined;
    try {
      const transfer = this.sourceStorage.upload(sourceKey, stream, size, mimeType, data.audioHash);
      const stored = await Promise.race([
        transfer,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            stream.destroy(new Error('SPEECH_UPLOAD_TIMEOUT'));
            reject(new TranscriptionServiceError('O armazenamento do áudio excedeu o prazo.', 504));
          }, transferBudget);
          timeout.unref?.();
        }),
      ]);
      if (stored instanceof Error || !stored)
        throw new TranscriptionServiceError('Não foi possível armazenar o áudio.', 503);
      const job = await this.durable.createJob(
        {
          ...data,
          sourceKey,
          sourceBucket: stored.bucket,
          sourceMimeType: mimeType,
          sourceType: mode === 'dictation' ? 'microphone' : 'upload',
          originalFilename: path.basename(String(input.fileName || '')).slice(0, 255) || null,
          sizeBytes: size,
          sourceExpiresAt: mode === 'dictation' ? new Date(Date.now() + speechDictationRetentionMs()) : null,
        },
        reservation,
      );
      if (job.sourceKey !== sourceKey) {
        const removed = await this.sourceStorage
          .remove(this.sourceStorage.privateBucket(), sourceKey)
          .catch(() => false);
        if (removed)
          await (this.prismaRepository as any).speechUploadReservation.deleteMany({ where: { id: reservation } });
      }
      void this.dispatchOutbox();
      return this.publicJob(job);
    } catch (error) {
      await this.sourceStorage.remove(this.sourceStorage.privateBucket(), sourceKey).catch(() => false);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      stream.destroy();
    }
    // A failed transfer keeps its expiring ledger, covering a late S3 completion.
  }
  private async findDuplicate(data: any) {
    const duplicate = await (this.prismaRepository.transcriptionJob as any).findFirst({
      where: {
        OR: [{ dedupKey: data.dedupKey }, ...(data.idempotencyHash ? [{ idempotencyHash: data.idempotencyHash }] : [])],
      },
    });
    if (
      duplicate &&
      data.idempotencyHash &&
      duplicate.idempotencyHash === data.idempotencyHash &&
      duplicate.dedupKey !== data.dedupKey
    ) {
      throw new TranscriptionServiceError('Idempotency-Key já utilizada com outro áudio ou configuração.', 409);
    }
    return duplicate;
  }
  private async findJob(jobId: string, instanceId?: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);
    const job = await (this.prismaRepository.transcriptionJob as any).findFirst({
      where: { id, ...(instanceId ? { instanceId } : {}) },
    });
    if (!job) throw new TranscriptionServiceError('Job de voz não encontrado.', 404);
    return job;
  }
  public async get(jobId: string, instanceId?: string) {
    return this.publicJob(await this.findJob(jobId, instanceId));
  }
  public async cancel(jobId: string, instanceId?: string) {
    return this.publicJob(await this.durable.cancel(jobId, instanceId));
  }
  public async retry(jobId: string, instanceId?: string) {
    const job = await this.findJob(jobId, instanceId);
    if (
      job.sourceDeletedAt ||
      (job.sourceExpiresAt && job.sourceExpiresAt <= new Date()) ||
      (job.sourceType !== 'message' &&
        (!this.isOwnedUploadKey(job.sourceKey) || !(await this.sourceStorage.exists(job.sourceBucket, job.sourceKey))))
    ) {
      throw new TranscriptionServiceError(
        'O áudio expirou ou não foi persistido pelo protocolo anterior. Envie-o novamente.',
        410,
      );
    }
    await this.ready(job.mode);
    if (job.protocolVersion < SPEECH_PROTOCOL_VERSION) await this.prepareLegacyRetry(job);
    const retried = await this.durable.retry(jobId, instanceId);
    void this.dispatchOutbox();
    return this.publicJob(retried);
  }
  public async delete(jobId: string, instanceId?: string) {
    let job = await this.findJob(jobId, instanceId);
    const wasActive = SPEECH_ACTIVE_STATUSES.includes(job.status);
    if (wasActive) {
      await this.durable.cancel(jobId, instanceId);
      job = await this.findJob(jobId, instanceId);
    }
    if (job.leaseExpiresAt && job.leaseExpiresAt > new Date(Date.now() - 5000))
      throw new TranscriptionServiceError(
        'Cancelamento registrado. Aguarde o encerramento do motor antes de excluir o áudio.',
        409,
        5,
      );
    const ownsSource = !job.messageId && this.isOwnedUploadKey(job.sourceKey);
    if (ownsSource && !(await this.removeSourceWithFence(job.id)))
      throw new TranscriptionServiceError(
        'Não foi possível remover o áudio temporário ou a fonte voltou a ser utilizada.',
        409,
      );
    await this.durable.transaction(async (tx) => {
      const current = await tx.transcriptionJob.findFirst({
        where: { id: jobId, ...(instanceId ? { instanceId } : {}) },
      });
      if (
        !current ||
        SPEECH_ACTIVE_STATUSES.includes(current.status) ||
        (current.leaseExpiresAt && current.leaseExpiresAt > new Date(Date.now() - 5000))
      ) {
        throw new TranscriptionServiceError(
          'O job mudou durante a exclusão. Atualize o estado e tente novamente.',
          409,
        );
      }
      await tx.speechOutbox.deleteMany({ where: { jobId } });
      await tx.transcriptionJob.deleteMany({
        where: { id: jobId, ...(instanceId ? { instanceId } : {}), status: { notIn: SPEECH_ACTIVE_STATUSES } },
      });
    });
    return { id: jobId, deleted: true, cancelled: wasActive, sourceRemoved: ownsSource, sourceRetained: !ownsSource };
  }
  private async prepareLegacyRetry(job: any) {
    safeModel(job.model);
    if (!this.connection)
      throw new TranscriptionServiceError('O broker precisa estar disponível para verificar a migração.', 503);
    const legacyQueues = [
      String(process.env.SPEECH_TRANSCRIPTION_QUEUE || process.env.TRANSCRIPTION_QUEUE || 'speech.transcription'),
      String(process.env.SPEECH_DICTATION_QUEUE || 'speech.dictation'),
    ].map((queue) => queue.replace(/\.v2$/, ''));
    for (const queue of legacyQueues) {
      const check = await this.connection.createChannel();
      check.on('error', () => {});
      try {
        const status = await check.checkQueue(queue);
        if (status.consumerCount > 0)
          throw new TranscriptionServiceError(
            'Pare os workers legados antes de migrar o job para o protocolo v2.',
            409,
          );
      } catch (error) {
        if (Number(error?.code) !== 404) throw error;
      } finally {
        await check.close().catch(() => {});
      }
    }
    const source = await this.sourceStorage.open(job.sourceBucket, job.sourceKey);
    if (!source) throw new TranscriptionServiceError('A fonte do job legado não está disponível.', 410);
    const hash = createHash('sha256');
    let size = 0;
    const deadline = setTimeout(() => source.destroy(new Error('LEGACY_SOURCE_TIMEOUT')), 30_000);
    deadline.unref?.();
    try {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > speechUploadLimit(job.mode))
          throw new TranscriptionServiceError('A fonte legada excede o limite atual.', 413);
        hash.update(chunk);
      }
    } finally {
      clearTimeout(deadline);
      source.destroy();
    }
    const sha256 = hash.digest('hex');
    if (!size || (job.audioHash && sha256 !== job.audioHash))
      throw new TranscriptionServiceError('A fonte legada não passou na verificação de integridade.', 409);
    await (this.prismaRepository.transcriptionJob as any).updateMany({
      where: { id: job.id, status: 'failed', protocolVersion: job.protocolVersion },
      data: {
        audioHash: sha256,
        sizeBytes: size,
        reservedBytes: size,
        requestedModel: job.model,
        requestedEngine: getConfiguredSpeechModel()?.engine,
        requestedRevision: getConfiguredSpeechModel()?.revision,
        reservedDurationMs: this.jobData({}, job.mode, job.instanceId).reservedDurationMs,
      },
    });
  }

  private async removeSourceWithFence(jobId: string): Promise<boolean> {
    const reserved = await this.durable.transaction(async (tx) => {
      const job = await tx.transcriptionJob.findUnique({ where: { id: jobId } });
      if (!job || job.messageId || !this.isOwnedUploadKey(job.sourceKey) || SPEECH_ACTIVE_STATUSES.includes(job.status))
        return null;
      const active = await tx.transcriptionJob.count({
        where: {
          sourceKey: job.sourceKey,
          sourceBucket: job.sourceBucket || null,
          OR: [{ status: { in: SPEECH_ACTIVE_STATUSES } }, { leaseExpiresAt: { gt: new Date(Date.now() - 5000) } }],
        },
      });
      if (active) return null;
      if (job.sourceDeletionStartedAt && job.sourceDeletionStartedAt > new Date(Date.now() - 60_000)) return null;
      const token = randomUUID();
      await tx.transcriptionJob.updateMany({
        where: { sourceKey: job.sourceKey, sourceBucket: job.sourceBucket || null },
        data: { sourceDeletionStartedAt: new Date(), sourceDeletionToken: token },
      });
      return { sourceKey: job.sourceKey, sourceBucket: job.sourceBucket, token };
    });
    if (!reserved) return false;
    if (await this.sourceStorage.remove(reserved.sourceBucket, reserved.sourceKey)) {
      await (this.prismaRepository.transcriptionJob as any).updateMany({
        where: {
          sourceKey: reserved.sourceKey,
          sourceBucket: reserved.sourceBucket || null,
          sourceDeletionToken: reserved.token,
        },
        data: { sourceDeletedAt: new Date(), sourceDeletionStartedAt: null, sourceDeletionToken: null },
      });
      return true;
    }
    // Keep the deletion fence on an uncertain network outcome. A late S3 delete
    // must never race a manual retry; bounded cleanup retries the tombstone.

    return false;
  }
  private jobPayload(job: any) {
    return {
      version: SPEECH_PROTOCOL_VERSION,
      jobId: job.id,
      mode: job.mode,
      messageId: job.messageId,
      instanceId: job.instanceId,
      scopeKey: job.scopeKey,
      poolId: job.poolId,
      generation: job.generation,
      source: {
        bucket: job.sourceBucket || this.sourceStorage.mediaBucket(),
        key: job.sourceKey,
        mimeType: job.sourceMimeType,
        bytes: job.sizeBytes || null,
        sha256: job.audioHash || null,
      },
      language: job.language,
      model: job.requestedModel || job.model,
      engine: job.requestedEngine,
      modelRevision: job.requestedRevision,
      attempts: job.attempts,
      queuedAt: new Date(job.createdAt).toISOString(),
      deadlineAt: job.deadlineAt ? new Date(job.deadlineAt).toISOString() : null,
      maxDurationMs: job.reservedDurationMs,
      maxAudioBytes: job.reservedBytes,
      controlRoutingKey: SPEECH_CONTROL_ROUTING_KEY,
    };
  }
  private publicJob(job: any) {
    return {
      id: job.id,
      workerId: job.workerId || null,
      messageId: job.messageId,
      instanceId: job.instanceId,
      mode: job.mode || 'transcription',
      sourceType: job.sourceType || 'upload',
      originalFilename: job.originalFilename || null,
      sizeBytes: job.sizeBytes ?? null,
      audioHash: job.audioHash || null,
      provider: job.provider,
      model: job.effectiveModel || job.model,
      requestedModel: job.requestedModel || job.model,
      effectiveModel: job.effectiveModel || null,
      engine: job.engine || null,
      modelRevision: job.modelRevision || null,
      language: job.language,
      status: job.status,
      stage: job.stage || job.status,
      progressPercent: Number(job.progressPercent) || 0,
      processedDurationMs: job.processedDurationMs || 0,
      durationKnown: job.checkpoint?.durationKnown === true || job.status === 'completed',
      heartbeatAt: job.heartbeatAt || null,
      controlHeartbeatAt: job.controlHeartbeatAt || null,
      engineProgressAt: job.engineProgressAt || null,
      generation: job.generation,
      leaseExpiresAt: job.leaseExpiresAt || null,
      deadlineAt: job.deadlineAt || null,
      cancelRequestedAt: job.cancelRequestedAt || null,
      queueWaitMs: Math.max(0, new Date(job.startedAt || Date.now()).getTime() - new Date(job.createdAt).getTime()),
      text: job.text,
      detectedLanguage: job.detectedLanguage,
      durationMs: job.durationMs,
      segments: job.segments,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      attempts: job.attempts,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
    };
  }
  private async ready(mode: string) {
    if (!this.isEnabled() || (mode === 'dictation' && !this.isDictationEnabled()))
      throw new TranscriptionServiceError('O recurso de voz está desabilitado.', 409);
    safeModel(undefined);
    providerValue();
    const health = await this.health();
    if (!health.connected || !health.capabilities[mode])
      throw new TranscriptionServiceError(
        'O pool de voz está indisponível ou está preparando o motor. Consulte /v1/speech/health.',
        503,
        10,
      );
    if (!health.acceptingJobs)
      throw new TranscriptionServiceError('O pool de voz atingiu sua capacidade de admissão.', 429, 15);
  }

  private async connect() {
    const uri = String(process.env.RABBITMQ_URI || '').trim();
    if (!uri) throw new Error('RABBITMQ_URI não configurado.');
    await this.prismaRepository.$connect();
    const exchange = String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim();
    const connection = await amqp.connect(uri, { timeout: 5000, keepAlive: true });
    this.connection = connection;
    connection.on('error', (error) => this.logger.warn('RabbitMQ speech: ' + (error?.message || error)));
    connection.on('close', () => {
      if (this.connection === connection) this.closeConnection(connection);
    });
    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    channel.setMaxListeners(64);
    channel.on('error', (error) => this.logger.warn('RabbitMQ speech publisher: ' + (error?.message || error)));
    channel.on('close', () => this.closeConnection(connection));
    try {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      for (const mode of ['transcription', 'dictation']) {
        const queue = speechQueue(mode);
        await channel.assertQueue(queue + '.dead-letter', { durable: true, arguments: speechDeadLetterArguments() });
        await channel.assertQueue(queue, { durable: true, arguments: speechQueueArguments(mode) });
        await channel.bindQueue(queue, exchange, speechRequestRoutingKey(mode));
      }
      const controlQueue = speechPoolId() + '.speech.control.v2';
      await channel.assertQueue(controlQueue, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-max-length': 1000,
          'x-max-length-bytes': 8_388_608,
          'x-message-ttl': 15_000,
          'x-overflow': 'reject-publish',
        },
      });
      await channel.bindQueue(controlQueue, exchange, SPEECH_CONTROL_ROUTING_KEY);
      const consumer = await connection.createChannel();
      this.resultChannel = consumer;
      consumer.on('error', (error) => this.logger.warn('RabbitMQ speech control: ' + (error?.message || error)));
      consumer.on('close', () => this.closeConnection(connection));
      await consumer.prefetch(16);
      await consumer.consume(
        controlQueue,
        (message) => {
          if (message) void this.consumeControl(message, consumer);
        },
        { noAck: false },
      );
      if (!this.outboxTimer) {
        this.outboxTimer = setInterval(() => void this.dispatchOutbox(), 1000);
        this.outboxTimer.unref?.();
      }
      void this.dispatchOutbox();
      void this.recoverStaleJobs();
    } catch (error) {
      this.closeConnection(connection);
      throw error;
    }
  }
  private closeConnection(connection: any) {
    if (!connection || connection !== this.connection) return;
    this.connection = null;
    this.channel = null;
    this.resultChannel = null;
    void connection.close().catch(() => {});
    this.scheduleReconnect();
  }
  private scheduleReconnect() {
    if (this.reconnectTimer || !this.isEnabled()) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.init();
    }, 5000);
    this.reconnectTimer.unref?.();
  }
  private async consumeControl(message: any, consumer: any) {
    if (consumer !== this.resultChannel) return;
    let input: any;
    if (message.content.length > 300_000) {
      consumer.nack(message, false, false);
      return;
    }
    try {
      input = JSON.parse(message.content.toString('utf8'));
    } catch {
      consumer.nack(message, false, false);
      return;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      consumer.nack(message, false, false);
      return;
    }
    const replyTo = String(message.properties?.replyTo || '');
    if (!replyTo || replyTo.length > 255) {
      consumer.nack(message, false, false);
      return;
    }
    try {
      let result: Record<string, any>;
      try {
        result = await this.durable.control(input);
      } catch (error) {
        if (!(error instanceof TranscriptionServiceError)) throw error;
        result = {
          ok: false,
          granted: false,
          applied: false,
          reason: error.message,
          terminal: true,
          cancelRequested: true,
        };
      }
      if (consumer !== this.resultChannel || !this.channel) return;
      try {
        await publishSpeechConfirmed(this.channel, '', replyTo, result, {
          correlationId: message.properties.correlationId,
          messageId: randomUUID(),
          expiration: '15000',
        });
      } catch (error) {
        if (!String(error?.message || error).startsWith('SPEECH_UNROUTABLE')) throw error;
        // A disappeared worker cannot consume a reply; committed SQL remains authoritative.
      }
      consumer.ack(message);
      if (['release', 'finish'].includes(input.action)) void this.dispatchOutbox();
    } catch (error) {
      this.logger.warn('Falha transitória no controle durável de voz: ' + (error?.message || error));
      this.closeConnection(this.connection);
    }
  }
  private async dispatchOutbox() {
    if (this.outboxInFlight || !this.channel) return;
    this.outboxInFlight = true;
    const repository = this.prismaRepository as any;
    try {
      const now = new Date();
      const entries = await repository.speechOutbox.findMany({
        where: {
          poolId: speechPoolId(),
          availableAt: { lte: now },
          OR: [{ status: 'pending' }, { status: 'publishing', lockedUntil: { lt: now } }],
        },
        orderBy: { availableAt: 'asc' },
        take: 20,
      });
      for (const entry of entries) {
        if (!this.channel) break;
        const token = randomUUID();
        const claimed = await repository.speechOutbox.updateMany({
          where: {
            id: entry.id,
            status: entry.status,
            ...(entry.status === 'publishing' ? { lockedUntil: { lt: now } } : {}),
          },
          data: {
            status: 'publishing',
            dispatchToken: token,
            lockedUntil: new Date(Date.now() + 30_000),
            attempts: { increment: 1 },
          },
        });
        if (!claimed.count) continue;
        try {
          const job = await repository.transcriptionJob.findUnique({ where: { id: entry.jobId } });
          if (
            job?.status === 'queued' &&
            job.generation === entry.generation &&
            (!job.deadlineAt || job.deadlineAt > new Date())
          ) {
            await publishSpeechConfirmed(
              this.channel,
              String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim(),
              speechRequestRoutingKey(entry.mode),
              entry.payload,
              { messageId: entry.id },
            );
          }
          await repository.speechOutbox.updateMany({
            where: { id: entry.id, dispatchToken: token },
            data: {
              status: 'published',
              publishedAt: new Date(),
              lockedUntil: null,
              dispatchToken: null,
              lastError: null,
            },
          });
        } catch (error) {
          await repository.speechOutbox.updateMany({
            where: { id: entry.id, dispatchToken: token },
            data: {
              status: 'pending',
              lockedUntil: null,
              dispatchToken: null,
              lastError: String(error?.message || error).slice(0, 500),
              availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(entry.attempts || 0, 6))),
            },
          });
        }
      }
    } catch (error) {
      this.logger.warn('Publicador outbox de voz indisponível: ' + (error?.message || error));
    } finally {
      this.outboxInFlight = false;
    }
  }
  private staleJobSeconds() {
    return speechInteger('SPEECH_LEASE_SECONDS', 30, 10, 120) + 5;
  }
  private startStaleRecovery() {
    if (this.staleRecoveryTimer) return;
    this.staleRecoveryTimer = setInterval(() => void this.recoverStaleJobs(), 15_000);
    this.staleRecoveryTimer.unref?.();
  }
  private async recoverStaleJobs() {
    if (this.staleRecoveryInFlight) return;
    this.staleRecoveryInFlight = true;
    const repository = this.prismaRepository as any;
    try {
      const now = new Date();
      const cutoff = new Date(Date.now() - 5000);
      const jobs = await repository.transcriptionJob.findMany({
        where: {
          ...(this.staleRecoveryCursor ? { id: { gt: this.staleRecoveryCursor } } : {}),
          status: { in: SPEECH_ACTIVE_STATUSES },
          OR: [
            { protocolVersion: { lt: SPEECH_PROTOCOL_VERSION } },
            { poolId: speechPoolId(), deadlineAt: { lt: now } },
            { poolId: speechPoolId(), status: 'processing', leaseExpiresAt: { lt: cutoff } },
            { poolId: speechPoolId(), status: 'queued', updatedAt: { lt: new Date(Date.now() - 30_000) } },
          ],
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      this.staleRecoveryCursor = jobs.length === 100 ? jobs[jobs.length - 1].id : undefined;
      for (const observed of jobs) {
        await this.durable.transaction(async (tx) => {
          const job = await tx.transcriptionJob.findUnique({ where: { id: observed.id } });
          if (!job || !SPEECH_ACTIVE_STATUSES.includes(job.status) || job.generation !== observed.generation) return;
          const legacy = job.protocolVersion < SPEECH_PROTOCOL_VERSION;
          const deadline = job.deadlineAt && job.deadlineAt <= now;
          const expired = job.status === 'processing' && job.leaseExpiresAt && job.leaseExpiresAt < cutoff;
          if (legacy || deadline || (expired && job.attempts >= speechInteger('SPEECH_MAX_ATTEMPTS', 3, 1, 10))) {
            await tx.transcriptionJob.update({
              where: { id: job.id },
              data: {
                status: 'failed',
                stage: 'failed',
                completedAt: now,
                errorCode: legacy
                  ? 'LEGACY_PROTOCOL_REQUIRES_RETRY'
                  : deadline
                    ? 'JOB_DEADLINE_EXCEEDED'
                    : 'WORKER_LEASE_EXPIRED',
                errorMessage: legacy
                  ? 'O protocolo de fala mudou. Reenvie o ditado ou repita a transcrição persistida após atualizar o worker.'
                  : 'O prazo de execução de voz expirou.',
              },
            });
            return;
          }
          if (expired) {
            const next = await tx.transcriptionJob.update({
              where: { id: job.id },
              data: {
                status: 'queued',
                stage: 'retrying',
                executionId: null,
                leaseExpiresAt: null,
                generation: { increment: 1 },
                attempts: { increment: 1 },
              },
            });
            await this.durable.writeOutbox(tx, next, 1000);
            return;
          }
          if (job.status === 'queued') {
            const outbox = await tx.speechOutbox.findUnique({
              where: { jobId_generation: { jobId: job.id, generation: job.generation } },
            });
            // Confirmed, routed durable requests do not need periodic duplicate publication.
            // Missing outbox rows are repaired; expired leases and absolute deadlines close
            // loss windows without filling a bounded broker queue with repeated copies.
            if (!outbox) {
              await this.durable.writeOutbox(tx, job);
            }
          }
        });
      }
      void this.dispatchOutbox();
    } catch (error) {
      this.logger.warn('Reconciliação durável de voz indisponível: ' + (error?.message || error));
    } finally {
      this.staleRecoveryInFlight = false;
    }
  }
  public async cleanupExpiredUploads(input: { olderThanSeconds?: number; limit?: number; cursor?: string } = {}) {
    if (!this.sourceStorage.enabled())
      throw new TranscriptionServiceError('O armazenamento privado de áudio não está disponível.', 503);
    const retention =
      input.olderThanSeconds === undefined ? this.sourceRetentionSeconds() : Number(input.olderThanSeconds);
    if (!Number.isFinite(retention) || retention <= 0)
      throw new TranscriptionServiceError('Informe uma retenção positiva.', 400);
    const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 100), 1), 1000);
    const cutoff = new Date(Date.now() - Math.min(retention, 31_536_000) * 1000);
    const now = new Date();
    const repository = this.prismaRepository as any;
    const jobs = await repository.transcriptionJob.findMany({
      where: {
        ...(input.cursor ? { id: { gt: String(input.cursor).slice(0, 191) } } : {}),
        poolId: speechPoolId(),
        messageId: null,
        sourceKey: { startsWith: SOURCE_PREFIX },
        sourceDeletedAt: null,
        status: { in: ['completed', 'failed', 'cancelled'] },
        AND: [
          { OR: [{ sourceExpiresAt: { lte: now } }, { completedAt: { lte: cutoff } }] },
          { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date(Date.now() - 5000) } }] },
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, sourceKey: true, sizeBytes: true },
    });
    let removed = 0;
    let failed = 0;
    let freedBytes = 0;
    for (const job of jobs) {
      if (await this.removeSourceWithFence(job.id)) {
        removed += 1;
        freedBytes += Number(job.sizeBytes) || 0;
      } else failed += 1;
    }
    const abandoned = await repository.speechUploadReservation.findMany({
      where: {
        poolId: speechPoolId(),
        expiresAt: { lt: new Date(Date.now() - 60_000) },
        ...(this.reservationCleanupCursor ? { id: { gt: this.reservationCleanupCursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
    this.reservationCleanupCursor = abandoned.length === limit ? abandoned[abandoned.length - 1].id : undefined;
    for (const reservation of abandoned) {
      const used = reservation.sourceKey
        ? await repository.transcriptionJob.count({
            where: { sourceKey: reservation.sourceKey, sourceBucket: reservation.sourceBucket || null },
          })
        : 0;
      if (
        reservation.sourceKey &&
        !used &&
        !(await this.sourceStorage.remove(reservation.sourceBucket, reservation.sourceKey))
      ) {
        failed += 1;
        continue;
      }
      await repository.speechUploadReservation.deleteMany({
        where: { id: reservation.id, expiresAt: reservation.expiresAt },
      });
    }
    const oldOutbox = await repository.speechOutbox.findMany({
      where: { poolId: speechPoolId(), status: 'published', publishedAt: { lt: new Date(Date.now() - 86_400_000) } },
      select: { id: true },
      take: limit,
    });
    if (oldOutbox.length)
      await repository.speechOutbox.deleteMany({ where: { id: { in: oldOutbox.map((entry: any) => entry.id) } } });
    return {
      status: failed ? 'partial' : 'completed',
      retentionSeconds: retention,
      cutoff: cutoff.toISOString(),
      candidates: jobs.length,
      removed,
      failed,
      freedBytes,
      jobsRemoved: 0,
      jobsRetained: removed,
      hasMore: jobs.length === limit,
      nextCursor: jobs.length === limit ? jobs[jobs.length - 1].id : null,
    };
  }
  private isOwnedUploadKey(value: unknown): boolean {
    const key = String(value || '');
    return key.startsWith(SOURCE_PREFIX) && !key.includes('..');
  }
  private sourceRetentionSeconds() {
    return speechInteger(
      'TRANSCRIPTION_SOURCE_RETENTION_SECONDS',
      speechInteger('TRANSCRIPTION_AUDIO_RETENTION_DAYS', 30, 1, 365) * 86_400,
      1,
      31_536_000,
    );
  }
  private startSourceCleanup() {
    if (this.sourceCleanupTimer) return;
    this.sourceCleanupTimer = setInterval(() => void this.runSourceCleanup(), 60_000);
    this.sourceCleanupTimer.unref?.();
  }
  private async runSourceCleanup() {
    if (this.sourceCleanupInFlight) return;
    this.sourceCleanupInFlight = true;
    try {
      const result = await this.cleanupExpiredUploads({ cursor: this.sourceCleanupCursor });
      this.sourceCleanupCursor = result.nextCursor || undefined;
    } catch (error) {
      this.logger.warn('Limpeza de fontes de voz indisponível: ' + (error?.message || error));
    } finally {
      this.sourceCleanupInFlight = false;
    }
  }
}
