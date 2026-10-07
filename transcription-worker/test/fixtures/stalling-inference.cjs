'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
process.on('message', (message) => {
  if (message.type === 'init') { process.send({ type: 'ready', capabilities: { engine: 'fixture', lastSuccessfulInferenceAt: new Date().toISOString() } }); return; }
  if (message.type === 'metrics') { process.send({ type: 'memory', memory: process.memoryUsage() }); return; }
  if (!['chunk', 'transcribe'].includes(message.type)) return;
  if (message.input.grandchildPidFile) {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(message.input.grandchildPidFile, String(grandchild.pid));
  }
  if (message.input.stall) { for (;;) {} }
  process.send({ type: 'result', id: message.id, result: { text: 'recuperado', pid: process.pid } });
});
