'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { terminateProcessGroup } = require('./process-supervisor');

const failure = (message, code, retryable = true) => Object.assign(new Error(message), { code, retryable });

class InferenceClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fork = options.fork || fork;
    this.workerPath = options.workerPath || path.join(__dirname, 'inference-process.js');
    this.guardianPath = options.guardianPath || path.join(__dirname, 'inference-guardian.js');
    this.stallTimeoutMs = options.stallTimeoutMs ?? (config.inferenceStallSeconds || 300) * 1000;
    this.chunkDeadlineMs = options.chunkDeadlineMs ?? (config.chunkDeadlineSeconds || 180) * 1000;
    this.restartOnFailure = options.restartOnFailure !== false;
    this.terminate = options.terminateProcessGroup || terminateProcessGroup;
    this.active = null;
    this.child = null;
    this.recovery = null;
    this.stopping = false;
    this.ready = false;
    this.lastSuccessfulInferenceAt = null;
    this.status = { state: 'cold', modelLoaded: false, modelVerified: false };
  }

  startProcess() {
    if (this.child || this.stopping || this.fatalError) return;
    const childEnv = {};
    for (const name of ['PATH', 'LD_LIBRARY_PATH', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP']) {
      if (process.env[name]) childEnv[name] = process.env[name];
    }
    this.tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-engine-'));
    Object.assign(childEnv, {
      TMPDIR: this.tempDirectory, TMP: this.tempDirectory, TEMP: this.tempDirectory,
      OMP_NUM_THREADS: String(this.config.inferenceThreads || 1),
      OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', TOKENIZERS_PARALLELISM: 'false',
    });
    const child = this.fork(this.guardianPath, [], {
      detached: process.platform !== 'win32', serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: childEnv, execArgv: [],
    });
    this.child = child;
    this.thread = child; // Compatibility for operational introspection; this is a process.
    this.ready = false;
    this.status = { ...this.status, state: 'loading_model', modelLoaded: false };
    this.startup = new Promise((resolve, reject) => { this.resolveStartup = resolve; this.rejectStartup = reject; });
    // Prevent a background startup rejection from becoming an unhandled promise.
    void this.startup.catch(() => {});
    let stderrBytes = 0;
    child.stderr?.on('data', (buffer) => {
      stderrBytes += buffer.length;
      // Never log decoder output or transcripts; retain a bounded diagnostic count.
      this.status.stderrBytes = Math.min(stderrBytes, Number.MAX_SAFE_INTEGER);
    });
    child.on('message', (message) => { if (this.child === child) this.onMessage(message); });
    child.once('error', (error) => { if (this.child === child) void this.onFailure(error); });
    child.once('exit', (code, signal) => {
      if (this.child === child) void this.onFailure(failure(`Processo de inferência encerrou (${signal || code}).`, 'INFERENCE_PROCESS_FAILED'));
    });
    const { s3, rabbitmq, ...localConfig } = this.config;
    // Network credentials stay in the coordinator. Engine provisioning is separate.
    const parentTimeoutMs = Math.min(10000, Math.max(2000, (this.config.executionLeaseSeconds || 30) * 1000 - 5000));
    child.send({ type: 'init', enginePath: this.workerPath, parentTimeoutMs,
      config: localConfig });
    this.parentHeartbeat = setInterval(() => {
      if (this.child === child && child.connected) child.send({ type: 'parent-heartbeat' }, (error) => {
        if (error) void this.reset(failure('Guardião de inferência indisponível.', 'INFERENCE_PROCESS_FAILED'));
      });
    }, Math.max(500, Math.floor(parentTimeoutMs / 3)));
    this.parentHeartbeat.unref?.();
    this.startupTimer = setTimeout(() => {
      void this.reset(failure('O modelo não ficou pronto dentro do prazo.', 'MODEL_WARMUP_TIMEOUT'));
    }, (this.config.modelWarmupTimeoutSeconds || 300) * 1000);
    this.startupTimer.unref?.();
  }

  async warmup() {
    if (this.recovery) await this.recovery;
    if (this.fatalError) throw this.fatalError;
    if (this.stopping) throw failure('Worker em encerramento.', 'WORKER_STOPPING');
    if (!this.child) this.startProcess();
    await this.startup;
    return this.status;
  }

  onMessage(message) {
    if (message?.type === 'ready') {
      clearTimeout(this.startupTimer);
      this.ready = true;
      this.status = { ...this.status, ...message.capabilities, state: 'ready', modelLoaded: true, modelVerified: true };
      this.lastSuccessfulInferenceAt = message.capabilities?.lastSuccessfulInferenceAt || null;
      this.resolveStartup?.(this.status);
      return;
    }
    if (message?.type === 'startup-error') {
      void this.reset(Object.assign(new Error(message.error?.message || 'Modelo indisponível.'), message.error));
      return;
    }
    if (message?.type === 'memory') {
      this.status.memory = message.memory;
      return;
    }
    const active = this.active;
    if (!active || active.id !== message?.id) return;
    if (message.type === 'progress') {
      // Progress cannot extend the absolute per-chunk deadline.
      clearTimeout(active.stallTimer);
      active.stallTimer = setTimeout(() => void this.reset(failure('Inferência sem progresso.', 'INFERENCE_STALLED')), this.stallTimeoutMs);
      active.stallTimer.unref?.();
      active.progressChain = active.progressChain.then(() => active.onProgress?.(message.progress));
      void active.progressChain.catch((error) => void this.reset(error));
      return;
    }
    if (!['result', 'error'].includes(message.type)) return;
    if (message.type === 'error') { void this.reset(Object.assign(new Error(message.error?.message), message.error)); return; }
    void this.settle(active, message);
  }

  async settle(active, message) {
    try {
      await active.progressChain;
      if (this.active !== active) return;
      this.active = null;
      clearTimeout(active.stallTimer);
      clearTimeout(active.deadlineTimer);
      this.status.state = 'ready';
      if (message.type === 'result') {
        this.lastSuccessfulInferenceAt = new Date().toISOString();
        active.resolve(message.result);
      } else active.reject(Object.assign(new Error(message.error?.message), message.error));
    } catch (error) {
      await this.reset(error);
    }
  }

  async run(type, filePath, input = {}) {
    if (this.recovery) await this.recovery;
    if (!this.child && !this.restartOnFailure && this.failed) {
      throw failure('Processo de inferência indisponível.', 'INFERENCE_PROCESS_FAILED');
    }
    await this.warmup();
    if (this.stopping || !this.child || !this.ready) throw failure('Worker em encerramento.', 'WORKER_STOPPING');
    if (this.active) throw failure('Inferência ocupada.', 'WORKER_BUSY');
    const { isCancelled, onProgress, ...serializableInput } = input;
    if (isCancelled?.()) throw failure('Processamento cancelado.', 'CANCELLED', false);
    const deadlineAt = Date.parse(input.deadlineAt || '') || Infinity;
    const deadlineMs = Math.min(this.chunkDeadlineMs, deadlineAt - Date.now());
    if (deadlineMs <= 0) throw failure('O prazo útil do job expirou.', 'DEADLINE_EXCEEDED', false);
    return new Promise((resolve, reject) => {
      const active = { id: randomUUID(), jobId: input.jobId, resolve, reject, onProgress, progressChain: Promise.resolve() };
      this.active = active;
      this.status.state = 'transcribing';
      active.stallTimer = setTimeout(() => void this.reset(failure('Inferência sem progresso.', 'INFERENCE_STALLED')), this.stallTimeoutMs);
      active.deadlineTimer = setTimeout(() => void this.reset(failure('O chunk excedeu seu prazo de execução.', 'CHUNK_DEADLINE_EXCEEDED')), deadlineMs);
      active.stallTimer.unref?.(); active.deadlineTimer.unref?.();
      this.child.send({ type, id: active.id, filePath, input: serializableInput }, (error) => {
        if (error) void this.reset(failure(error.message, 'INFERENCE_PROCESS_FAILED'));
      });
    });
  }

  transcribe(filePath, input) { return this.run('transcribe', filePath, input); }
  transcribeChunk(filePath, input) { return this.run('chunk', filePath, input); }

  async onFailure(error) {
    if (this.stopping && !this.child) return;
    await this.reset(Object.assign(error, { code: error.code || 'INFERENCE_PROCESS_FAILED', retryable: true }));
  }

  async reset(error) {
    if (this.recovery) return this.recovery;
    const child = this.child || this.failedChild;
    const tempDirectory = this.tempDirectory;
    this.tempDirectory = null;
    const active = this.active;
    const rejectStartup = this.rejectStartup;
    this.child = null; this.thread = null; this.ready = false;
    this.failed = true;
    clearTimeout(this.startupTimer);
    clearInterval(this.parentHeartbeat);
    if (active) { clearTimeout(active.stallTimer); clearTimeout(active.deadlineTimer); }
    this.status = { ...this.status, state: 'stopping_model', modelLoaded: false };
    this.recovery = (async () => {
      let failureError = error;
      try {
        await this.terminate(child, this.config.processKillGraceMs || 1000);
        this.failedChild = null;
        if (tempDirectory) await fs.promises.rm(tempDirectory, { recursive: true, force: true });
      } catch (terminationError) {
        this.fatalError = terminationError;
        this.failedChild = child;
        failureError = terminationError;
      }
      this.active = null;
      this.status.state = this.fatalError ? 'degraded' : 'cold';
      // A token/slot must not be released until the entire native group is gone.
      rejectStartup?.(failureError);
      active?.reject(failureError);
    })();
    await this.recovery;
    this.recovery = null;
    // The active operation carries termination failure to the coordinator. A
    // timer callback must not crash it and implicitly release the residency lock.
  }

  async cancel() {
    await this.reset(failure('Processamento cancelado.', 'CANCELLED', false));
    if (this.fatalError) throw this.fatalError;
  }
  sampleMemory() { if (this.ready && !this.active) this.child?.send({ type: 'metrics' }); }
  async stop() {
    this.stopping = true;
    await this.reset(failure('Worker em encerramento; o job será recuperado.', 'WORKER_STOPPING'));
    if (this.fatalError) throw this.fatalError;
  }
}

module.exports = { InferenceClient };
