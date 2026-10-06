'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createProvider } = require('./provider');

const provider = createProvider(workerData);

function memory(phase, id, childRss = 0, childPid = null) {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  parentPort.postMessage({ type: 'memory', id, phase, rss, heapUsed, heapTotal, external, arrayBuffers, childRss, childPid });
}

async function run(message) {
  const cancelled = new Int32Array(message.cancelSignal);
  memory('inference_begin', message.id);
  try {
    const result = await provider.transcribe(message.filePath, {
      ...message.input,
      isCancelled: () => Atomics.load(cancelled, 0) !== 0,
      onProgress: (progress) => parentPort.postMessage({ type: 'progress', id: message.id, progress }),
      onMemory: (phase, childRss, childPid) => memory(phase, message.id, childRss, childPid),
    });
    parentPort.postMessage({ type: 'result', id: message.id, result });
  } catch (error) {
    parentPort.postMessage({
      type: 'error', id: message.id,
      error: { message: String(error?.message || error), code: error?.code, retryable: error?.retryable },
    });
  } finally {
    memory('inference_end', message.id);
  }
}

parentPort.on('message', (message) => {
  if (message?.type === 'transcribe') void run(message);
  if (message?.type === 'metrics') memory('idle', null);
});

memory('before_model');
provider.warmup()
  .then(() => { memory('after_model'); parentPort.postMessage({ type: 'ready' }); })
  .catch((error) => parentPort.postMessage({
    type: 'startup-error', error: { message: String(error?.message || error), code: error?.code },
  }));
