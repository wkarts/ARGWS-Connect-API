'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { TranscriptionWorker } = require('../../src/worker');

const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let attempts = 0;
let tag = 0;

function createChannel() {
  return Object.assign(new EventEmitter(), {
    assertExchange: async () => {},
    assertQueue: async (queue) => ({ queue: queue || 'fixture-control' }),
    bindQueue: async () => {},
    prefetch: async () => {},
    consume: async () => ({ consumerTag: 'fixture-' + ++tag }),
    cancel: async () => {},
    close: async () => {},
  });
}

// Use a real TCP socket so connection refusal and the last handle disappearing
// exercise Node's process lifecycle. AMQP commands are outside this regression.
async function connectBroker() {
  const attempt = ++attempts;
  const socket = net.createConnection({ host: '127.0.0.1', port: Number(process.argv[2]) });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
  } catch (error) {
    socket.destroy();
    emit({ event: 'connection-failed', attempt, code: error.code });
    throw error;
  }
  const connection = new EventEmitter();
  connection.createChannel = async () => createChannel();
  connection.createConfirmChannel = async () => createChannel();
  connection.close = async () => {
    if (socket.destroyed) return;
    await new Promise((resolve) => { socket.once('close', resolve); socket.destroy(); });
  };
  socket.on('error', (error) => connection.emit('error', error));
  socket.once('close', () => {
    emit({ event: 'connection-closed', attempt });
    connection.emit('close');
  });
  return connection;
}

const worker = new TranscriptionWorker({
  enabled: true, provider: 'local', mode: 'pool', modes: ['dictation', 'transcription'],
  local: { model: 'fixture-model' },
  rabbitmq: { uri: 'amqp://fixture', exchange: 'fixture' },
  s3: { endpoint: '127.0.0.1', port: 9000, useSSL: false, accessKey: 'fixture', secretKey: 'fixture-secret' },
}, {
  connectBroker,
  probeFfmpeg: async () => {},
  acquireSlot: async () => ({ release: async () => {} }),
  createInferenceClient: () => { throw new Error('Startup must not load an inference model.'); },
  control: {
    connect: async () => {}, close: async () => {},
    request: async (action, _job, data) => {
      if (action === 'health' && data.health.acceptingJobs) emit({ event: 'ready', attempt: attempts });
      return { ok: true };
    },
  },
});

process.once('SIGTERM', () => {
  void worker.stop().then(() => { emit({ event: 'stopped' }); process.exit(0); })
    .catch((error) => { console.error(error); process.exit(1); });
});

void worker.start().catch((error) => { console.error(error); process.exitCode = 1; });
