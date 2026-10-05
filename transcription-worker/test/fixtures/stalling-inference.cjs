const { parentPort } = require('node:worker_threads');

parentPort.postMessage({ type: 'ready' });
parentPort.on('message', (message) => {
  if (message.type !== 'transcribe') return;
  if (message.input.stall) {
    while (true) { /* simula uma chamada nativa que nunca retorna */ }
  }
  parentPort.postMessage({ type: 'result', id: message.id, result: { text: 'recuperado' } });
});
