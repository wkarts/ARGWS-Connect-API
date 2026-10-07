'use strict';

const { loadConfig, validateConfig } = require('./config');
const { TranscriptionWorker } = require('./worker');

const config = loadConfig();

try {
  validateConfig(config);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  const worker = new TranscriptionWorker(config);
  const shutdown = () => worker.stop()
    .then(() => process.exit(0))
    .catch((error) => { console.error('Falha ao encerrar worker:', error); process.exit(1); });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  worker.start().catch((error) => {
    console.error('Transcription worker não iniciou:', error);
    process.exitCode = 1;
  });
}
