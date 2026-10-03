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
  process.once('SIGTERM', () => worker.stop().finally(() => process.exit(0)));
  process.once('SIGINT', () => worker.stop().finally(() => process.exit(0)));
  worker.start().catch((error) => {
    console.error('Transcription worker não iniciou:', error);
    process.exitCode = 1;
  });
}
