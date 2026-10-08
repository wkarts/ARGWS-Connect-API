'use strict';

const { loadConfig, validateConfig } = require('./config');

const truthy = new Set(['1', 'true', 'yes', 'on']);
const flag = (env, name, fallback) => env[name] === undefined ? fallback : truthy.has(String(env[name]).trim().toLowerCase());
function integer(env, name, fallback, min, max) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= min ? Math.min(max, Math.floor(value)) : fallback;
}

function serviceConfig(base = loadConfig(), env = process.env) {
  return { ...base, mode: 'pool', modes: ['dictation', 'transcription'],
    queue: base.queues?.transcription || base.queue,
    concurrency: 1,
    pcmFastPath: flag(env, 'SPEECH_PCM_FAST_PATH', true),
    skipDigitalSilence: flag(env, 'SPEECH_SKIP_DIGITAL_SILENCE', true),
    modelKeepWarm: flag(env, 'SPEECH_MODEL_KEEP_WARM', false),
    prewarm: flag(env, 'SPEECH_PREWARM', false),
    dictationChunkSeconds: integer(env, 'SPEECH_DICTATION_CHUNK_SECONDS', 5, 1, 30),
    dictationStrideSeconds: integer(env, 'SPEECH_DICTATION_STRIDE_SECONDS', 1, 0, 15),
  };
}

/** One optional service, reusing the existing fenced jobs and isolated ASR. */
function createServiceClass(Base = require('./worker').TranscriptionWorker) {
  return class TranscriptionService extends Base {
    async connect() {
      // Queue deliveries may arrive while warming. Keep them bounded by existing
      // prefetch; never overlap a warmup with a job or allocate a second model.
      this.preparing = true;
      let connected = false;
      try {
        await super.connect();
        if (this.config.prewarm && !this.stopping && this.connection && this.residentLease) {
          await this.loadProvider();
          await this.reportHealth();
        }
        connected = true;
      } finally {
        this.preparing = false;
        if (connected) this.pump();
      }
    }

    pump() {
      if (!this.preparing) super.pump();
    }

    scheduleIdleUnload() {
      if (this.config.modelKeepWarm && !this.stopping) {
        clearTimeout(this.idleTimer);
        return;
      }
      super.scheduleIdleUnload();
    }
  };
}

async function main() {
  const config = serviceConfig();
  validateConfig(config);
  if (!config.enabled) {
    console.log('Transcrição opcional desabilitada; nenhum consumidor ou modelo foi iniciado.');
    return;
  }
  if (config.engine !== 'whisper.cpp') {
    throw new Error('A imagem nativa exige SPEECH_ENGINE=whisper.cpp. Use a imagem legada para transformers; não há fallback automático.');
  }
  const Service = createServiceClass();
  const service = new Service(config);
  const stop = () => service.stop().then(() => process.exit(0), () => process.exit(1));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try { await service.start(); }
  catch (error) { await service.stop(); throw error; }
}

if (require.main === module) main().catch((error) => {
  console.error('O serviço opcional de transcrição não iniciou:', error.message);
  process.exitCode = 1;
});

module.exports = { createServiceClass, serviceConfig, main };
