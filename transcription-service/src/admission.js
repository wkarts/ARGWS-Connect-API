'use strict';

const amqp = require('amqplib');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bounded(operation, code, timeoutMs = 5000, isCancelled) {
  let timer;
  let cancellationTimer;
  try {
    const candidates = [operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), timeoutMs);
    })];
    if (isCancelled) candidates.push(new Promise((_, reject) => {
      const check = () => { if (isCancelled()) reject(Object.assign(new Error('Admission cancelled'), { code: 'CANCELLED' })); };
      cancellationTimer = setInterval(check, 100);
      check();
    }));
    return await Promise.race(candidates);
  } finally { clearTimeout(timer); clearInterval(cancellationTimer); }
}

async function closeAfterReleaseFailure(connection, isClosed = () => false) {
  if (isClosed()) return;
  try { await bounded(connection.close(), 'RESIDENCY_CONNECTION_CLOSE_TIMEOUT'); }
  catch (error) {
    if (isClosed()) return;
    // amqplib exposes the underlying connection stream. Destroy only after the
    // caller has stopped native inference; a half-open broker cannot retain an
    // exclusive queue indefinitely while the coordinator reports it returned.
    const stream = connection.connection?.stream;
    if (!stream?.destroy) throw error;
    let closed;
    const closure = new Promise((resolve) => { closed = resolve; connection.once('close', closed); });
    try {
      stream.destroy();
      await bounded(closure, 'RESIDENCY_CONNECTION_CLOSE_UNCONFIRMED', 1000);
    } finally { connection.removeListener('close', closed); }
  }
}

// Reuse one broker connection while waiting. RESOURCE_LOCKED closes only the
// attempt channel; never create a new AMQP connection every 750 ms per job.
async function acquire(config, isCancelled, onLost = () => {}, connectionOrConnect = amqp.connect, onWaiting = () => {}) {
  const shared = typeof connectionOrConnect !== 'function';
  const connection = shared ? connectionOrConnect : await connectionOrConnect(config.rabbitmq.uri, { timeout: 5000, keepAlive: true });
  let released = false;
  let acquired = false;
  let connectionClosed = false;
  const lost = () => { connectionClosed = true; if (acquired && !released) onLost(); };
  const ignoreConnectionError = () => {};
  const removeListeners = () => {
    connection.removeListener?.('error', ignoreConnectionError);
    connection.removeListener?.('close', lost);
  };
  connection.on('error', ignoreConnectionError);
  connection.on('close', lost);
  const slots = config.globalConcurrency || 1;
  const namespace = String(config.poolId || config.rabbitmq.exchange).replace(/[^a-zA-Z0-9._-]/g, '_');
  let rounds = 0;
  const request = async (operation, code) => {
    try { return await bounded(operation, code, 5000, isCancelled); }
    catch (error) {
      if (error.code === code || error.code === 'CANCELLED') {
        // A timed-out assertion may have been granted by the broker. Closing
        // this acquisition connection makes that unknown outcome harmless; a
        // late RPC can neither retain a hidden queue nor admit another model.
        await closeAfterReleaseFailure(connection, () => connectionClosed);
      }
      throw error;
    }
  };
  try {
    while (!isCancelled()) {
      for (let slot = 0; slot < slots; slot += 1) {
        if (isCancelled()) break;
        const channel = await request(connection.createChannel(), 'RESIDENCY_CHANNEL_OPEN_TIMEOUT');
        channel.on?.('error', () => {});
        try {
          const queue = `speech.residency.v2.${namespace}.${slot}`;
          await request(channel.assertQueue(queue, { durable: false, exclusive: true, autoDelete: false }), 'RESIDENCY_ACQUIRE_TIMEOUT');
          if (isCancelled()) {
            try {
              await bounded(channel.deleteQueue?.(queue), 'RESIDENCY_RELEASE_TIMEOUT');
              await bounded(channel.close?.(), 'RESIDENCY_CHANNEL_CLOSE_TIMEOUT');
            } catch { await closeAfterReleaseFailure(connection, () => connectionClosed); }
            break;
          }
          acquired = true;
          let releaseTask;
          return { slot, release: () => {
            if (releaseTask) return releaseTask;
            released = true;
            releaseTask = (async () => {
              try {
                await bounded(channel.deleteQueue?.(queue), 'RESIDENCY_RELEASE_TIMEOUT');
                await bounded(channel.close?.(), 'RESIDENCY_CHANNEL_CLOSE_TIMEOUT');
              } catch {
                // A persistent shared connection must not keep a failed-to-delete
                // slot hidden forever. Closing it is a real failure recovery.
                await closeAfterReleaseFailure(connection, () => connectionClosed);
              } finally {
                try { if (!shared) await closeAfterReleaseFailure(connection, () => connectionClosed); }
                finally { removeListeners(); }
              }
            })();
            return releaseTask;
          } };
        } catch (error) {
          // RabbitMQ closes the attempt channel when it replies 405. amqplib
          // has already released that channel; calling close() again rejects
          // with "Channel closed". Contention must keep the shared socket alive
          // so the owner can receive the demand hint and hand the slot over.
          if (error?.code === 405) continue;
          if (!connectionClosed) {
            try { await bounded(channel.close?.(), 'RESIDENCY_CHANNEL_CLOSE_TIMEOUT'); }
            catch { await closeAfterReleaseFailure(connection, () => connectionClosed); }
          }
          throw error;
        }
      }
      // Demand notifications are hints only. The exclusive queue remains the
      // authority, including when an older worker does not understand the hint.
      if (!isCancelled()) await onWaiting();
      // Long-lived standby coordinators create no native model and no hot loop.
      const waitMs = Math.min(5000, (config.admissionRetryMs || 500) * 2 ** Math.min(rounds++, 4));
      const until = Date.now() + waitMs;
      while (!isCancelled() && Date.now() < until) await delay(Math.min(100, until - Date.now()));
    }
    throw Object.assign(new Error('Reserva de residência cancelada.'), { code: 'CANCELLED' });
  } catch (error) {
    try { if (!shared) await closeAfterReleaseFailure(connection, () => connectionClosed); }
    finally { removeListeners(); }
    throw error;
  }
}

module.exports = { acquire };
