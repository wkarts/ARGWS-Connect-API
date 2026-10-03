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
  status?: string;
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

  constructor(private readonly prismaRepository: PrismaRepository) {}

  public isEnabled(): boolean {
    return enabledValue(process.env.TRANSCRIPTION_ENABLED, false);
  }

  public async init(): Promise<void> {
    if (!this.isEnabled()) return;
    this.startSourceCleanup();
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
      return await this.createAndPublish(
        {
          instanceId: input.instanceId || null,
          messageId: null,
          sourceKey,
          sourceMimeType: mimeType,
          language,
          model,
        },
        sourceKey,
      );
    } catch (error) {
      await deleteStoredFile(sourceKey).catch(() => false);
      if (error instanceof TranscriptionServiceError) throw error;
      throw new TranscriptionServiceError('Não foi possível armazenar o áudio para transcrição.', 503);
    }
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
    if (job.status !== 'failed') {
      throw new TranscriptionServiceError('Somente jobs com falha podem ser reenfileirados.', 409);
    }
    if (!job.messageId && this.isOwnedUploadKey(job.sourceKey) && !(await storedFileExists(String(job.sourceKey)))) {
      throw new TranscriptionServiceError('O áudio temporário deste job já expirou e não pode ser reenfileirado.', 410);
    }

    await this.ready();
    const updated = await (this.prismaRepository.transcriptionJob as any).update({
      where: { id },
      data: {
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        attempts: { increment: 1 },
      },
    });

    try {
      await this.publish(REQUESTED, this.jobPayload(updated));
    } catch (error) {
      await (this.prismaRepository.transcriptionJob as any).update({
        where: { id },
        data: {
          status: 'failed',
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
   * Remove an individual terminal transcription job.
   *
   * Direct uploads own a temporary MinIO object, so that object is removed as
   * part of the operation. A transcription requested for a persisted message
   * never owns the message media; only its transcription result row is
   * removed. Queued/processing jobs are deliberately protected from races with
   * the worker and must finish before they can be deleted.
   */
  public async delete(jobId: string, instanceId?: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);

    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    if (instanceId && String(job.instanceId || '') !== String(instanceId)) {
      throw new TranscriptionServiceError('Job de transcrição não pertence à instância autenticada.', 404);
    }
    if (job.status === 'queued' || job.status === 'processing') {
      throw new TranscriptionServiceError('Aguarde o processamento terminar antes de remover este job.', 409);
    }
    if (!['completed', 'failed'].includes(String(job.status))) {
      throw new TranscriptionServiceError('Somente jobs concluídos ou com falha podem ser removidos.', 409);
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
      sourceRemoved: ownsTemporarySource,
      sourceRetained: !ownsTemporarySource,
    };
  }

  private async createAndPublish(data: any, cleanupKey?: string) {
    const job = await (this.prismaRepository.transcriptionJob as any).create({
      data: {
        ...data,
        provider: providerValue(),
        status: 'queued',
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
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage: String(error?.message || error).slice(0, 2000),
          completedAt: new Date(),
        },
      });
      if (cleanupKey) await deleteStoredFile(cleanupKey).catch(() => false);
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
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    await this.channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await this.channel.bindQueue(queue, exchange, REQUESTED);
    await this.channel.assertQueue(resultQueue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    for (const key of [PROCESSING, COMPLETED, FAILED]) await this.channel.bindQueue(resultQueue, exchange, key);
    await this.channel.consume(
      resultQueue,
      (message) => {
        if (message) void this.consumeResult(message);
      },
      { noAck: false },
    );
    this.logger.info('Transcription queue - ON (' + queue + ')');
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
    const exchange = String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim();
    const accepted = this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
      messageId: String(payload.jobId || ''),
    });
    if (!accepted) await new Promise((resolve) => this.channel.once('drain', resolve));
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
      if (status === 'processing') data.startedAt = new Date();
      else if (status === 'completed') {
        data.text = String(payload.text || '');
        data.detectedLanguage = payload.language ? String(payload.language) : null;
        data.durationMs = Number.isFinite(Number(payload.durationMs)) ? Math.round(Number(payload.durationMs)) : null;
        data.segments = payload.segments ?? null;
        data.provider = payload.provider || undefined;
        data.model = payload.model || undefined;
        data.errorCode = null;
        data.errorMessage = null;
        data.completedAt = new Date();
      } else {
        data.errorCode = String(payload.errorCode || 'TRANSCRIPTION_FAILED').slice(0, 64);
        data.errorMessage = String(payload.errorMessage || 'Falha no worker.').slice(0, 2000);
        data.completedAt = new Date();
      }
      await (this.prismaRepository.transcriptionJob as any).update({ where: { id: jobId }, data });
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
