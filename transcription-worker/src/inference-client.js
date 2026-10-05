'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

class InferenceClient {
  constructor(config, options = {}) {
    this.thread = new (options.Worker || Worker)(options.workerPath || path.join(__dirname, 'inference-thread.js'), { workerData: config });
    this.ready = false;
    this.stopping = false;
    this.active = null;
    this.startup = new Promise((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });
    this.thread.on('message', (message) => this.onMessage(message));
    this.thread.on('error', (error) => this.onFailure(error));
    this.thread.on('exit', (code) => this.onFailure(new Error(`Inferência encerrada (código ${code}).`)));
  }

  onMessage(message) {
    if (message?.type === 'ready') {
      this.ready = true;
      this.resolveStartup();
      return;
    }
    if (message?.type === 'startup-error') {
      this.onFailure(Object.assign(new Error(message.error?.message), { code: message.error?.code }));
      return;
    }
    const active = this.active;
    if (!active || active.id !== message?.id) return;
    if (message.type === 'progress') {
      Promise.resolve().then(() => active.onProgress?.(message.progress)).catch((error) => {
        console.error('Progresso de inferência não publicado:', error.message);
      });
      return;
    }
    this.active = null;
    if (message.type === 'result') active.resolve(message.result);
    else if (message.type === 'error') active.reject(Object.assign(new Error(message.error?.message), {
      code: message.error?.code, retryable: message.error?.retryable,
    }));
  }

  onFailure(error) {
    if (this.stopping) return;
    this.rejectStartup(error);
    if (!this.ready) void this.thread.terminate();
    if (this.active) {
      this.active.reject(error);
      this.active = null;
    }
    if (this.ready) {
      console.error('Inferência indisponível:', error.message);
      // A supervisão reinicia o container; não mantenha o consumidor disponível sem modelo.
      process.exit(1);
    }
  }

  async warmup() {
    await this.startup;
  }

  async transcribe(filePath, input = {}) {
    await this.startup;
    if (this.active || this.stopping) throw Object.assign(new Error('Inferência ocupada ou indisponível.'), { code: 'WORKER_BUSY' });
    const cancelSignal = new SharedArrayBuffer(4);
    const { isCancelled, onProgress, ...serializableInput } = input;
    if (isCancelled?.()) throw Object.assign(new Error('Processamento cancelado.'), { code: 'CANCELLED' });
    return new Promise((resolve, reject) => {
      this.active = { id: filePath, cancelSignal, onProgress, resolve, reject };
      this.thread.postMessage({ type: 'transcribe', id: filePath, filePath, input: serializableInput, cancelSignal });
    });
  }

  cancel() {
    if (this.active) Atomics.store(new Int32Array(this.active.cancelSignal), 0, 1);
  }

  async stop() {
    this.stopping = true;
    this.cancel();
    await this.thread.terminate();
  }
}

module.exports = { InferenceClient };
