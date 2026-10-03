'use strict';

const fs = require('node:fs');
const amqp = require('amqplib');
const { createClient, downloadObjectToFile, cleanup } = require('./storage');
const { createProvider } = require('./provider');

const REQUESTED = 'transcription.requested';
const PROCESSING = 'transcription.processing';
const COMPLETED = 'transcription.completed';
const FAILED = 'transcription.failed';

function normalizeJob(value) {
  if (!value || typeof value !== 'object') throw new Error('Mensagem de transcrição inválida.');
  const jobId = String(value.jobId || '').trim();
  const source = value.source && typeof value.source === 'object' ? value.source : {};
  const sourceKey = String(source.key || '').trim();
  const sourceMimeType = String(source.mimeType || '').trim().toLowerCase();
  if (!jobId || jobId.length > 128) throw new Error('jobId inválido.');
  if (!sourceKey || !sourceMimeType.startsWith('audio/')) throw new Error('Origem de áudio inválida.');
  return {
    jobId,
    messageId: value.messageId ? String(value.messageId) : null,
    instanceId: value.instanceId ? String(value.instanceId) : null,
    sourceKey,
    sourceMimeType,
    language: value.language ? String(value.language) : null,
    model: value.model ? String(value.model) : null,
  };
}

class TranscriptionWorker {
  constructor(config) {
    this.config = config;
    this.connection = null;
    this.channel = null;
    this.client = createClient(config.s3);
    this.provider = createProvider(config);
    this.stopping = false;
    this.reconnectTimer = null;
  }

  async start() {
    fs.writeFileSync('/tmp/transcription-worker.ready', 'ready');
    if (!this.config.enabled) {
      console.log('Transcription worker desabilitado; aguardando ativação por ambiente.');
      await new Promise(() => {});
      return;
    }
    await this.connect();
  }

  async connect() {
    if (this.stopping) return;
    this.connection = await amqp.connect(this.config.rabbitmq.uri);
    this.connection.on('error', (error) => console.error('RabbitMQ transcription error:', error.message));
    this.connection.on('close', () => {
      this.channel = null;
      this.connection = null;
      if (!this.stopping && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect().catch((error) => {
            console.error('Falha ao reconectar o worker:', error.message);
            this.scheduleReconnect();
          });
        }, 5000);
      }
    });
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.config.rabbitmq.exchange, 'topic', { durable: true });
    await this.channel.assertQueue(this.config.queue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await this.channel.bindQueue(this.config.queue, this.config.rabbitmq.exchange, REQUESTED);
    await this.channel.prefetch(this.config.concurrency);
    await this.channel.consume(this.config.queue, (message) => {
      if (message) void this.handle(message);
    }, { noAck: false });
    console.log('Transcription worker conectado ao RabbitMQ na fila ' + this.config.queue + '.');
  }

  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        console.error('Falha ao reconectar o worker:', error.message);
        this.scheduleReconnect();
      });
    }, 5000);
  }

  async publish(status, payload) {
    const routingKey = 'transcription.' + status;
    const message = Buffer.from(JSON.stringify({
      ...payload,
      status,
      updatedAt: new Date().toISOString(),
    }));
    const accepted = this.channel.publish(
      this.config.rabbitmq.exchange,
      routingKey,
      message,
      { persistent: true, contentType: 'application/json', messageId: payload.jobId },
    );
    if (!accepted) await new Promise((resolve) => this.channel.once('drain', resolve));
  }

  async handle(message) {
    let job;
    try {
      job = normalizeJob(JSON.parse(message.content.toString('utf8')));
    } catch (error) {
      console.error('Mensagem de transcrição descartada:', error.message);
      this.channel.ack(message);
      return;
    }

    try {
      await this.publish('processing', { jobId: job.jobId, messageId: job.messageId, instanceId: job.instanceId });
      const downloaded = await downloadObjectToFile(
        this.client,
        this.config.s3.bucket,
        job.sourceKey,
        job.sourceMimeType,
        this.config.maxAudioBytes,
      );
      try {
        const result = await this.provider.transcribe(downloaded.filePath, {
          language: job.language,
          model: job.model,
        });
        await this.publish('completed', {
          jobId: job.jobId,
          messageId: job.messageId,
          instanceId: job.instanceId,
          provider: this.config.provider,
          model: job.model || this.config.openai.model,
          ...result,
        });
      } finally {
        await cleanup(downloaded.directory);
      }
      this.channel.ack(message);
    } catch (error) {
      const errorMessage = String(error?.message || error).slice(0, 2000);
      console.error('Transcrição falhou:', errorMessage);
      try {
        await this.publish('failed', {
          jobId: job.jobId,
          messageId: job.messageId,
          instanceId: job.instanceId,
          provider: this.config.provider,
          model: job.model || this.config.openai.model,
          errorCode: error?.code ? String(error.code).slice(0, 64) : 'TRANSCRIPTION_FAILED',
          errorMessage,
        });
        this.channel.ack(message);
      } catch (publishError) {
        console.error('Não foi possível publicar a falha da transcrição:', publishError.message);
        this.channel.nack(message, false, true);
      }
    }
  }

  async stop() {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
}

module.exports = {
  TranscriptionWorker,
  normalizeJob,
  REQUESTED,
  PROCESSING,
  COMPLETED,
  FAILED,
};
