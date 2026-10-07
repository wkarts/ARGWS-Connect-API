'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { downloadObjectToFile, cleanup } = require('../src/storage');

const audio = Buffer.from('authorized audio fixture');
const sha256 = createHash('sha256').update(audio).digest('hex');
const client = () => ({ getObject: async () => Readable.from([audio]) });

test('download faz streaming e confere hash/tamanho autorizados', async () => {
  const source = await downloadObjectToFile(client(), 'bucket', 'audio/test.ogg', 'audio/ogg', 1024, {
    sha256, expectedBytes: audio.length,
  });
  try { assert.equal(source.sha256, sha256); assert.equal(source.bytes, audio.length); assert.deepEqual(await fs.readFile(source.filePath), audio); }
  finally { await cleanup(source.directory); }
});

test('fonte adulterada ou bytes excessivos falha explicitamente', async () => {
  await assert.rejects(downloadObjectToFile(client(), 'bucket', 'audio/x.ogg', 'audio/ogg', 1024, {
    sha256: 'a'.repeat(64),
  }), { code: 'SOURCE_HASH_MISMATCH' });
  await assert.rejects(downloadObjectToFile(client(), 'bucket', 'audio/x.ogg', 'audio/ogg', 4), { code: 'AUDIO_TOO_LARGE' });
});

test('cancelamento interrompe download sem fim e fecha a origem', async () => {
  const source = new Readable({ read() {} });
  const controller = new AbortController();
  const pending = assert.rejects(downloadObjectToFile({ getObject: async () => source }, 'bucket', 'audio/x.ogg', 'audio/ogg', 1024, {
    signal: controller.signal,
  }), (error) => error.name === 'AbortError' || error.code === 'AUDIO_DOWNLOAD_ABORTED');
  await new Promise((resolve) => setTimeout(resolve, 15));
  controller.abort(); await pending; assert.equal(source.destroyed, true);
});
