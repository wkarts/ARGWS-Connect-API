import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import * as amqp from 'amqplib';

const REQUESTED = 'transcription.requested';
const PROCESSING = 'transcription.processing';
const COMPLETED = 'transcription.completed';
const FAILED = 'transcription.failed';

type EnqueueInput = {
  messageId: string;
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

function enabledValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return truthy.has(String(value).trim().toLowerCase());
}

function normalizedQueue(value: unknown): string {
  const queue = String(value || 'argws-connect.transcription').trim();
  return queue || 'argws-connect.transcription';
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
  const model = String(value || process.env.TRANSCRIPTION_OPENAI_MODEL || 'whisper-1').trim();
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(model)) {
    throw new TranscriptionServiceError('model inválido.', 400);
  }
  return model;
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
 * The API owns the durable job state. The dedicated worker only reads private
 * MinIO objects and publishes status/results through RabbitMQ.
 */
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private connection: any = null;
  private channel: any = null;
  private initializing: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prismaRepository: PrismaRepository) {}

  public isEnabled(): boolean {
    return enabledValue(process.env.TRANSCRIPTION_ENABLED, false);
  }

  public async init(): Promise<void> {
    if (!this.isEnabled() || !enabledValue(process.env.RABBITMQ_ENABLED, true)) return;
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

  public async enqueue(input: EnqueueInput) {
    if (!this.isEnabled()) {
      throw new TranscriptionServiceError('A transcrição assíncrona está desabilitada nesta instalação.', 409);
    }

    const messageId = String(input?.messageId || '').trim();
    if (!messageId || messageId.length > 128) {
      throw new TranscriptionServiceError('Informe um messageId válido.', 400);
    }

    const media = await (this.prismaRepository.media as any).findUnique({
      where: { messageId },
      select: {
        fileName: true,
        mimetype: true,
        instanceId: true,
        Message: { select: { id: true } },
      },
    });

    if (!media) throw new TranscriptionServiceError('A mídia da mensagem não foi encontrada.', 404);
    const mimetype = String(media.mimetype || '')
      .trim()
      .toLowerCase();
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
    const job = await (this.prismaRepository.transcriptionJob as any).create({
      data: {
        instanceId: media.instanceId,
        messageId,
        sourceKey: String(media.fileName),
        sourceMimeType: mimetype,
        provider: String(process.env.TRANSCRIPTION_PROVIDER || 'openai')
          .trim()
          .toLowerCase(),
        model,
        language,
        status: 'queued',
        attempts: 1,
      },
    });

    try {
      await this.publish(REQUESTED, {
        jobId: job.id,
        messageId,
        instanceId: media.instanceId,
        source: { key: String(media.fileName), mimeType: mimetype },
        language,
        model,
      });
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
      throw new TranscriptionServiceError('Não foi possível publicar o job para o worker.', 503);
    }

    return this.publicJob(job);
  }

  public async get(jobId: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);
    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    return this.publicJob(job);
  }

  public async retry(jobId: string) {
    const id = String(jobId || '').trim();
    if (!id || id.length > 128) throw new TranscriptionServiceError('ID de job inválido.', 400);
    const job = await (this.prismaRepository.transcriptionJob as any).findUnique({ where: { id } });
    if (!job) throw new TranscriptionServiceError('Job de transcrição não encontrado.', 404);
    if (job.status !== 'failed') {
      throw new TranscriptionServiceError('Somente jobs com falha podem ser reenfileirados.', 409);
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
      await this.publish(REQUESTED, {
        jobId: updated.id,
        messageId: updated.messageId,
        instanceId: updated.instanceId,
        source: { key: updated.sourceKey, mimeType: updated.sourceMimeType },
        language: updated.language,
        model: updated.model,
      });
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
    for (const key of [PROCESSING, COMPLETED, FAILED]) {
      await this.channel.bindQueue(resultQueue, exchange, key);
    }
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
      if (status === 'processing') {
        data.startedAt = new Date();
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
}
