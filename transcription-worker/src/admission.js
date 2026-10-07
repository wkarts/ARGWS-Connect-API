'use strict';

const amqp = require('amqplib');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reuse one broker connection while waiting. RESOURCE_LOCKED closes only the
// attempt channel; never create a new AMQP connection every 750 ms per job.
async function acquire(config, isCancelled, onLost = () => {}, connectionOrConnect = amqp.connect) {
  const shared = typeof connectionOrConnect !== 'function';
  const connection = shared ? connectionOrConnect : await connectionOrConnect(config.rabbitmq.uri, { timeout: 5000, keepAlive: true });
  let released = false;
  let acquired = false;
  const lost = () => { if (acquired && !released) onLost(); };
  connection.on('error', () => {});
  connection.on('close', lost);
  const slots = config.globalConcurrency || 1;
  const namespace = String(config.poolId || config.rabbitmq.exchange).replace(/[^a-zA-Z0-9._-]/g, '_');
  let rounds = 0;
  try {
    while (!isCancelled()) {
      for (let slot = 0; slot < slots; slot += 1) {
        if (isCancelled()) break;
        const channel = await connection.createChannel();
        channel.on?.('error', () => {});
        try {
          const queue = `speech.residency.v2.${namespace}.${slot}`;
          await channel.assertQueue(queue, { durable: false, exclusive: true, autoDelete: false });
          if (isCancelled()) { await channel.deleteQueue?.(queue).catch(() => {}); break; }
          acquired = true;
          return { slot, release: async () => {
            released = true;
            connection.removeListener?.('close', lost);
            await channel.deleteQueue?.(queue).catch(() => {});
            await channel.close?.().catch(() => {});
            if (!shared) await connection.close().catch(() => {});
          } };
        } catch (error) {
          await channel.close?.().catch(() => {});
          if (error?.code !== 405 && !/RESOURCE_LOCKED/.test(String(error?.message))) throw error;
        }
      }
      // Long-lived standby coordinators create no native model and no hot loop.
      const waitMs = Math.min(5000, (config.admissionRetryMs || 500) * 2 ** Math.min(rounds++, 4));
      const until = Date.now() + waitMs;
      while (!isCancelled() && Date.now() < until) await delay(Math.min(100, until - Date.now()));
    }
    throw Object.assign(new Error('Reserva de residência cancelada.'), { code: 'CANCELLED' });
  } catch (error) {
    connection.removeListener?.('close', lost);
    if (!shared) await connection.close().catch(() => {});
    throw error;
  }
}

module.exports = { acquire };
