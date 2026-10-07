'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

class InferenceClient {
  constructor(config, options = {}) {
    this.config = config;
    this.WorkerClass = options.Worker || Worker;
    this.workerPath = options.workerPath || path.join(__dirname, 'inference-thread.js');
    this.stallTimeoutMs = options.stallTimeoutMs ?? (config.inferenceStallSeconds || 300) * 1000;
    this.restartOnFailure = options.restartOnFailure !== false;
    this.stopping = false;
    this.active = null;
    this.recovery = null;
    this.startThread();
  }

  startThread() {
    const thread = new this.WorkerClass(this.workerPath, { workerData: this.config });
    this.thread = thread;
    this.ready = false;
    this.startup = new Promise((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });
    thread.on('message', (message) => {
      if (this.thread === thread) this.onMessage(message);
    });
    thread.on('error', (error) => {
      if (this.thread === thread) this.onFailure(error);
    });
    thread.on('exit', (code) => {
      if (this.thread === thread) this.onFailure(new Error(`Inferência encerrada (código ${code}).`));
    });
  }

  watch(active) {
    clearTimeout(active.watchdog);
    active.watchdog = setTimeout(() => this.onStall(active), this.stallTimeoutMs);
    active.watchdog.unref?.();
  }

  onStall(active) {
    if (this.active !== active || this.stopping) return;
    console.error(`Inferência sem progresso por ${this.stallTimeoutMs} ms; encerrando a thread do modelo.`);
    this.restartThread(Object.assign(new Error('A inferência não apresentou progresso dentro do prazo.'), {
      code: 'INFERENCE_STALLED', retryable: true,
    }));
  }

  restartThread(error) {
    const active = this.active;
    this.killDecoder(active);
    this.active = null;
    if (active) clearTimeout(active.watchdog);
    const previousThread = this.thread;
    this.thread = null;
    this.ready = false;
    this.recovery = previousThread.terminate().then(async () => {
      if (this.stopping) return;
      if (!this.restartOnFailure) return;
      this.startThread();
      await this.startup;
    }).catch((error) => {
      if (!this.stopping) {
        console.error('Não foi possível encerrar ou reiniciar a inferência:', error.message);
        process.exit(1);
      }
    });
    active?.reject(error);
  }

  onMessage(message) {
    if (message?.type === 'memory') {
      // Startup/idle samples have no job id; never associate them with an absent active job.
      const active = message.id != null && this.active?.id === message.id ? this.active : null;
      if (active) {
        if (message.phase === 'ffmpeg_spawn') active.childPid = message.childPid;
        if (message.phase === 'ffmpeg_exit' && active.childPid === message.childPid) active.childPid = null;
      }
      console.log(JSON.stringify({ event: 'speech_inference_memory', phase: message.phase,
        mode: this.config.mode, jobId: active?.jobId, attempt: active?.attempts,
        rss: message.rss, heapUsed: message.heapUsed, heapTotal: message.heapTotal,
        external: message.external, arrayBuffers: message.arrayBuffers, childRss: message.childRss }));
      return;
    }
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
      this.watch(active);
      Promise.resolve().then(() => active.onProgress?.(message.progress)).catch((error) => {
        console.error('Progresso de inferência não publicado:', error.message);
      });
      return;
    }
    this.active = null;
    clearTimeout(active.watchdog);
    if (message.type === 'result') active.resolve(message.result);
    else if (message.type === 'error') active.reject(Object.assign(new Error(message.error?.message), {
      code: message.error?.code, retryable: message.error?.retryable,
    }));
  }

  onFailure(error) {
    if (this.stopping) return;
    if (!this.ready) {
      this.rejectStartup(error);
      void this.thread.terminate();
      return;
    }
    console.error('Thread de inferência falhou:', error.message);
    this.restartThread(Object.assign(error, { code: 'INFERENCE_THREAD_FAILED', retryable: true }));
  }

  async warmup() {
    await this.startup;
  }

  async transcribe(filePath, input = {}) {
    if (this.recovery) await this.recovery;
    await this.startup;
    if (!this.thread || !this.ready) throw Object.assign(new Error('Thread de inferência indisponível.'), {
      code: 'INFERENCE_THREAD_FAILED', retryable: true,
    });
    if (this.active || this.stopping) throw Object.assign(new Error('Inferência ocupada ou indisponível.'), {
      code: this.stopping ? 'WORKER_STOPPING' : 'WORKER_BUSY',
    });
    const cancelSignal = new SharedArrayBuffer(4);
    const { isCancelled, onProgress, ...serializableInput } = input;
    if (isCancelled?.()) throw Object.assign(new Error('Processamento cancelado.'), { code: 'CANCELLED' });
    return new Promise((resolve, reject) => {
      this.active = { id: filePath, jobId: input.jobId, attempts: input.attempts,
        cancelSignal, onProgress, resolve, reject };
      this.watch(this.active);
      this.thread.postMessage({ type: 'transcribe', id: filePath, filePath, input: serializableInput, cancelSignal });
    });
  }

  cancel() {
    if (this.active) Atomics.store(new Int32Array(this.active.cancelSignal), 0, 1);
  }

  killDecoder(active) {
    if (!active?.childPid) return;
    try { process.kill(active.childPid, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') console.error('Falha ao encerrar FFmpeg:', error.message);
    }
    active.childPid = null;
  }

  sampleMemory() {
    if (this.ready && !this.active && !this.stopping) this.thread?.postMessage({ type: 'metrics' });
  }

  async stop() {
    this.stopping = true;
    this.cancel();
    if (this.active) {
      this.killDecoder(this.active);
      clearTimeout(this.active.watchdog);
      this.active.reject(Object.assign(new Error('O worker está encerrando; o job será recuperado pela fila.'), {
        code: 'WORKER_STOPPING', retryable: true,
      }));
      this.active = null;
    }
    if (!this.ready) this.rejectStartup?.(new Error('Worker encerrado durante a inicialização.'));
    await this.thread?.terminate();
    await this.recovery;
  }
}

module.exports = { InferenceClient };
