import {
  deleteStoredFile,
  listBucketObjects,
  minioEnabled,
  storedFileExists,
  uploadFile,
} from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';
import { SpeechModelDownloadService, SpeechModelDownloadStatus } from '@api/services/speech-model-download.service';
import { Logger } from '@config/logger.config';
import * as amqp from 'amqplib';
import { createHash, randomUUID } from 'crypto';
import path from 'path';

const REQUESTED = 'transcription.requested';
const DICTATION_REQUESTED = 'speech.dictation.requested';
const TRANSCRIPTION_SOURCE_PREFIX = 'transcriptions/';
const MANAGED_OBJECT_PREFIX = 'argws-connect-api/';
const MODEL_BOOTSTRAP_RETRY_MS = 125_000;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

type EnqueueInput = {
  messageId?: string;
  instanceId?: string;
  language?: string;
  model?: string;
  idempotencyKey?: string;
};

type UploadInput = {
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
  instanceId?: string;
  language?: string;
  model?: string;
  idempotencyKey?: string;
};

type DictationInput = UploadInput & { durationMs?: number };

type WorkerResult = {
  jobId?: string;
  attempts?: number;
  status?: string;
  stage?: string | null;
  progressPercent?: number;
  processedDurationMs?: number | null;
  heartbeatAt?: string;
  partialText?: string;
  mode?: string;
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
  const queue = String(value || 'speech.transcription').trim();
  return queue || 'speech.transcription';
}

function dictationQueue(): string {
  const queue = String(process.env.SPEECH_DICTATION_QUEUE || 'speech.dictation').trim();
  return queue || 'speech.dictation';
}

function queueFor(mode: string): string {
  return mode === 'dictation'
    ? dictationQueue()
    : normalizedQueue(process.env.SPEECH_TRANSCRIPTION_QUEUE || process.env.TRANSCRIPTION_QUEUE);
}

function requestRoutingKey(mode: string): string {
  return mode === 'dictation' ? DICTATION_REQUESTED : REQUESTED;
}

function resultRoutingPrefix(mode: string): string {
  return mode === 'dictation' ? 'speech.dictation.' : 'transcription.';
}

function cancelRoutingKey(mode: string): string {
  return mode === 'dictation' ? 'speech.cancel.dictation' : 'speech.cancel.transcription';
}

function providerValue(): string {
  const provider = String(
    process.env.SPEECH_PROVIDER || process.env.TRANSCRIPTION_PROVIDER || process.env.TRANSCRIPTION_ENGINE || 'local',
  )
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
  const model = String(
    value || process.env.SPEECH_MODEL || process.env.TRANSCRIPTION_LOCAL_MODEL || 'Xenova/whisper-small',
  ).trim();
  if (!/^[A-Za-z0-9._:/@-]{1,100}$/.test(model)) {
    throw new TranscriptionServiceError('model inválido.', 400);
  }
  return model;
}

function maxUploadBytes(): number {
  const value = Number.parseInt(process.env.TRANSCRIPTION_MAX_AUDIO_BYTES || '', 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 250 * 1024 * 1024) : 25 * 1024 * 1024;
}

function maxDictationBytes(): number {
  const value = Number.parseInt(process.env.DICTATION_MAX_AUDIO_BYTES || '', 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 25 * 1024 * 1024) : 5 * 1024 * 1024;
}

function dictationAudioRetentionMs(): number {
  const minutes = Number.parseInt(process.env.DICTATION_AUDIO_RETENTION_MINUTES || '5', 10);
  return Math.min(Math.max(Number.isFinite(minutes) ? minutes : 5, 1), 60) * 60_000;
}

function safeIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const key = String(value).trim();
  const hasControlCharacter = [...key].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (key.length > 128 || hasControlCharacter) {
    throw new TranscriptionServiceError('Idempotency-Key inválida.', 400);
  }
  return key;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
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
  private readonly modelDownloadService = new SpeechModelDownloadService();
  private modelBootstrapStarted = false;
  private modelBootstrapRetryTimer: NodeJS.Timeout | null = null;
  private connection: any = null;
  private channel: any = null;
  private resultChannel: any = null;
  private readonly settledResultMessages = new WeakSet<object>();
  private initializing: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sourceCleanupTimer: NodeJS.Timeout | null = null;
  private sourceCleanupInFlight = false;
  private staleRecoveryTimer: NodeJS.Timeout | null = null;
  private staleRecoveryInFlight = false;

  constructor(private readonly prismaRepository: PrismaRepository) {}

  public isEnabled(): boolean {
    return enabledValue(process.env.SPEECH_ENABLED, enabledValue(process.env.TRANSCRIPTION_ENABLED, false));
  }

  public isDictationEnabled(): boolean {
    return this.isEnabled() && enabledValue(process.env.DICTATION_ENABLED, true);
  }

  public async init(): Promise<void> {
    this.startDefaultModelDownload();
    if (!this.isEnabled()) return;
    this.startSourceCleanup();
    this.startStaleRecovery();
    if (!enabledValue(process.env.RABBITMQ_ENABLED, true)) return;
    // Health polling calls init on every request. Replacing a live connection
    // strands deliveries on its old result consumer and leaks AMQP connections.
    if (this.connection && this.channel && this.resultChannel) return;
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

  /**
   * Provision the pinned model at API startup. The download runs in the
   * background so normal API startup does not wait for the model host.
   */
  private startDefaultModelDownload(): void {
    if (this.modelBootstrapStarted) return;
    this.modelBootstrapStarted = true;

    void this.modelDownloadService
      .status()
      .then(async (status) => {
        if (!status.available || status.installed) return;
        if (status.status === 'downloading') {
          this.scheduleModelBootstrapRetry();
          return;
        }
        const started = await this.modelDownloadService.start(status.id);
        if (started.status === 'downloading' || started.installed) {
          this.logger.info(`Modelo de voz ${started.id}: download iniciado ou já disponível no volume persistente.`);
        }
      })
      .catch((error) => {
        this.logger.warn('Não foi possível iniciar o provisionamento do modelo de voz: ' + (error?.message || error));
      });
  }

  private scheduleModelBootstrapRetry(): void {
    if (this.modelBootstrapRetryTimer) return;
    this.modelBootstrapRetryTimer = setTimeout(() => {
      this.modelBootstrapRetryTimer = null;
      this.modelBootstrapStarted = false;
      this.startDefaultModelDownload();
    }, MODEL_BOOTSTRAP_RETRY_MS);
    this.modelBootstrapRetryTimer.unref?.();
  }

  public async list(limit = 30, mode = 'transcription') {
    if (!this.isEnabled()) return [];
    const take = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 100) : 30;
    const jobs = await (this.prismaRepository.transcriptionJob as any).findMany({
      where: { mode: mode === 'dictation' ? 'dictation' : 'transcription' },
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
    const queue = queueFor('transcription');
    const result: any = {
      enabled: this.isEnabled(),
      queue,
      connected: false,
      consumerCount: 0,
      workerReady: false,
      dictationQueue: dictationQueue(),
      dictationConsumerCount: 0,
      dictationWorkerReady: false,
      staleJobSeconds: this.staleJobSeconds(),
      maxUploadBytes: maxUploadBytes(),
      maxDictationBytes: maxDictationBytes(),
      dictationAudioRetentionMinutes: Math.floor(dictationAudioRetentionMs() / 60_000),
      queuedJobs: 0,
      processingJobs: 0,
      dictationQueuedJobs: 0,
      dictationProcessingJobs: 0,
      oldestQueuedSeconds: null as number | null,
      model: String(process.env.SPEECH_MODEL || process.env.TRANSCRIPTION_LOCAL_MODEL || 'Xenova/whisper-small'),
      provider: providerValue(),
      allowRemoteModels: false,
      modelDownload: null as SpeechModelDownloadStatus | null,
    };
    result.modelDownload = await this.modelDownloadStatus();
    if (!this.isEnabled()) return result;

    try {
      const jobs = this.prismaRepository.transcriptionJob as any;
      const [queuedJobs, processingJobs, oldestQueued, dictationQueuedJobs, dictationProcessingJobs] =
        await Promise.all([
          jobs.count({ where: { mode: 'transcription', status: 'queued' } }),
          jobs.count({ where: { mode: 'transcription', status: 'processing' } }),
          jobs.findFirst({
            where: { mode: 'transcription', status: 'queued' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
          jobs.count({ where: { mode: 'dictation', status: 'queued' } }),
          jobs.count({ where: { mode: 'dictation', status: 'processing' } }),
        ]);
      result.queuedJobs = Number(queuedJobs || 0);
      result.processingJobs = Number(processingJobs || 0);
      result.dictationQueuedJobs = Number(dictationQueuedJobs || 0);
      result.dictationProcessingJobs = Number(dictationProcessingJobs || 0);
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
    if (!this.channel || !this.resultChannel) return result;
    result.connected = true;
    try {
      const state = await this.channel.checkQueue(queue);
      result.consumerCount = Number(state?.consumerCount || 0);
      result.workerReady = result.consumerCount > 0;
      result.messageCount = Number(state?.messageCount || 0);
      const dictationState = await this.channel.checkQueue(dictationQueue());
      result.dictationConsumerCount = Number(dictationState?.consumerCount || 0);
      result.dictationWorkerReady = result.dictationConsumerCount > 0;
      result.dictationMessageCount = Number(dictationState?.messageCount || 0);
    } catch (error) {
      this.logger.debug('Transcrição: diagnóstico da fila indisponível: ' + (error?.message || error));
    }
    return result;
  }

  public async modelDownloadStatus(): Promise<SpeechModelDownloadStatus> {
    const status = await this.modelDownloadService.status();
    return { ...status, available: status.available && this.isEnabled() };
  }

  public async downloadModel(modelId: string): Promise<SpeechModelDownloadStatus> {
    if (!this.isEnabled()) {
      throw new TranscriptionServiceError('A transcrição local está desabilitada nesta instalação.', 409);
    }
    try {
      return await this.modelDownloadService.start(String(modelId || '').trim());
    } catch (error: any) {
      throw new TranscriptionServiceError(String(error?.message || error), 409);
    }
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

    const language = safeLanguage(input.language || process.env.SPEECH_LANGUAGE || 'pt-BR');
    const model = safeModel(input.model);
    const idempotencyKey = safeIdempotencyKey(input.idempotencyKey);

    const pending = await (this.prismaRepository.transcriptionJob as any).findFirst({
      where: {
        messageId,
        mode: 'transcription',
        model,
        language,
        status: { in: ['queued', 'processing', 'completed'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return this.publicJob(pending);

    const duplicate = await this.findDuplicate({ mode: 'transcription', instanceId: media.instanceId, idempotencyKey });
    if (duplicate) return this.publicJob(duplicate);

    await this.ready('transcription');
    return this.createAndPublish({
      instanceId: media.instanceId,
      messageId,
      mode: 'transcription',
      sourceType: 'message',
      sourceKey: String(media.fileName),
      sourceMimeType: mimetype,
      idempotencyKey,
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
      throw new TranscriptionServiceError(
        'O arquivo de áudio não contém dados. Grave novamente ou selecione outro áudio.',
        400,
      );
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

    const language = safeLanguage(input.language || process.env.SPEECH_LANGUAGE || 'pt-BR');
    const model = safeModel(input.model);
    const idempotencyKey = safeIdempotencyKey(input.idempotencyKey);
    const audioHash = sha256(input.buffer);
    const duplicate = await this.findDuplicate({
      mode: 'transcription',
      instanceId: input.instanceId || null,
      idempotencyKey,
      audioHash,
      model,
      language,
    });
    if (duplicate) return this.publicJob(duplicate);

    await this.ready('transcription');
    const sourceKey = `transcriptions/${randomUUID()}/audio${uploadExtension(String(input.fileName || ''), mimeType)}`;
    try {
      const stored = await uploadFile(sourceKey, input.buffer, input.buffer.length, {
        'Content-Type': mimeType,
      } as any);
      if (stored instanceof Error) {
        throw stored;
      }
    } catch {
      await deleteStoredFile(sourceKey).catch(() => false);
      throw new TranscriptionServiceError('Não foi possível armazenar o áudio para transcrição.', 503);
    }

    try {
      return await this.createAndPublish({
        instanceId: input.instanceId || null,
        messageId: null,
        mode: 'transcription',
        sourceType: 'upload',
        sourceKey,
        sourceMimeType: mimeType,
        originalFilename: path.basename(String(input.fileName || '')).slice(0, 255) || null,
        sizeBytes: input.buffer.length,
        audioHash,
        idempotencyKey,
        language,
        model,
      });
    } catch (error) {
      await deleteStoredFile(sourceKey).catch(() => false);
      throw error;
    }
  }

  /**
   * Dictation keeps short recordings in the durable queue payload. This avoids
   * the object-store round trip while leaving long, persistent transcription
   * uploads on their existing MinIO path.
   */
  public async enqueueDictation(input: DictationInput) {
    if (!this.isDictationEnabled()) {
      throw new TranscriptionServiceError('O ditado está desabilitado nesta instalação.', 409);
    }
    if (!Buffer.isBuffer(input?.buffer) || input.buffer.length === 0) {
      throw new TranscriptionServiceError(
        'O áudio do ditado não contém dados. Confira o microfone e grave novamente.',
        400,
      );
    }
    if (input.buffer.length > maxDictationBytes()) {
      throw new TranscriptionServiceError('O áudio do ditado excede o limite configurado.', 413);
    }
    const mimeType = normalizeTranscriptionAudioMime(input.mimeType, input.fileName);
    if (!supportedAudio.has(mimeType)) {
      throw new TranscriptionServiceError('Formato de áudio não suportado pelo ditado.', 415);
    }
    const durationMs = Number(input.durationMs);
    const maxDuration =
      Math.min(Math.max(Number.parseInt(process.env.DICTATION_MAX_DURATION_SECONDS || '300', 10) || 300, 1), 1800) *
      1000;
    if (Number.isFinite(durationMs) && durationMs > maxDuration) {
      throw new TranscriptionServiceError('O ditado excede a duração máxima configurada.', 413);
    }

    const language = safeLanguage(input.language || process.env.SPEECH_LANGUAGE || 'pt-BR');
    const model = safeModel(input.model);
    const idempotencyKey = safeIdempotencyKey(input.idempotencyKey);
    const audioHash = sha256(input.buffer);
    const duplicate = await this.findDuplicate({
      mode: 'dictation',
      instanceId: input.instanceId || null,
      idempotencyKey,
      audioHash,
      model,
      language,
    });
    if (duplicate) return this.publicJob(duplicate);

    await this.ready('dictation');
    const id = randomUUID();
    const job = await this.createAndPublish(
      {
        id,
        instanceId: input.instanceId || null,
        messageId: null,
        mode: 'dictation',
        sourceType: 'microphone',
        sourceKey: `dictation/${id}${uploadExtension(String(input.fileName || ''), mimeType)}`,
        sourceMimeType: mimeType,
        originalFilename: path.basename(String(input.fileName || '')).slice(0, 255) || null,
        sizeBytes: input.buffer.length,
        audioHash,
        idempotencyKey,
        provider: providerValue(),
        language,
        model,
      },
      input.buffer,
    );
    return job;
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

  public async cancel(jobId: string, instanceId?: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);
    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    if (instanceId && String(job.instanceId || '') !== String(instanceId)) {
      throw new TranscriptionServiceError('Job de transcrição não pertence à instância autenticada.', 404);
    }
    if (!['queued', 'processing'].includes(String(job.status))) {
      throw new TranscriptionServiceError('O job já foi concluído e não pode ser cancelado.', 409);
    }

    const changed = await (this.prismaRepository.transcriptionJob as any).updateMany({
      where: { id, status: { in: ['queued', 'processing'] }, attempts: job.attempts },
      data: { status: 'cancelled', stage: 'cancelled', completedAt: new Date(), updatedAt: new Date() },
    });
    if (!Number(changed?.count)) {
      const latest = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
      if (!latest || latest.status !== 'cancelled') {
        throw new TranscriptionServiceError('O job mudou antes de o cancelamento ser aplicado.', 409);
      }
      return this.publicJob(latest);
    }

    try {
      await this.publish(cancelRoutingKey(String(job.mode || 'transcription')), {
        jobId: id,
        attempts: job.attempts,
        mode: job.mode || 'transcription',
      });
    } catch (error) {
      // The durable state remains cancelled; workers also ignore late results
      // because the API only accepts results for active jobs.
      this.logger.warn('Transcrição: aviso de cancelamento não chegou ao worker: ' + (error?.message || error));
    }
    const cancelled = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    return this.publicJob(cancelled || { ...job, status: 'cancelled', stage: 'cancelled' });
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

    await this.ready(String(job.mode || 'transcription'));
    const updateWhere: any =
      job.status === 'failed' ? { id, status: 'failed' } : { id, status: 'processing', updatedAt: job.updatedAt };
    const updatedCount = await (this.prismaRepository.transcriptionJob as any).updateMany({
      where: updateWhere,
      data: {
        status: 'queued',
        stage: 'queued',
        progressPercent: 0,
        processedDurationMs: 0,
        heartbeatAt: null,
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
      await this.publish(requestRoutingKey(String(updated.mode || 'transcription')), this.jobPayload(updated));
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
    if (['queued', 'processing'].includes(String(job.status))) {
      try {
        await this.publish(cancelRoutingKey(String(job.mode || 'transcription')), {
          jobId: id,
          attempts: job.attempts,
          mode: job.mode || 'transcription',
        });
      } catch (error) {
        this.logger.warn(
          'Transcrição: não foi possível avisar o worker antes da exclusão: ' + (error?.message || error),
        );
      }
    }
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

  private async createAndPublish(data: any, inlineAudio?: Buffer) {
    const mode = data.mode === 'dictation' ? 'dictation' : 'transcription';
    let job: any;
    try {
      job = await (this.prismaRepository.transcriptionJob as any).create({
        data: {
          ...data,
          provider: providerValue(),
          mode,
          status: 'queued',
          stage: 'queued',
          progressPercent: 0,
          processedDurationMs: 0,
          attempts: 1,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002' && (data.audioHash || data.idempotencyKey)) {
        const duplicate = await this.findDuplicate({
          mode,
          instanceId: data.instanceId || null,
          idempotencyKey: data.idempotencyKey,
          audioHash: data.audioHash,
          model: data.model,
          language: data.language,
        });
        if (duplicate) {
          if (data.sourceKey && data.sourceKey !== duplicate.sourceKey) {
            await deleteStoredFile(String(data.sourceKey)).catch(() => false);
          }
          return this.publicJob(duplicate);
        }
      }
      throw error;
    }
    try {
      await this.publish(requestRoutingKey(mode), this.jobPayload(job, inlineAudio));
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

  private jobPayload(job: any, inlineAudio?: Buffer) {
    return {
      jobId: job.id,
      mode: job.mode || 'transcription',
      messageId: job.messageId,
      instanceId: job.instanceId,
      source: { key: job.sourceKey, mimeType: job.sourceMimeType },
      language: job.language,
      model: job.model,
      attempts: job.attempts,
      ...(inlineAudio ? { inlineAudio: inlineAudio.toString('base64') } : {}),
    };
  }

  private publicJob(job: any) {
    return {
      id: job.id,
      messageId: job.messageId,
      instanceId: job.instanceId,
      mode: job.mode || 'transcription',
      sourceType: job.sourceType || 'upload',
      originalFilename: job.originalFilename || null,
      sizeBytes: job.sizeBytes ?? null,
      audioHash: job.audioHash || null,
      provider: job.provider,
      model: job.model,
      language: job.language,
      status: job.status,
      stage: job.stage || job.status,
      progressPercent: Number.isFinite(Number(job.progressPercent)) ? Number(job.progressPercent) : 0,
      processedDurationMs: job.processedDurationMs,
      heartbeatAt: job.heartbeatAt || null,
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

  private async findDuplicate(input: {
    mode: string;
    instanceId?: string | null;
    idempotencyKey?: string | null;
    audioHash?: string;
    model?: string;
    language?: string | null;
  }) {
    const jobs = this.prismaRepository.transcriptionJob as any;
    const reusableStatuses = { in: ['queued', 'processing', 'completed'] };
    if (input.idempotencyKey) {
      const byKey = await jobs.findFirst({
        where: {
          mode: input.mode,
          instanceId: input.instanceId || null,
          idempotencyKey: input.idempotencyKey,
          status: reusableStatuses,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (byKey) return byKey;
    }
    if (input.audioHash) {
      return jobs.findFirst({
        where: {
          mode: input.mode,
          instanceId: input.instanceId || null,
          audioHash: input.audioHash,
          model: input.model,
          language: input.language || null,
          status: reusableStatuses,
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return null;
  }

  private async ready(mode = 'transcription') {
    await this.init();
    if (!this.channel || !this.resultChannel) {
      throw new TranscriptionServiceError('A fila de transcrição está temporariamente indisponível.', 503);
    }

    let modelStatus = await this.modelDownloadStatus();
    if (!modelStatus.installed && modelStatus.available) {
      try {
        modelStatus = await this.downloadModel(modelStatus.id);
      } catch (error: any) {
        this.logger.warn(
          'Não foi possível iniciar o download persistente do modelo de voz: ' + (error?.message || error),
        );
        throw new TranscriptionServiceError(
          'O modelo de voz ainda não está instalado e o download automático não pôde ser iniciado. Verifique o volume persistente de modelos no Compose.',
          503,
        );
      }
      if (!modelStatus.installed) {
        throw new TranscriptionServiceError(
          'O download do modelo de voz foi iniciado. Acompanhe o progresso em Gerenciador > Transcrição de áudio e envie o áudio novamente quando o modelo estiver pronto.',
          503,
        );
      }
    }

    const queue = queueFor(mode);
    try {
      const state = await this.channel.checkQueue(queue);
      if (!Number(state?.consumerCount)) {
        throw new TranscriptionServiceError(
          mode === 'dictation'
            ? 'O worker de ditado não está ativo. Verifique o serviço speech-dictation-worker no Compose.'
            : 'O worker local de transcrição não está ativo. Verifique o serviço transcription-worker no Compose.',
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
    const queues = [
      { mode: 'transcription', queue: queueFor('transcription') },
      { mode: 'dictation', queue: queueFor('dictation') },
    ];

    const connection = await amqp.connect(uri);
    this.connection = connection;
    connection.on('error', (error) => this.logger.warn('RabbitMQ transcription: ' + (error?.message || error)));
    connection.on('close', () => {
      if (this.connection !== connection) return;
      this.channel = null;
      this.resultChannel = null;
      this.connection = null;
      this.scheduleReconnect();
    });

    const channel = await connection.createConfirmChannel();
    if (this.connection !== connection) {
      await channel.close().catch(() => {});
      return;
    }
    this.channel = channel;
    channel.on('error', (error) => this.logger.warn('RabbitMQ transcription channel: ' + (error?.message || error)));
    channel.on('close', () => {
      this.handleChannelClose(channel, connection);
    });

    try {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      for (const item of queues) {
        const resultQueue = item.queue + '.results';
        const prefix = resultRoutingPrefix(item.mode);
        await channel.assertQueue(item.queue, {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
            ...(item.mode === 'dictation' ? { 'x-message-ttl': dictationAudioRetentionMs() } : {}),
          },
        });
        await channel.bindQueue(item.queue, exchange, requestRoutingKey(item.mode));
        await channel.assertQueue(resultQueue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
        for (const status of ['processing', 'completed', 'failed', 'cancelled']) {
          await channel.bindQueue(resultQueue, exchange, prefix + status);
        }
      }

      // Keep consumer delivery tags on a dedicated channel. This prevents
      // publishing confirmations and result ACKs from sharing channel state.
      const resultChannel = await connection.createChannel();
      if (this.connection !== connection || this.channel !== channel) {
        await resultChannel.close().catch(() => {});
        return;
      }
      this.resultChannel = resultChannel;
      resultChannel.on('error', (error) =>
        this.logger.warn('RabbitMQ transcription result channel: ' + (error?.message || error)),
      );
      resultChannel.on('close', () => this.handleChannelClose(resultChannel, connection));
      await resultChannel.prefetch(20);
      for (const item of queues) {
        const resultQueue = item.queue + '.results';
        await resultChannel.consume(
          resultQueue,
          (message) => {
            if (message) void this.consumeResult(message, resultChannel);
          },
          { noAck: false },
        );
      }
      if (this.channel !== channel || this.resultChannel !== resultChannel) return;
      this.logger.info('Speech queues - ON (' + queues.map((item) => item.queue).join(', ') + ')');
      // Recover abandoned jobs as soon as a real worker consumer is present;
      // waiting for the periodic timer would leave old `processing` rows visible
      // in the Manager for another full interval after a deploy.
      void this.recoverStaleJobs();
    } catch (error) {
      if (this.channel === channel) this.channel = null;
      const resultChannel = this.resultChannel;
      this.resultChannel = null;
      if (this.connection === connection) this.connection = null;
      try {
        await resultChannel?.close();
      } catch {
        // Connection teardown below also releases this channel.
      }
      try {
        await channel.close();
      } catch {
        // Connection teardown below also releases this channel.
      }
      try {
        await connection.close();
      } catch {
        // Preserve the setup error while best-effort cleanup completes.
      }
      throw error;
    }
  }

  private handleChannelClose(channel: any, connection: any) {
    if (this.connection !== connection || (this.channel !== channel && this.resultChannel !== channel)) return;
    this.channel = null;
    this.resultChannel = null;
    this.connection = null;
    void connection.close().catch(() => {});
    this.scheduleReconnect();
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
            priority: routingKey === DICTATION_REQUESTED ? 10 : 1,
          },
          (error: Error | null) => (error ? reject(error) : resolve()),
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  private acknowledgeResult(channel: any, message: any): boolean {
    if (!channel || channel !== this.resultChannel || !message || typeof message !== 'object') return false;
    if (this.settledResultMessages.has(message)) return false;
    try {
      channel.ack(message);
      this.settledResultMessages.add(message);
      return true;
    } catch (error) {
      this.logger.warn('Não foi possível confirmar resultado de voz: ' + (error?.message || error));
      void channel.close().catch(() => {});
      return false;
    }
  }

  private rejectResult(channel: any, message: any, requeue: boolean): boolean {
    if (!channel || channel !== this.resultChannel || !message || typeof message !== 'object') return false;
    if (this.settledResultMessages.has(message)) return false;
    try {
      channel.nack(message, false, requeue);
      this.settledResultMessages.add(message);
      return true;
    } catch (error) {
      this.logger.warn('Não foi possível devolver resultado de voz à fila: ' + (error?.message || error));
      void channel.close().catch(() => {});
      return false;
    }
  }

  private async consumeResult(message: any, channel: any) {
    if (!channel || channel !== this.resultChannel) return;
    let payload: WorkerResult;
    try {
      payload = JSON.parse(message.content.toString('utf8')) as WorkerResult;
    } catch (error) {
      this.logger.error('Resultado de transcrição malformado: ' + (error?.message || error));
      this.rejectResult(channel, message, false);
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.logger.error('Resultado de transcrição malformado: payload não é um objeto.');
      this.rejectResult(channel, message, false);
      return;
    }
    try {
      const jobId = String(payload.jobId || '').trim();
      if (!jobId) {
        this.acknowledgeResult(channel, message);
        return;
      }
      const status = ['processing', 'completed', 'failed', 'cancelled'].includes(String(payload.status))
        ? String(payload.status)
        : 'failed';
      const data: any = { status, updatedAt: new Date() };
      data.stage =
        status === 'completed' || status === 'failed'
          ? status
          : String(payload.stage || status)
              .trim()
              .slice(0, 32);
      if (Number.isFinite(Number(payload.progressPercent))) {
        data.progressPercent = Math.max(
          0,
          Math.min(status === 'completed' ? 100 : 99, Math.floor(Number(payload.progressPercent))),
        );
      }
      if (Number.isFinite(Number(payload.processedDurationMs))) {
        data.processedDurationMs = Math.max(0, Math.floor(Number(payload.processedDurationMs)));
      }
      data.heartbeatAt = payload.heartbeatAt ? new Date(payload.heartbeatAt) : new Date();
      if (typeof payload.partialText === 'string') data.text = payload.partialText.slice(0, 100_000);
      if (status === 'processing') {
        const current = await (this.prismaRepository.transcriptionJob as any).findUnique({
          where: { id: jobId },
          select: { startedAt: true },
        });
        if (!current) {
          this.acknowledgeResult(channel, message);
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
      } else if (status === 'cancelled') {
        data.stage = 'cancelled';
        data.completedAt = new Date();
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
          this.acknowledgeResult(channel, message);
          return;
        }
        updateWhere = { id: jobId, status: { in: ['queued', 'processing'] }, attempts: currentAttempts };
      } else {
        updateWhere = { id: jobId, attempts, status: { in: ['queued', 'processing'] } };
      }
      const jobs = this.prismaRepository.transcriptionJob as any;
      const updated = await jobs.updateMany({ where: updateWhere, data });
      let updatedCount = Number(updated?.count || 0);
      if (!updatedCount && attempts !== null && attempts > 1) {
        // The delayed retry carries the next attempt. Advance the durable
        // counter only when its first event arrives, with a compare-and-swap
        // against the preceding retrying state.
        const resumed = await jobs.updateMany({
          where: { id: jobId, attempts: attempts - 1, status: 'processing', stage: 'retrying' },
          data: { ...data, attempts },
        });
        updatedCount = Number(resumed?.count || 0);
      }
      if (!updatedCount) {
        // The job may have been deliberately removed, or this is a late result
        // from an older retry attempt. It must not poison the durable queue.
        this.logger.debug('Resultado de transcrição ignorado para job ausente ou tentativa antiga: ' + jobId);
      }
      this.acknowledgeResult(channel, message);
    } catch (error) {
      if (channel !== this.resultChannel) return;
      this.logger.error('Falha ao persistir resultado de transcrição: ' + (error?.message || error));
      // A database outage is transient: closing the consumer channel returns
      // the unacknowledged result to RabbitMQ after the reconnect backoff.
      this.handleChannelClose(channel, this.connection);
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
      if (!['completed', 'failed', 'cancelled'].includes(String(job.status))) continue;
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
    let jobsRetained = 0;
    for (const sourceKey of candidates) {
      if (await deleteStoredFile(sourceKey)) {
        removed += 1;
        freedBytes += objectBySourceKey.get(sourceKey)?.size || 0;
        jobsRetained += (expiredJobIdsBySource.get(sourceKey) || []).length;
      } else {
        failed += 1;
      }
    }

    return {
      status: failed ? 'partial' : 'completed',
      retentionSeconds,
      cutoff: new Date(cutoff).toISOString(),
      candidates: candidates.length,
      removed,
      failed,
      freedBytes,
      jobsRemoved: 0,
      jobsRetained,
    };
  }

  private isOwnedUploadKey(value: unknown): boolean {
    const key = String(value || '').trim();
    return key.startsWith(TRANSCRIPTION_SOURCE_PREFIX) && !key.includes('..');
  }

  private sourceRetentionSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_SOURCE_RETENTION_SECONDS || '', 10);
    if (!Number.isFinite(value)) {
      const days = Number.parseInt(process.env.TRANSCRIPTION_AUDIO_RETENTION_DAYS || '30', 10);
      return Math.min(Math.max(Number.isFinite(days) ? days : 30, 0), 365) * 86_400;
    }
    return Math.min(Math.max(value, 0), 31_536_000);
  }

  private sourceCleanupIntervalSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_SOURCE_CLEANUP_INTERVAL_SECONDS || '', 10);
    if (!Number.isFinite(value)) return 900;
    return Math.min(Math.max(value, 60), 86_400);
  }

  private staleJobSeconds(): number {
    const value = Number.parseInt(
      process.env.SPEECH_JOB_STALE_AFTER || process.env.TRANSCRIPTION_STALE_JOB_SECONDS || '',
      10,
    );
    if (!Number.isFinite(value)) return 120;
    return Math.min(Math.max(value, 60), 86_400);
  }

  private staleRecoveryIntervalSeconds(): number {
    const value = Number.parseInt(process.env.TRANSCRIPTION_STALE_RECOVERY_INTERVAL_SECONDS || '', 10);
    if (!Number.isFinite(value)) return 60;
    return Math.min(Math.max(value, 30), 3600);
  }

  private maxAttempts(): number {
    const value = Number.parseInt(process.env.SPEECH_MAX_ATTEMPTS || '', 10);
    return Number.isFinite(value) ? Math.min(Math.max(value, 1), 10) : 3;
  }

  private isStaleJob(job: any): boolean {
    if (String(job?.status) !== 'processing') return false;
    const updatedAt = new Date(job?.updatedAt || job?.heartbeatAt || job?.createdAt || 0).getTime();
    const retryDelay =
      String(job?.stage) === 'retrying'
        ? RETRY_DELAYS_MS[Math.min(RETRY_DELAYS_MS.length - 1, Math.max(0, Number(job?.attempts || 1) - 1))]
        : 0;
    return Number.isFinite(updatedAt) && Date.now() - updatedAt >= retryDelay + this.staleJobSeconds() * 1000;
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
      const cutoff = new Date(Date.now() - this.staleJobSeconds() * 1000);
      for (const mode of ['transcription', 'dictation']) {
        const state = await this.channel.checkQueue(queueFor(mode));
        if (mode === 'dictation' && Number(state?.messageCount || 0) === 0) {
          const expiredCutoff = new Date(Date.now() - dictationAudioRetentionMs() - 60_000);
          const expired = await (this.prismaRepository.transcriptionJob as any).findMany({
            where: { mode, status: 'queued', createdAt: { lt: expiredCutoff } },
            select: { id: true, attempts: true, createdAt: true },
            take: 100,
          });
          for (const job of expired) {
            await (this.prismaRepository.transcriptionJob as any).updateMany({
              where: { id: job.id, mode, status: 'queued', attempts: job.attempts, createdAt: job.createdAt },
              data: {
                status: 'failed',
                stage: 'failed',
                errorCode: 'DICTATION_AUDIO_EXPIRED',
                errorMessage: 'O áudio do ditado expirou antes de ser processado.',
                completedAt: new Date(),
              },
            });
          }
        }
        if (!Number(state?.consumerCount)) continue;
        // A queued database row may already be prefetched by RabbitMQ. Queue
        // messageCount excludes unacked messages, so only stale processing
        // heartbeats are recovered; queued rows stay on RabbitMQ's delivery path.
        const jobs = await (this.prismaRepository.transcriptionJob as any).findMany({
          where: { mode, status: 'processing', updatedAt: { lt: cutoff } },
          orderBy: { updatedAt: 'asc' },
          take: 100,
        });
        for (const job of jobs) {
          if (!this.isStaleJob(job)) continue;
          if (Number(job.attempts || 0) >= this.maxAttempts()) {
            await (this.prismaRepository.transcriptionJob as any).updateMany({
              where: { id: job.id, status: 'processing', updatedAt: job.updatedAt },
              data: {
                status: 'failed',
                stage: 'failed',
                errorCode: 'WORKER_HEARTBEAT_EXPIRED',
                errorMessage: 'O worker deixou de enviar heartbeat após o limite de tentativas.',
                completedAt: new Date(),
              },
            });
            continue;
          }
          const changed = await (this.prismaRepository.transcriptionJob as any).updateMany({
            where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
            data: {
              status: 'queued',
              stage: 'queued',
              progressPercent: 0,
              processedDurationMs: 0,
              heartbeatAt: null,
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
            await this.publish(requestRoutingKey(String(updated.mode || mode)), this.jobPayload(updated));
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
          `Transcrição: limpeza removeu ${result.removed} objeto(s) e ${result.jobsRemoved} resultado(s); falhas=${result.failed}.`,
        );
      }
    } catch (error) {
      this.logger.warn('Transcrição: limpeza de áudios temporários indisponível: ' + (error?.message || error));
    } finally {
      this.sourceCleanupInFlight = false;
    }
  }
}
