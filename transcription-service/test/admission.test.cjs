'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { acquire } = require('../src/admission');

test('transcrição e ditado compartilham uma vaga e a liberam no encerramento', async () => {
  const owners = new Map();
  const connect = async () => {
    const connection = new EventEmitter();
    connection.close = async () => {
      for (const [name, owner] of owners) if (owner === connection) owners.delete(name);
      connection.emit('close');
    };
    connection.createChannel = async () => ({
      assertQueue: async (name) => {
        if (owners.has(name)) throw Object.assign(new Error('RESOURCE_LOCKED'), { code: 405 });
        owners.set(name, connection);
      },
    });
    return connection;
  };
  const config = { rabbitmq: { uri: 'amqp://test', exchange: 'speech' }, globalConcurrency: 1 };
  const transcription = await acquire(config, () => false, () => {}, connect);
  let dictationAdmitted = false;
  const waiting = acquire(config, () => false, () => {}, connect).then((lease) => {
    dictationAdmitted = true;
    return lease;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dictationAdmitted, false);
  await transcription.release();
  const dictation = await waiting;
  assert.equal(dictationAdmitted, true);
  assert.equal(dictation.slot, 0);
  await dictation.release();
  assert.equal(owners.size, 0);
});

function sharedBroker(overrides = {}) {
  const connection = new EventEmitter();
  const calls = { declared: 0, deleted: 0, closed: 0, disconnected: 0 };
  const createChannel = () => Object.assign(new EventEmitter(), {
    assertQueue: async () => { calls.declared += 1; await overrides.declare?.(); },
    deleteQueue: async () => { calls.deleted += 1; await overrides.remove?.(connection); },
    close: async () => { calls.closed += 1; },
  });
  connection.createChannel = async () => createChannel();
  connection.close = async () => { calls.disconnected += 1; connection.emit('close'); };
  return { connection, calls };
}

const sharedConfig = { rabbitmq: { uri: 'amqp://test', exchange: 'shared' }, globalConcurrency: 1 };

test('handoffs repetidos no mesmo socket removem listeners e cada release confirma uma vez', async () => {
  const { connection, calls } = sharedBroker();
  for (let index = 0; index < 25; index += 1) {
    const lease = await acquire(sharedConfig, () => false, () => {}, connection);
    assert.equal(connection.listenerCount('error'), 1);
    assert.equal(connection.listenerCount('close'), 1);
    await Promise.all([lease.release(), lease.release()]);
    assert.equal(connection.listenerCount('error'), 0);
    assert.equal(connection.listenerCount('close'), 0);
  }
  assert.equal(calls.declared, 25); assert.equal(calls.deleted, 25); assert.equal(calls.closed, 25);
  assert.equal(calls.disconnected, 0);
});

test('falha ao excluir residência força fechamento da conexão que ainda possui a fila', async () => {
  const { connection, calls } = sharedBroker({ remove: async () => { throw new Error('delete failed'); } });
  const lease = await acquire(sharedConfig, () => false, () => {}, connection);
  await lease.release();
  assert.equal(calls.deleted, 1);
  assert.equal(calls.disconnected, 1);
  assert.equal(connection.listenerCount('error'), 0);
  assert.equal(connection.listenerCount('close'), 0);
});

test('close já observado durante exclusão é liberação confirmada sem esperar outro close', async () => {
  const { connection } = sharedBroker({ remove: async (socket) => {
    socket.emit('close');
    throw new Error('connection already closed');
  } });
  connection.close = async () => { throw new Error('IllegalOperation: already closed'); };
  const lease = await acquire(sharedConfig, () => false, () => {}, connection);
  await lease.release();
  assert.equal(connection.listenerCount('close'), 0);
});

test('cancelamento concorrente com concessão limpa fila e canal sem fechar socket saudável', async () => {
  let granted = false;
  let grantedChecks = 0;
  const { connection, calls } = sharedBroker({ declare: async () => { granted = true; } });
  await assert.rejects(acquire(sharedConfig, () => granted && ++grantedChecks > 1, () => {}, connection), { code: 'CANCELLED' });
  assert.equal(calls.deleted, 1); assert.equal(calls.closed, 1); assert.equal(calls.disconnected, 0);
  assert.equal(connection.listenerCount('error'), 0); assert.equal(connection.listenerCount('close'), 0);
});

test('cancelamento depois de concessão com delete falho fecha socket e não abandona uma trava', async () => {
  let granted = false;
  let grantedChecks = 0;
  const { connection, calls } = sharedBroker({ declare: async () => { granted = true; },
    remove: async () => { throw new Error('delete failed'); } });
  await assert.rejects(acquire(sharedConfig, () => granted && ++grantedChecks > 1, () => {}, connection), { code: 'CANCELLED' });
  assert.equal(calls.deleted, 1);
  assert.equal(calls.disconnected, 1);
  assert.equal(connection.listenerCount('close'), 0);
});

test('cancelamento interrompe abertura ou declaração AMQP sem resposta e elimina o resultado incerto', async () => {
  for (const phase of ['open', 'declare']) {
    let cancelled = false;
    let started = false;
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { connection, calls } = sharedBroker({ declare: async () => { started = true; await pending; } });
    if (phase === 'open') connection.createChannel = async () => { started = true; await pending; return new EventEmitter(); };
    const acquiring = acquire(sharedConfig, () => cancelled, () => {}, connection);
    while (!started) await new Promise((resolve) => setImmediate(resolve));
    cancelled = true;
    await assert.rejects(acquiring, { code: 'CANCELLED' });
    assert.equal(calls.disconnected, 1);
    assert.equal(connection.listenerCount('error'), 0); assert.equal(connection.listenerCount('close'), 0);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
  }
});

test('declaração AMQP sem resposta expira e fecha conexão antes de admitir qualquer residência', { timeout: 10000 }, async () => {
  const { connection, calls } = sharedBroker({ declare: async () => new Promise(() => {}) });
  await assert.rejects(acquire(sharedConfig, () => false, () => {}, connection), { code: 'RESIDENCY_ACQUIRE_TIMEOUT' });
  assert.equal(calls.disconnected, 1);
  assert.equal(connection.listenerCount('error'), 0); assert.equal(connection.listenerCount('close'), 0);
});

test('erro de fechamento sem close força stream e exige confirmação da perda da conexão', async () => {
  const { connection } = sharedBroker({ remove: async () => { throw new Error('delete failed'); } });
  let destroyed = 0;
  connection.close = async () => { throw new Error('close failed'); };
  connection.connection = { stream: { destroy: () => { destroyed += 1; connection.emit('close'); } } };
  const lease = await acquire(sharedConfig, () => false, () => {}, connection);
  await lease.release();
  assert.equal(destroyed, 1);
  assert.equal(connection.listenerCount('close'), 0);
});

test('RESOURCE_LOCKED 405 com canal já fechado preserva socket e envia demanda antes de adquirir', async () => {
  const connection = new EventEmitter();
  let attempts = 0;
  let disconnections = 0;
  let hints = 0;
  let closedChannelCloseCalls = 0;
  connection.close = async () => { disconnections += 1; connection.emit('close'); };
  connection.createChannel = async () => {
    let closed = false;
    const channel = new EventEmitter();
    channel.assertQueue = async () => {
      if (++attempts === 1) {
        const error = Object.assign(new Error('Operation failed: QueueDeclare; 405 RESOURCE_LOCKED'), { code: 405 });
        closed = true;
        channel.emit('error', error);
        channel.emit('close');
        throw error;
      }
    };
    channel.deleteQueue = async () => {};
    channel.close = async () => {
      if (closed) { closedChannelCloseCalls += 1; throw new Error('Channel closed'); }
      closed = true; channel.emit('close');
    };
    return channel;
  };
  const lease = await acquire({ ...sharedConfig, admissionRetryMs: 5 }, () => false, () => {}, connection,
    async () => { hints += 1; });
  assert.equal(attempts, 2);
  assert.equal(hints, 1);
  assert.equal(closedChannelCloseCalls, 0);
  assert.equal(disconnections, 0);
  await lease.release();
  assert.equal(disconnections, 0);
  assert.equal(connection.listenerCount('close'), 0);
});

test('erro inesperado contendo RESOURCE_LOCKED no texto não é disfarçado de contenção 405', async () => {
  const cause = Object.assign(new Error('Unexpected RESOURCE_LOCKED metadata'), { code: 403 });
  const { connection } = sharedBroker({ declare: async () => { throw cause; } });
  let hints = 0;
  await assert.rejects(acquire(sharedConfig, () => false, () => {}, connection,
    async () => { hints += 1; }), { code: 403 });
  assert.equal(hints, 0);
  assert.equal(connection.listenerCount('close'), 0);
});
