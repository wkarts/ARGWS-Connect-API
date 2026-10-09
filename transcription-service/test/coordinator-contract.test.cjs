'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob, REQUESTED, PROCESSING, COMPLETED, FAILED } = require('../src/coordinator');

test('mantém as chaves do contrato de fila', () => {
  assert.equal(REQUESTED, 'transcription.requested');
  assert.equal(PROCESSING, 'transcription.processing');
  assert.equal(COMPLETED, 'transcription.completed');
  assert.equal(FAILED, 'transcription.failed');
});

test('normaliza somente origens de áudio e campos necessários', () => {
  const job = normalizeJob({
    jobId: 'job-1',
    attempts: 3,
    messageId: 'message-1',
    source: { key: 'media/audio.ogg', mimeType: 'audio/ogg' },
    language: 'pt',
  });
  assert.equal(job.sourceKey, 'media/audio.ogg');
  assert.equal(job.sourceMimeType, 'audio/ogg');
  assert.equal(job.attempts, 3);
  assert.throws(
    () => normalizeJob({ jobId: 'job-2', source: { key: 'media/file.jpg', mimeType: 'image/jpeg' } }),
    /Origem de áudio inválida/,
  );
});
