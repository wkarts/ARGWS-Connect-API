'use strict';

const { randomUUID } = require('node:crypto');

class SpeechControlClient {
  constructor(config, workerId) {
    this.config = config;
    this.workerId = workerId;
    this.pending = new Map();
  }

  async connect(connection) {
    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    channel.on('error', () => {});
    channel.on('close', () => {
      if (this.channel === channel) this.channel = null;
      this.rejectAll(Object.assign(new Error('Canal de autoridade durável fechado.'), { code: 'CONTROL_UNAVAILABLE', retryable: true }));
    });
    channel.on('return', (message) => {
      const pending = this.pending.get(message.properties?.correlationId);
      pending?.reject(Object.assign(new Error('Nenhuma API recebe o controle durável do pool.'), { code: 'CONTROL_UNROUTABLE', retryable: true }));
    });
    const queue = await channel.assertQueue('', { exclusive: true, autoDelete: true, arguments: {
      'x-max-length': 100, 'x-max-length-bytes': 4 * 1024 * 1024,
      'x-message-ttl': 30000,
    } });
    this.replyQueue = queue.queue;
    await channel.consume(queue.queue, (message) => {
      if (!message) return;
      const pending = this.pending.get(message.properties?.correlationId);
      try {
        if (message.content.length > 1024 * 1024) throw new Error('Resposta de controle excessiva.');
        const reply = JSON.parse(message.content.toString('utf8'));
        pending?.resolve(reply);
      } catch (error) { pending?.reject(Object.assign(error, { code: 'CONTROL_INVALID_REPLY' })); }
      finally { channel.ack(message); }
    }, { noAck: false });
  }

  request(action, job = {}, data = {}) {
    const channel = this.channel;
    if (!channel) return Promise.reject(Object.assign(new Error('Autoridade durável indisponível.'), { code: 'CONTROL_UNAVAILABLE', retryable: true }));
    const correlationId = randomUUID();
    const body = Buffer.from(JSON.stringify({
      ...data, version: 2, action, poolId: this.config.poolId || this.config.rabbitmq.exchange,
      workerId: this.workerId, jobId: job.jobId, generation: job.generation,
      executionId: job.executionId, instanceId: job.instanceId,
    }));
    if (body.length > 300 * 1024) return Promise.reject(Object.assign(new Error('Controle de voz excessivo.'), { code: 'CONTROL_TOO_LARGE' }));
    return new Promise((resolve, reject) => {
      const settle = (callback, value) => {
        const pending = this.pending.get(correlationId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(correlationId);
        callback(value);
      };
      const timer = setTimeout(() => settle(reject, Object.assign(new Error('A autoridade durável não respondeu dentro do prazo.'), {
        code: 'CONTROL_TIMEOUT', retryable: true,
      })), this.config.controlTimeoutMs || 10000);
      timer.unref?.();
      this.pending.set(correlationId, { timer, resolve: (value) => settle(resolve, value), reject: (error) => settle(reject, error) });
      try {
        channel.publish(this.config.rabbitmq.exchange, this.config.controlRoutingKey || 'speech.control.v2', body, {
          mandatory: true, persistent: false, contentType: 'application/json', correlationId,
          replyTo: this.replyQueue, expiration: String(this.config.controlTimeoutMs || 10000),
        }, (error) => { if (error) this.pending.get(correlationId)?.reject(error); });
      } catch (error) { this.pending.get(correlationId)?.reject(error); }
    });
  }

  rejectAll(error) { for (const pending of this.pending.values()) pending.reject(error); }
  async close() { await this.channel?.close().catch(() => {}); }
}

module.exports = { SpeechControlClient };
