'use strict';

const amqp = require('amqplib');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An exclusive queue has one owner connection and disappears on connection
// loss. Its name is stable across replicas and both speech modes.
async function acquire(config, isCancelled, onLost = () => {}, connect = amqp.connect) {
  const slots = config.globalConcurrency || 1;
  const namespace = String(config.rabbitmq.exchange).replace(/[^a-zA-Z0-9._-]/g, '_');
  while (!isCancelled()) {
    for (let slot = 0; slot < slots; slot += 1) {
      if (isCancelled()) break;
      let connection;
      let owned = false;
      try {
        connection = await connect(config.rabbitmq.uri);
        const channel = await connection.createChannel();
        await channel.assertQueue(`speech.admission.${namespace}.${slot}`, {
          durable: false, exclusive: true, autoDelete: true,
        });
        owned = true;
        connection.on('close', () => { if (owned) onLost(); });
        if (isCancelled()) {
          owned = false;
          break;
        }
        return {
          slot,
          release: async () => {
            owned = false;
            await connection.close().catch(() => {});
          },
        };
      } catch (error) {
        // 405: the slot is held by another connection. All other errors must
        // propagate so that the job follows the configured retry policy.
        if (error?.code !== 405 && !/RESOURCE_LOCKED/.test(String(error?.message))) throw error;
      } finally {
        if (!owned) await connection?.close().catch(() => {});
      }
    }
    await delay(750);
  }
  throw Object.assign(new Error('Aguardando encerramento ou cancelamento.'), { code: 'CANCELLED' });
}

module.exports = { acquire };
