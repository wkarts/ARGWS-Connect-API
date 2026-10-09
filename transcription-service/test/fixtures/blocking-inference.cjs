'use strict';
process.on('message', (message) => {
  if (message.type === 'init') { process.send({ type: 'ready', capabilities: { lastSuccessfulInferenceAt: new Date().toISOString() } }); return; }
  if (!['chunk', 'transcribe'].includes(message.type)) return;
  const until = Date.now() + 160;
  while (Date.now() < until) {}
  process.send({ type: 'result', id: message.id, result: { text: 'concluído', pid: process.pid } });
});
