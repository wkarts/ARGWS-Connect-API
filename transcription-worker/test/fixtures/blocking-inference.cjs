const { parentPort } = require('node:worker_threads');
parentPort.postMessage({ type: 'ready' });
parentPort.on('message', (message) => {
  if (message.type !== 'transcribe') return;
  const until = Date.now() + 240;
  while (Date.now() < until) { /* simula inferência síncrona de ONNX */ }
  parentPort.postMessage({ type: 'result', id: message.id, result: { text: 'concluído' } });
});
