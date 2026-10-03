'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob, REQUESTED, PROCESSING, COMPLETED, FAILED } = require('../src/worker');
const { validateConfig } = require('../src/config');

test('worker local mantém os tópicos do contrato', () => {
  assert.equal(REQUESTED, 'transcription.requested');
  assert.equal(PROCESSING, 'transcription.processing');
  assert.equal(COMPLETED, 'transcription.completed');
  assert.equal(FAILED, 'transcription.failed');
});

test('normaliza um job de áudio sem credencial externa', () => {
  const job = normalizeJob({ jobId: 'job-1', source: { key: 'audio/test.ogg', mimeType: 'audio/ogg' } });
  assert.equal(job.jobId, 'job-1');
  assert.equal(job.sourceMimeType, 'audio/ogg');
});

test('aceita MIME de gravações WebM do navegador', () => {
  const withCodec = normalizeJob({ jobId: 'job-webm-1', source: { key: 'audio/test.webm', mimeType: 'audio/webm;codecs=opus' } });
  const browserVideoMime = normalizeJob({ jobId: 'job-webm-2', source: { key: 'audio/test.webm', mimeType: 'video/webm' } });
  assert.equal(withCodec.sourceMimeType, 'audio/webm');
  assert.equal(browserVideoMime.sourceMimeType, 'audio/webm');
});

test('configuração local não exige OPENAI_API_KEY_GLOBAL', () => {
  const config = {
    enabled: true,
    provider: 'local',
    queue: 'argws-connect.transcription',
    local: { model: 'Xenova/whisper-small', device: 'cpu', dtype: 'q8' },
    rabbitmq: { uri: 'amqp://rabbitmq', exchange: 'argws_connect' },
    s3: { accessKey: 'key', secretKey: 'secret', bucket: 'bucket' },
  };
  assert.doesNotThrow(() => validateConfig(config));
});
