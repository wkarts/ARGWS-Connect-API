const { parentPort } = require('node:worker_threads');

parentPort.postMessage({ type: 'memory', phase: 'before_model', rss: process.memoryUsage().rss });
parentPort.postMessage({ type: 'ready' });
parentPort.on('message', (message) => {
  if (message.type === 'metrics') {
    parentPort.postMessage({ type: 'memory', phase: 'idle', id: null, rss: process.memoryUsage().rss });
    return;
  }
  if (message.type !== 'transcribe') return;
  if (message.input.stall) {
    while (true) { /* simula uma chamada nativa que nunca retorna */ }
  }
  parentPort.postMessage({ type: 'result', id: message.id, result: { text: 'recuperado' } });
});
