import {
  deleteStoredFile,
  listBucketObjects,
  minioEnabled,
  storedFileExists,
  uploadFile,
} from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';
import path from 'path';

const REQUESTED = 'transcription.requested';
const PROCESSING = 'transcription.processing';
const COMPLETED = 'transcription.completed';
const FAILED = 'transcription.failed';
const TRANSCRIPTION_SOURCE_PREFIX = 'transcriptions/';
const MANAGED_OBJECT_PREFIX = 'argws-connect-api/';

type EnqueueInput = {
  messageId?: string;
  instanceId?: string;
  language?: string;
  model?: string;
};

type UploadInput = {
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
  instanceId?: string;
  language?: string;
  model?: string;
};

type WorkerResult = {
  jobId?: string;
  attempts?: number;
  status?: string;
  stage?: string | null;
  progressPercent?: number;
  processedDurationMs?: number | null;
  text?: string;
  language?: string | null;
  durationMs?: number | null;
  segments?: unknown[] | null;
  provider?: string;
  model?: string;
  errorCode?: string;
  errorMessage?: string;
  updatedAt?: string;
};

const truthy = new Set(['1', 'true', 'yes', 'on']);
const supportedAudio = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/amr',
]);

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

/**
 * Browsers are inconsistent about recordings created with MediaRecorder.
 * Chrome/ChatGPT can report `audio/webm;codecs=opus`, `video/webm` or even an
 * empty MIME while the filename is still `.webm`. Store one canonical audio
 * MIME and let ffmpeg validate the actual stream in the worker.
 */
export function normalizeTranscriptionAudioMime(value: unknown, fileName?: string): string {
  const declared = String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const alias = audioMimeAliases[declared];
  if (alias && supportedAudio.has(alias)) return alias;

  const extension = path.extname(String(fileName || '')).toLowerCase();
  const byExtension = audioMimeByExtension[extension];
  if (byExtension && (declared === '' || declared === 'application/octet-stream' || declared === 'video/webm')) {
    return byExtension;
  }
  return '';
}

function enabledValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return truthy.has(String(value).trim().toLowerCase());
}

function normalizedQueue(value: unknown): string {
  const queue = String(value || 'argws-connect.transcription').trim();
  return queue || 'argws-connect.transcription';
}

function providerValue(): string {
  const provider = String(process.env.TRANSCRIPTION_PROVIDER || process.env.TRANSCRIPTION_ENGINE || 'local')
    .trim()
    .toLowerCase();
  return provider === 'openai' ? 'local' : provider;
}

function safeLanguage(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const language = String(value).trim();
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
    throw new TranscriptionServiceError('language inválido. Use, por exemplo, pt ou pt-BR.', 400);
  }
  return language;
}

function safeModel(value: unknown): string {
  const model = String(value || process.env.TRANSCRIPTION_LOCAL_MODEL || 'Xenova/whisper-small').trim();
  if (!/^[A-Za-z0-9._:/@-]{1,100}$/.test(model)) {
    throw new TranscriptionServiceError('model inválido.', 400);
  }
  return model;
}

function maxUploadBytes(): number {
  const value = Number.parseInt(process.env.TRANSCRIPTION_MAX_AUDIO_BYTES || '', 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 250 * 1024 * 1024) : 25 * 1024 * 1024;
}

function uploadExtension(fileName: string, mimeType: string): string {
  const extension = path
    .extname(String(fileName || ''))
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension;
  const byMime: Record<string, string> = {
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/wave': '.wav',
    'audio/webm': '.webm',
    'audio/amr': '.amr',
  };
  return byMime[mimeType] || '.audio';
}

export class TranscriptionServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = 'TranscriptionServiceError';
  }
}

/**
 * The API owns durable job state. The dedicated worker only reads private
 * MinIO objects and publishes status/results through RabbitMQ.
 */
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private connection: any = null;
  private channel: any = null;
  private initializing: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sourceCleanupTimer: NodeJS.Timeout | null = null;
  private sourceCleanupInFlight = false;
  private staleRecoveryTimer: NodeJS.Timeout | null = null;
  private staleRecoveryInFlight = false;

  constructor(private readonly prismaRepository: PrismaRepository) {}

  public isEnabled(): boolean {
    return enabledValue(process.env.TRANSCRIPTION_ENABLED, false);
  }

  public async init(): Promise<void> {
    if (!this.isEnabled()) return;
    this.startSourceCleanup();
    this.startStaleRecovery();
    if (!enabledValue(process.env.RABBITMQ_ENABLED, true)) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.connect()
      .catch((error) => {
        this.logger.warn('Transcription queue indisponível; nova tentativa em 5s: ' + (error?.message || error));
        this.scheduleReconnect();
      })
      .finally(() => {
        this.initializing = null;
      });
    return this.initializing;
  }

  public async list(limit = 30) {
    if (!this.isEnabled()) return [];
    const take = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 100) : 30;
    const jobs = await (this.prismaRepository.transcriptionJob as any).findMany({
      take,
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((job: any) => this.publicJob(job));
  }

  /**
   * Read-only queue diagnostics for the Manager and operators. This endpoint
   * deliberately never publishes, retries or deletes a job.
   */
  public async health() {
    const queue = normalizedQueue(process.env.TRANSCRIPTION_QUEUE);
    const result: any = {
      enabled: this.isEnabled(),
      queue,
      connected: false,
      consumerCount: 0,
      workerReady: false,
      staleJobSeconds: this.staleJobSeconds(),
      maxUploadBytes: maxUploadBytes(),
      queuedJobs: 0,
      processingJobs: 0,
      oldestQueuedSeconds: null as number | null,
    };
    if (!this.isEnabled()) return result;

    try {
      const jobs = this.prismaRepository.transcriptionJob as any;
      const [queuedJobs, processingJobs, oldestQueued] = await Promise.all([
        jobs.count({ where: { status: 'queued' } }),
        jobs.count({ where: { status: 'processing' } }),
        jobs.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      ]);
      result.queuedJobs = Number(queuedJobs || 0);
      result.processingJobs = Number(processingJobs || 0);
      if (oldestQueued?.createdAt) {
        const oldestQueuedAt = new Date(oldestQueued.createdAt).getTime();
        if (Number.isFinite(oldestQueuedAt)) {
          result.oldestQueuedSeconds = Math.max(0, Math.floor((Date.now() - oldestQueuedAt) / 1000));
        }
      }
    } catch (error) {
      this.logger.debug('Transcrição: resumo persistido da fila indisponível: ' + (error?.message || error));
    }
    if (!enabledValue(process.env.RABBITMQ_ENABLED, true)) return result;

    await this.init();
    if (!this.channel) return result;
    result.connected = true;
    try {
      const state = await this.channel.checkQueue(queue);
      result.consumerCount = Number(state?.consumerCount || 0);
      result.workerReady = result.consumerCount > 0;
      result.messageCount = Number(state?.messageCount || 0);
    } catch (error) {
      this.logger.debug('Transcrição: diagnóstico da fila indisponível: ' + (error?.message || error));
    }
    return result;
  }

  public async enqueue(input: EnqueueInput) {
    if (!this.isEnabled()) {
      throw new TranscriptionServiceError('A transcrição local está desabilitada nesta instalação.', 409);
    }

    const messageId = String(input?.messageId || '').trim();
    if (!messageId || messageId.length > 128) {
      throw new TranscriptionServiceError('Informe um messageId válido.', 400);
    }

    const media = await (this.prismaRepository.media as any).findUnique({
      where: { messageId },
      select: { fileName: true, mimetype: true, instanceId: true },
    });
    if (!media) throw new TranscriptionServiceError('A mídia da mensagem não foi encontrada.', 404);
    if (input.instanceId && String(media.instanceId || '') !== String(input.instanceId)) {
      throw new TranscriptionServiceError('A mídia não pertence à instância autenticada.', 404);
    }
    const mimetype = normalizeTranscriptionAudioMime(media.mimetype, media.fileName);
    if (!mimetype.startsWith('audio/')) {
      throw new TranscriptionServiceError('A mensagem informada não contém áudio.', 400);
    }

    const pending = await (this.prismaRepository.transcriptionJob as any).findFirst({
      where: { messageId, status: { in: ['queued', 'processing'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return this.publicJob(pending);

    await this.ready();
    const language = safeLanguage(input.language);
    const model = safeModel(input.model);
    return this.createAndPublish({
      instanceId: media.instanceId,
      messageId,
      sourceKey: String(media.fileName),
      sourceMimeType: mimetype,
      language,
      model,
    });
  }

  public async enqueueUpload(input: UploadInput) {
    if (!this.isEnabled()) {
      throw new TranscriptionServiceError('A transcrição local está desabilitada nesta instalação.', 409);
    }
    if (!minioEnabled()) {
      throw new TranscriptionServiceError('O armazenamento privado de áudio não está disponível.', 503);
    }
    if (!Buffer.isBuffer(input?.buffer) || input.buffer.length === 0) {
      throw new TranscriptionServiceError('Envie um arquivo de áudio não vazio.', 400);
    }
    if (input.buffer.length > maxUploadBytes()) {
      throw new TranscriptionServiceError('O áudio excede o limite configurado para transcrição.', 413);
    }
    const mimeType = normalizeTranscriptionAudioMime(input.mimeType, input.fileName);
    if (!supportedAudio.has(mimeType)) {
      throw new TranscriptionServiceError(
        'Formato de áudio não suportado. Use OGG, Opus, MP3, M4A, WAV, WEBM ou AMR.',
        415,
      );
    }

    await this.ready();
    const language = safeLanguage(input.language);
    const model = safeModel(input.model);
    const sourceKey = `transcriptions/${randomUUID()}/audio${uploadExtension(String(input.fileName || ''), mimeType)}`;
    try {
      const stored = await uploadFile(sourceKey, input.buffer, input.buffer.length, {
        'Content-Type': mimeType,
      } as any);
      if (stored instanceof Error) {
        throw stored;
      }
    } catch (error) {
      await deleteStoredFile(sourceKey).catch(() => false);
      throw new TranscriptionServiceError('Não foi possível armazenar o áudio para transcrição.', 503);
    }

    return this.createAndPublish({
      instanceId: input.instanceId || null,
      messageId: null,
      sourceKey,
      sourceMimeType: mimeType,
      language,
      model,
    });
  }

  public async get(jobId: string, instanceId?: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);
    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    if (instanceId && String(job.instanceId || '') !== String(instanceId)) {
      throw new TranscriptionServiceError('Job de transcrição não pertence à instância autenticada.', 404);
    }
    return this.publicJob(job);
  }

  public async retry(jobId: string, instanceId?: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);
    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    if (instanceId && String(job.instanceId || '') !== String(instanceId)) {
      throw new TranscriptionServiceError('Job de transcrição não pertence à instância autenticada.', 404);
    }
    const canRetry = job.status === 'failed' || this.isStaleJob(job);
    if (!canRetry) {
      throw new TranscriptionServiceError(
        'O job ainda está em processamento. Aguarde ou remova-o antes de repetir.',
        409,
      );
    }
    if (!job.messageId && this.isOwnedUploadKey(job.sourceKey) && !(await storedFileExists(String(job.sourceKey)))) {
      throw new TranscriptionServiceError('O áudio temporário deste job já expirou e não pode ser reenfileirado.', 410);
    }

    await this.ready();
    const updateWhere: any = job.status === 'failed'
      ? { id, status: 'failed' }
      : { id, status: 'processing', updatedAt: job.updatedAt };
    const updatedCount = await (this.prismaRepository.transcriptionJob as any).updateMany({
      where: updateWhere,
      data: {
        status: 'queued',
        stage: 'queued',
        progressPercent: 0,
        processedDurationMs: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        attempts: { increment: 1 },
      },
    });
    if (!Number(updatedCount?.count)) {
      throw new TranscriptionServiceError(
        'O job mudou enquanto era reenfileirado. Atualize a lista e tente novamente.',
        409,
      );
    }
    const updated = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!updated) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);

    try {
      await this.publish(REQUESTED, this.jobPayload(updated));
    } catch (error) {
      await (this.prismaRepository.transcriptionJob as any).updateMany({
        where: { id, attempts: updated.attempts, status: 'queued' },
        data: {
          status: 'failed',
          stage: 'failed',
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage: String(error?.message || error).slice(0, 2000),
          completedAt: new Date(),
        },
      });
      throw new TranscriptionServiceError('Não foi possível reenfileirar o job.', 503);
    }
    return this.publicJob(updated);
  }

  /**
   * Remove an individual transcription job.
   *
   * Direct uploads own a temporary MinIO object, so that object is removed as
   * part of the operation. A transcription requested for a persisted message
   * never owns the message media; only its transcription result row is
   * removed. Active jobs are cancelled by deleting their durable row; a late
   * worker result is acknowledged and ignored by consumeResult.
   */
  public async delete(jobId: string, instanceId?: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);

    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    if (instanceId && String(job.instanceId || '') !== String(instanceId)) {
      throw new TranscriptionServiceError('Job de transcrição não pertence à instância autenticada.', 404);
    }
    const ownsTemporarySource = !job.messageId && this.isOwnedUploadKey(job.sourceKey);
    if (ownsTemporarySource) {
      // S3/MinIO removeObject is idempotent: an object already removed by its
      // lifecycle rule is considered successfully removed here.
      if (!minioEnabled() || !(await deleteStoredFile(String(job.sourceKey)))) {
        throw new TranscriptionServiceError('Não foi possível remover o áudio temporário do MinIO.', 503);
      }
    }

    try {
      await (this.prismaRepository.transcriptionJob as any).delete({ where: { id } });
    } catch (error) {
      this.logger.warn('Transcrição: não foi possível remover o resultado: ' + (error?.message || error));
      throw new TranscriptionServiceError('Não foi possível remover o resultado da transcrição.', 503);
    }

    return {
      id,
      deleted: true,
      cancelled: ['queued', 'processing'].includes(String(job.status)),
      sourceRemoved: ownsTemporarySource,
      sourceRetained: !ownsTemporarySource,
    };
  }

  private async createAndPublish(data: any) {
    const job = await (this.prismaRepository.transcriptionJob as any).create({
      data: {
        ...data,
        provider: providerValue(),
        status: 'queued',
        stage: 'queued',
        progressPercent: 0,
        processedDurationMs: 0,
        attempts: 1,
      },
    });
    try {
      await this.publish(REQUESTED, this.jobPayload(job));
    } catch (error) {
      await (this.prismaRepository.transcriptionJob as any).update({
        where: { id: job.id },
        data: {
          status: 'failed',
          stage: 'failed',
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage: String(error?.message || error).slice(0, 2000),
          completedAt: new Date(),
        },
      });
      throw new TranscriptionServiceError('Não foi possível publicar o job para o worker.', 503);
    }
    return this.publicJob(job);
  }

  private jobPayload(job: any) {
    return {
      jobId: job.id,
      messageId: job.messageId,
      instanceId: job.instanceId,
      source: { key: job.sourceKey, mimeType: job.sourceMimeType },
      language: job.language,
      model: job.model,
      attempts: job.attempts,
    };
  }

  private publicJob(job: any) {
    return {
      id: job.id,
      messageId: job.messageId,
      instanceId: job.instanceId,
      provider: job.provider,
      model: job.model,
      language: job.language,
      status: job.status,
      stage: job.stage || job.status,
      progressPercent: Number.isFinite(Number(job.progressPercent)) ? Number(job.progressPercent) : 0,
      processedDurationMs: job.processedDurationMs,
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

  private async ready() {
    await this.init();
    if (!this.channel) {
      throw new TranscriptionServiceError('A fila de transcrição está temporariamente indisponível.', 503);
    }

    const queue = normalizedQueue(process.env.TRANSCRIPTION_QUEUE);
    try {
      const state = await this.channel.checkQueue(queue);
      if (!Number(state?.consumerCount)) {
        throw new TranscriptionServiceError(
          'O worker local de transcrição não está ativo. Inclua o perfil transcription no Compose e tente novamente.',
          503,
        );
      }
    } catch (error) {
      if (error instanceof TranscriptionServiceError) throw error;
      this.logger.warn('Não foi possível confirmar o consumidor da fila de transcrição: ' + (error?.message || error));
      throw new TranscriptionServiceError('O worker local de transcrição está temporariamente indisponível.', 503);
    }
  }

  private async connect() {
    const uri = String(process.env.RABBITMQ_URI || '').trim();
    if (!uri) throw new Error('RABBITMQ_URI não configurado.');
    await this.prismaRepository.$connect();
    const exchange = String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim();
    const queue = normalizedQueue(process.env.TRANSCRIPTION_QUEUE);
    const resultQueue = queue + '.results';

    this.connection = await amqp.connect(uri);
    this.connection.on('error', (error) => this.logger.warn('RabbitMQ transcription: ' + (error?.message || error)));
    this.connection.on('close', () => {
      this.channel = null;
      this.connection = null;
      this.scheduleReconnect();
    });
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    await this.channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await this.channel.bindQueue(queue, exchange, REQUESTED);
    await this.channel.assertQueue(resultQueue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    for (const key of [PROCESSING, COMPLETED, FAILED]) await this.channel.bindQueue(resultQueue, exchange, key);
    await this.channel.prefetch(20);
    await this.channel.consume(
      resultQueue,
      (message) => {
        if (message) void this.consumeResult(message);
      },
      { noAck: false },
    );
    this.logger.info('Transcription queue - ON (' + queue + ')');
    // Recover abandoned jobs as soon as a real worker consumer is present;
    // waiting for the periodic timer would leave old `processing` rows visible
    // in the Manager for another full interval after a deploy.
    void this.recoverStaleJobs();
  }

  private scheduleReconnect() {
    if (!this.isEnabled() || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.init();
    }, 5000);
  }

  private async publish(routingKey: string, payload: Record<string, unknown>) {
    if (!this.channel) throw new Error('RabbitMQ channel indisponível.');
    const channel = this.channel;
    const exchange = String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim();
    await new Promise<void>((resolve, reject) => {
      try {
        channel.publish(
          exchange,
          routingKey,
          Buffer.from(JSON.stringify(payload)),
          {
            persistent: true,
            contentType: 'application/json',
            messageId: String(payload.jobId || ''),
          },
          (error: Error | null) => error ? reject(error) : resolve(),
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  private async consumeResult(message: any) {
    try {
      const payload = JSON.parse(message.content.toString('utf8')) as WorkerResult;
      const jobId = String(payload.jobId || '').trim();
      if (!jobId) {
        this.channel.ack(message);
        return;
      }
      const status = ['processing', 'completed', 'failed'].includes(String(payload.status))
        ? String(payload.status)
        : 'failed';
      const data: any = { status, updatedAt: new Date() };
      data.stage = status === 'completed' || status === 'failed'
        ? status
        : String(payload.stage || status).trim().slice(0, 32);
      if (Number.isFinite(Number(payload.progressPercent))) {
        data.progressPercent = Math.max(
          0,
          Math.min(status === 'completed' ? 100 : 99, Math.floor(Number(payload.progressPercent))),
        );
      }
      if (Number.isFinite(Number(payload.processedDurationMs))) {
        data.processedDurationMs = Math.max(0, Math.floor(Number(payload.processedDurationMs)));
      }
      if (status === 'processing') {
        const current = await (this.prismaRepository.transcriptionJob as any).findUnique({
          where: { id: jobId },
          select: { startedAt: true },
        });
        if (!current) {
          this.channel.ack(message);
          return;
        }
        if (!current.startedAt) data.startedAt = new Date();
      } else if (status === 'completed') {
        data.text = String(payload.text || '');
        data.detectedLanguage = payload.language ? String(payload.language) : null;
        data.durationMs = Number.isFinite(Number(payload.durationMs)) ? Math.round(Number(payload.durationMs)) : null;
        data.segments = payload.segments ?? null;
        data.provider = payload.provider || undefined;
        data.model = payload.model || undefined;
        data.errorCode = null;
        data.errorMessage = null;
        data.completedAt = new Date();
        data.progressPercent = 100;
      } else {
        data.errorCode = String(payload.errorCode || 'TRANSCRIPTION_FAILED').slice(0, 64);
        data.errorMessage = String(payload.errorMessage || 'Falha no worker.').slice(0, 2000);
        data.completedAt = new Date();
      }
      const attempts = Number.isFinite(Number(payload.attempts))
        ? Math.max(1, Math.floor(Number(payload.attempts)))
        : null;
      let updateWhere: any;
      if (attempts === null) {
        // Older workers did not include the attempt number. Accept one of
        // their results only for an active first-attempt job; once a retry
        // has advanced the durable counter, a late legacy result cannot
        // overwrite the newer execution.
        const current = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id: jobId } });
        const currentAttempts = Number(current?.attempts || 0);
        if (!current || !['queued', 'processing'].includes(String(current.status)) || currentAttempts > 1) {
          this.logger.debug(
            'Resultado legado de transcrição ignorado para job ausente, terminal ou repetido: ' + jobId,
          );
          this.channel.ack(message);
          return;
        }
        updateWhere = { id: jobId, status: { in: ['queued', 'processing'] }, attempts: currentAttempts };
      } else {
        updateWhere = { id: jobId, attempts, status: { in: ['queued', 'processing'] } };
      }
      const updated = await (this.prismaRepository.transcriptionJob as any).updateMany({ where: updateWhere, data });
      if (!Number(updated?.count)) {
        // The job may have been deliberately removed, or this is a late result
        // from an older retry attempt. It must not poison the durable queue.
        this.logger.debug('Resultado de transcrição ignorado para job ausente ou tentativa antiga: ' + jobId);
      }
      this.channel.ack(message);
    } catch (error) {
      this.logger.error('Resultado de transcrição inválido: ' + (error?.message || error));
      this.channel.nack(message, false, false);
    }
  }

  public async cleanupExpiredUploads(input: { olderThanSeconds?: number; limit?: number } = {}) {
    if (!minioEnabled()) {
      throw new TranscriptionServiceError('O armazenamento privado de áudio não está disponível.', 503);
    }

    const configuredRetention = this.sourceRetentionSeconds();
    const requestedRetention =
      input.olderThanSeconds === undefined ? configuredRetention : Number(input.olderThanSeconds);
    if (!Number.isFinite(requestedRetention) || requestedRetention <= 0) {
      throw new TranscriptionServiceError('Informe uma retenção positiva para limpar os áudios temporários.', 400);
    }
    const retentionSeconds = Math.min(Math.floor(requestedRetention), 31_536_000);
    const limitValue = Number(input.limit);
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(Math.floor(limitValue), 1), 1000) : 250;
    const cutoff = Date.now() - retentionSeconds * 1000;

    const jobs = (await (this.prismaRepository.transcriptionJob as any).findMany({
      where: { sourceKey: { startsWith: TRANSCRIPTION_SOURCE_PREFIX } },
      select: {
        id: true,
        sourceKey: true,
        messageId: true,
        status: true,
        completedAt: true,
        updatedAt: true,
        createdAt: true,
      },
    })) as Array<{
      id: string;
      sourceKey: string;
      messageId: string | null;
      status: string;
      completedAt: Date | null;
      updatedAt: Date;
      createdAt: Date;
    }>;

    const protectedKeys = new Set<string>();
    const expiredKeys = new Set<string>();
    const expiredJobIdsBySource = new Map<string, string[]>();
    for (const job of jobs) {
      const sourceKey = String(job.sourceKey || '');
      if (job.messageId || !this.isOwnedUploadKey(sourceKey)) continue;
      if (job.status === 'queued' || job.status === 'processing') {
        protectedKeys.add(sourceKey);
        continue;
      }
      if (!['completed', 'failed'].includes(String(job.status))) continue;
      const terminalDate = job.completedAt || job.updatedAt || job.createdAt;
      if (terminalDate && terminalDate.getTime() <= cutoff) {
        expiredKeys.add(sourceKey);
        const ids = expiredJobIdsBySource.get(sourceKey) || [];
        ids.push(job.id);
        expiredJobIdsBySource.set(sourceKey, ids);
      }
    }
    for (const protectedKey of protectedKeys) {
      expiredKeys.delete(protectedKey);
      expiredJobIdsBySource.delete(protectedKey);
    }

    const bucketListing = await listBucketObjects(MANAGED_OBJECT_PREFIX + TRANSCRIPTION_SOURCE_PREFIX);
    const objects = bucketListing.objects;
    const objectBySourceKey = new Map<string, { size: number; lastModified: string | null }>();
    for (const object of objects) {
      if (!object.key.startsWith(MANAGED_OBJECT_PREFIX + TRANSCRIPTION_SOURCE_PREFIX)) continue;
      const sourceKey = object.key.slice(MANAGED_OBJECT_PREFIX.length);
      objectBySourceKey.set(sourceKey, object);
      if (!bucketListing.truncated && !protectedKeys.has(sourceKey) && !expiredKeys.has(sourceKey)) {
        const lastModified = object.lastModified ? Date.parse(object.lastModified) : NaN;
        if (Number.isFinite(lastModified) && lastModified <= cutoff) expiredKeys.add(sourceKey);
      }
    }

    const candidates = [...expiredKeys].slice(0, limit);
    let removed = 0;
    let failed = 0;
    let freedBytes = 0;
    let jobsRemoved = 0;
    let jobsFailed = 0;
    for (const sourceKey of candidates) {
      if (await deleteStoredFile(sourceKey)) {
        removed += 1;
        freedBytes += objectBySourceKey.get(sourceKey)?.size || 0;
        const jobIds = expiredJobIdsBySource.get(sourceKey) || [];
        if (jobIds.length) {
          try {
            const deleted = await (this.prismaRepository.transcriptionJob as any).deleteMany({
              where: { id: { in: jobIds } },
            });
            jobsRemoved += Number(deleted?.count || 0);
            jobsFailed += Math.max(0, jobIds.length - Number(deleted?.count || 0));
          } catch (error) {
            jobsFailed += jobIds.length;
            this.logger.warn(
              'Transcrição: não foi possível remover o resultado expirado: ' + (error?.message || error),
            );
          }
        }
      } else {
        failed += 1;
      }
    }

    return {
      status: failed || jobsFailed ? 'partial' : 'completed',
      retentionSeconds,
      cutoff: new Date(cutoff).toISOString(),
      candidates: candidates.length,
      removed,
      failed,
      freedBytes,
      jobsRemoved,
      jobsFailed,
    };
  }

  private isOwnedUploadKey(value: unknown): boolean {
    const key = String(value || '').trim();
    return key.startsWith(TRANSCRIPTION_SOURCE_PREFIX) && !key.includes('..');
  }

  private sourceRetentionSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_SOURCE_RETENTION_SECONDS || '', 10);
    if (!Number.isFinite(value)) return 86_400;
    return Math.min(Math.max(value, 0), 31_536_000);
  }

  private sourceCleanupIntervalSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_SOURCE_CLEANUP_INTERVAL_SECONDS || '', 10);
    if (!Number.isFinite(value)) return 900;
    return Math.min(Math.max(value, 60), 86_400);
  }

  private staleJobSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_STALE_JOB_SECONDS || '', 10);
    if (!Number.isFinite(value)) return 1800;
    return Math.min(Math.max(value, 60), 86_400);
  }

  private staleRecoveryIntervalSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_STALE_RECOVERY_INTERVAL_SECONDS || '', 10);
    if (!Number.isFinite(value)) return 60;
    return Math.min(Math.max(value, 30), 3600);
  }

  private isStaleJob(job: any): boolean {
    if (String(job?.status) !== 'processing') return false;
    const updatedAt = new Date(job?.updatedAt || job?.createdAt || 0).getTime();
    return Number.isFinite(updatedAt) && Date.now() - updatedAt >= this.staleJobSeconds() * 1000;
  }

  private startStaleRecovery() {
    if (this.staleRecoveryTimer || this.staleJobSeconds() <= 0) return;
    const interval = this.staleRecoveryIntervalSeconds();
    this.staleRecoveryTimer = setInterval(() => void this.recoverStaleJobs(), interval * 1000);
    this.staleRecoveryTimer.unref?.();
    void this.recoverStaleJobs();
  }

  private async recoverStaleJobs() {
    if (this.staleRecoveryInFlight || !this.channel) return;
    this.staleRecoveryInFlight = true;
    try {
      const queue = normalizedQueue(process.env.TRANSCRIPTION_QUEUE);
      const state = await this.channel.checkQueue(queue);
      if (!Number(state?.consumerCount)) return;
      const cutoff = new Date(Date.now() - this.staleJobSeconds() * 1000);
      const jobs = await (this.prismaRepository.transcriptionJob as any).findMany({
        // A queued database row may already be prefetched by RabbitMQ. Queue
        // messageCount excludes unacked messages, so re-publishing it here can
        // create duplicate transcriptions. Only recover a lost processing
        // heartbeat; queued jobs stay with RabbitMQ's durable delivery path.
        where: { status: 'processing', updatedAt: { lt: cutoff } },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      for (const job of jobs) {
        const changed = await (this.prismaRepository.transcriptionJob as any).updateMany({
          where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
          data: {
            status: 'queued',
            stage: 'queued',
            progressPercent: 0,
            processedDurationMs: 0,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            attempts: { increment: 1 },
          },
        });
        if (!Number(changed?.count)) continue;
        const updated = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id: job.id } });
        if (!updated) continue;
        try {
          await this.publish(REQUESTED, this.jobPayload(updated));
        } catch (error) {
          await (this.prismaRepository.transcriptionJob as any).updateMany({
            where: { id: updated.id, attempts: updated.attempts, status: 'queued' },
            data: {
              status: 'failed',
              stage: 'failed',
              errorCode: 'QUEUE_UNAVAILABLE',
              errorMessage: String(error?.message || error).slice(0, 2000),
              completedAt: new Date(),
            },
          });
        }
      }
    } catch (error) {
      this.logger.warn('Transcrição: recuperação de jobs abandonados indisponível: ' + (error?.message || error));
    } finally {
      this.staleRecoveryInFlight = false;
    }
  }

  private startSourceCleanup() {
    if (this.sourceCleanupTimer || this.sourceRetentionSeconds() <= 0) return;
    const interval = this.sourceCleanupIntervalSeconds();
    this.sourceCleanupTimer = setInterval(() => void this.runSourceCleanup(), interval * 1000);
    this.sourceCleanupTimer.unref?.();
    void this.runSourceCleanup();
  }

  private async runSourceCleanup() {
    if (this.sourceCleanupInFlight || this.sourceRetentionSeconds() <= 0) return;
    this.sourceCleanupInFlight = true;
    try {
      const result = await this.cleanupExpiredUploads({
        olderThanSeconds: this.sourceRetentionSeconds(),
      });
      if (result.removed || result.failed) {
        this.logger.info(
          `Transcrição: limpeza removeu ${result.removed} objeto(s) e ${result.jobsRemoved} resultado(s); falhas=${result.failed + result.jobsFailed}.`,
        );
      }
    } catch (error) {
      this.logger.warn('Transcrição: limpeza de áudios temporários indisponível: ' + (error?.message || error));
    } finally {
      this.sourceCleanupInFlight = false;
    }
  }
}
