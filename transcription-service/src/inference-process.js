'use strict';

const { createProvider } = require('./provider');
let provider;
let busy = false;

function send(value) { if (process.connected) process.send(value); }
const serializeError = (error) => ({ message: String(error?.message || error).slice(0, 2000), code: error?.code, retryable: error?.retryable });

process.on('message', async (message) => {
  if (message?.type === 'init' && !provider) {
    try {
      provider = createProvider(message.config);
      const capabilities = await provider.warmup();
      send({ type: 'ready', capabilities });
    } catch (error) { send({ type: 'startup-error', error: serializeError(error) }); }
    return;
  }
  if (message?.type === 'metrics') { send({ type: 'memory', memory: process.memoryUsage() }); return; }
  if (!['transcribe', 'chunk'].includes(message?.type)) return;
  if (!provider || busy) {
    send({ type: 'error', id: message.id, error: { message: 'Motor ocupado ou indisponível.', code: 'WORKER_BUSY', retryable: true } });
    return;
  }
  busy = true;
  try {
    const method = message.type === 'chunk' ? 'transcribeChunk' : 'transcribe';
    const result = await provider[method](message.filePath, {
      ...message.input,
      onProgress: (progress) => send({ type: 'progress', id: message.id, progress }),
    });
    send({ type: 'result', id: message.id, result });
  } catch (error) { send({ type: 'error', id: message.id, error: serializeError(error) }); }
  finally { busy = false; }
});

// If the coordinator disappears, do not leave a native model orphaned. Kill the
// process group because native code may block this process' event loop on SIGTERM.
process.once('disconnect', () => {
  if (process.platform !== 'win32') { try { process.kill(-Number(process.env.SPEECH_PROCESS_GROUP_ID || process.pid), 'SIGKILL'); } catch {} }
  process.exit(1);
});
