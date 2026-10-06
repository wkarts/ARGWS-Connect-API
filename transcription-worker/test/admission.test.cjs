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
