'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SpeechControlClient } = require('../src/control-client');

async function fixture() {
  const channel = new EventEmitter();
  channel.assertQueue = async () => ({ queue: 'private-reply' });
  channel.consume = async (_queue, handler) => { channel.reply = handler; };
  channel.ack = () => {};
  channel.close = async () => { channel.emit('close'); };
  const client = new SpeechControlClient({ poolId: 'pool', rabbitmq: { exchange: 'speech' }, controlTimeoutMs: 40 }, 'worker');
  await client.connect({ createConfirmChannel: async () => channel });
  return { channel, client };
}

test('RPC correlaciona reply e exige roteamento obrigatório do controle', async () => {
  const { channel, client } = await fixture();
  channel.publish = (exchange, route, body, options, done) => {
    const payload = JSON.parse(body.toString());
    assert.equal(exchange, 'speech'); assert.equal(route, 'speech.control.v2');
    assert.equal(options.mandatory, true); assert.equal(options.replyTo, 'private-reply');
    assert.equal(payload.poolId, 'pool'); assert.equal(payload.executionId, 'exec');
    done();
    setImmediate(() => channel.reply({ content: Buffer.from('{"ok":true,"applied":true}'),
      properties: { correlationId: options.correlationId } }));
  };
  assert.equal((await client.request('finish', { jobId: 'job', generation: 2, executionId: 'exec' }, { status: 'completed' })).applied, true);
  assert.equal(client.pending.size, 0); await client.close();
});

test('confirm de publicação sem rota não é interpretado como controle aplicado', async () => {
  const { channel, client } = await fixture();
  channel.publish = (_exchange, _route, body, options, done) => {
    channel.emit('return', { content: body, properties: { correlationId: options.correlationId } }); done();
  };
  await assert.rejects(client.request('claim', { jobId: 'job', generation: 1 }), { code: 'CONTROL_UNROUTABLE' });
  assert.equal(client.pending.size, 0); await client.close();
});

test('queda de canal rejeita operações pendentes imediatamente', async () => {
  const { channel, client } = await fixture();
  channel.publish = (_exchange, _route, _body, _options, done) => { done(); };
  const pending = assert.rejects(client.request('lease', { jobId: 'job' }), { code: 'CONTROL_UNAVAILABLE' });
  await channel.close(); await pending; assert.equal(client.pending.size, 0);
});

test('ausência de reply tem prazo e não mantém requests na memória', async () => {
  const { channel, client } = await fixture();
  channel.publish = (_exchange, _route, _body, _options, done) => { done(); };
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(client.request('claim', { jobId: 'job' }), { code: 'CONTROL_TIMEOUT' }); }
  finally { clearInterval(keepAlive); await client.close(); }
  assert.equal(client.pending.size, 0);
});
