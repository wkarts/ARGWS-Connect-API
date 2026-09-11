'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const typescript = require('typescript');
const sdk = require('@innovatorssoft/zapo-js');

const root = path.resolve(__dirname, '..');

function loadTs(relative) {
  const absolute = path.join(root, relative);
  const compiled = typescript.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = new Module(absolute, module);
  loaded.filename = absolute;
  loaded.paths = Module._nodeModulePaths(path.dirname(absolute));
  loaded._compile(compiled, absolute);
  return loaded.exports;
}

const media = loadTs('src/api/integrations/channel/whatsapp/zapo.media.helpers.ts');

function base64(byte) {
  return Buffer.alloc(32, byte).toString('base64');
}

test('persisted ZAPO document descriptors recover native binary key material', () => {
  const serialized = {
    documentMessage: {
      directPath: '/v/t62.7119-24/fixture-document',
      mediaKey: base64(1),
      fileSha256: base64(2),
      fileEncSha256: base64(3),
      fileLength: '321',
      mimetype: 'application/pdf',
      fileName: 'fixture.pdf',
    },
  };

  // This is the exact failure mode seen after Connect|API JSON persistence:
  // zapo-js rejects a string mediaKey and reports no downloadable media.
  assert.equal(sdk.resolveMediaPayload(serialized), null);

  const restored = media.restoreZapoMediaPayload(serialized);
  const payload = sdk.resolveMediaPayload(restored);

  assert.ok(payload);
  assert.equal(payload.mediaType, 'document');
  assert.equal(payload.directPath, serialized.documentMessage.directPath);
  assert.equal(payload.fileLength, 321);
  assert.deepEqual(Buffer.from(payload.mediaKey), Buffer.alloc(32, 1));
  assert.deepEqual(Buffer.from(payload.fileSha256), Buffer.alloc(32, 2));
  assert.deepEqual(Buffer.from(payload.fileEncSha256), Buffer.alloc(32, 3));
});

test('media restoration is recursive through view-once and document wrappers', () => {
  const serialized = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            documentWithCaptionMessage: {
              message: {
                documentMessage: {
                  directPath: '/v/t62.7119-24/wrapped-document',
                  mediaKey: base64(4),
                  fileSha256: base64(5),
                  fileEncSha256: base64(6),
                  fileLength: '654',
                  mimetype: 'application/pdf',
                },
              },
            },
          },
        },
      },
    },
  };

  assert.equal(media.containsZapoDownloadableMedia(serialized), true);

  const restored = media.restoreZapoMediaPayload(serialized);
  const payload = sdk.resolveMediaPayload(restored);

  assert.ok(payload);
  assert.equal(payload.mediaType, 'document');
  assert.equal(payload.fileLength, 654);
  assert.ok(payload.mediaKey instanceof Uint8Array);
});

test('restoration never converts unrelated or malformed application strings', () => {
  const value = {
    conversation: base64(7),
    contextInfo: {
      stanzaId: base64(8),
    },
    documentMessage: {
      directPath: '/fixture',
      mediaKey: 'not-valid-base64',
      fileLength: 'not-a-number',
    },
  };

  const restored = media.restoreZapoMediaPayload(value);

  assert.equal(restored.conversation, value.conversation);
  assert.equal(restored.contextInfo.stanzaId, value.contextInfo.stanzaId);
  assert.equal(restored.documentMessage.mediaKey, 'not-valid-base64');
  assert.equal(restored.documentMessage.fileLength, 'not-a-number');
});

test('downloadable media detection covers the provider-neutral WhatsApp media set', () => {
  for (const type of [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'ptvMessage',
  ]) {
    assert.equal(media.containsZapoDownloadableMedia({ [type]: {} }), true, type);
  }

  assert.equal(media.containsZapoDownloadableMedia({ conversation: 'hello' }), false);
});
