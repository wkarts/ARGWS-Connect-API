'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createProvider } = require('./provider');

const provider = createProvider(workerData);

async function run(message) {
  const cancelled = new Int32Array(message.cancelSignal);
  try {
    const result = await provider.transcribe(message.filePath, {
      ...message.input,
      isCancelled: () => Atomics.load(cancelled, 0) !== 0,
      onProgress: (progress) => parentPort.postMessage({ type: 'progress', id: message.id, progress }),
    });
    parentPort.postMessage({ type: 'result', id: message.id, result });
  } catch (error) {
    parentPort.postMessage({
      type: 'error', id: message.id,
      error: { message: String(error?.message || error), code: error?.code, retryable: error?.retryable },
    });
  }
}

parentPort.on('message', (message) => {
  if (message?.type === 'transcribe') void run(message);
});

provider.warmup()
  .then(() => parentPort.postMessage({ type: 'ready' }))
  .catch((error) => parentPort.postMessage({
    type: 'startup-error', error: { message: String(error?.message || error), code: error?.code },
  }));
