'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const typescript = require('typescript');

const parity = fs.readFileSync('src/api/integrations/channel/whatsapp/zapo.parity.extensions.ts', 'utf8');
const recovery = fs.readFileSync('src/api/integrations/channel/whatsapp/zapo.media-recovery.extensions.ts', 'utf8');
const channel = fs.readFileSync('src/api/integrations/channel/channel.controller.ts', 'utf8');
const baileys = fs.readFileSync('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts', 'utf8');
const metaStatus = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-status.mapper.ts', 'utf8');
const sdk = require('@innovatorssoft/zapo-js');

function loadTs(relativePath) {
  const absolute = path.resolve(relativePath);
  const output = typescript.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = new Module(absolute, module);
  loaded.filename = absolute;
  loaded.paths = Module._nodeModulePaths(path.dirname(absolute));
  loaded._compile(output, absolute);
  return loaded.exports;
}

const mediaRecovery = loadTs('src/api/integrations/channel/whatsapp/zapo.media-recovery.helpers.ts');
const callContract = loadTs('src/api/integrations/channel/whatsapp/zapo.call-contract.helpers.ts');

test('Zapo parity remains additive while persisted media recovery is the active final provider layer', () => {
  assert.match(channel, /ZapoMediaRecoveryStartupService/);
  assert.match(channel, /return new ZapoMediaRecoveryStartupService\(/);
  assert.match(channel, /return new BaileysStartupService\(/);
  assert.match(recovery, /extends ZapoParityStartupService/);
  assert.match(parity, /extends ZapoIdentityStartupService/);
  assert.match(baileys, /downloadMediaMessage\(/);
  assert.match(baileys, /Events\.MESSAGES_UPDATE/);
});

test('Zapo media uses the native verified media pipeline before MESSAGES_UPSERT', () => {
  assert.equal(typeof sdk.downloadMediaMessage, 'function');
  assert.match(parity, /client\.on\('message'/);
  assert.match(parity, /client\.message\.downloadBytes\(event\)/);
  assert.match(parity, /mediaDownloads/);
  assert.match(parity, /messageWebhookQueue/);
  assert.match(parity, /await this\.enrichMessageMedia\(payload\)/);
  assert.match(parity, /payload\.message = \{ \.\.\.\(payload\.message \|\| \{\}\), base64:/);
  assert.match(parity, /s3Service\.uploadFile/);
  assert.match(parity, /prismaRepository\.media\.upsert/);
  assert.match(parity, /mediaUrl/);
});

test('persisted Zapo media restores Base64 key material before the native downloader fallback', () => {
  assert.equal(typeof sdk.resolveMediaPayload, 'function');
  assert.match(recovery, /restorePersistedZapoMedia/);
  assert.match(recovery, /findPersistedMessage/);
  assert.match(recovery, /super\.getBase64FromMediaMessage/);

  const key = Buffer.alloc(32, 1);
  const sha = Buffer.alloc(32, 2);
  const encSha = Buffer.alloc(32, 3);
  const persisted = {
    documentMessage: {
      directPath: '/v/t62.7119-24/connect-api-zapo-fallback',
      mediaKey: key.toString('base64'),
      fileSha256: sha.toString('base64'),
      fileEncSha256: encSha.toString('base64'),
      fileLength: '1234',
      mimetype: 'application/pdf',
      fileName: 'fallback.pdf',
    },
  };

  // Reproduces the production failure: JSON persistence turns mediaKey into a
  // string and zapo-js no longer recognizes the message as downloadable.
  assert.equal(sdk.resolveMediaPayload(persisted), null);

  const restored = mediaRecovery.restorePersistedZapoMedia(persisted);
  assert.equal(typeof restored.documentMessage.fileLength.toNumber, 'function');
  assert.equal(restored.documentMessage.fileLength.toNumber(), 1234);
  const resolved = sdk.resolveMediaPayload(restored);

  assert.ok(resolved);
  assert.equal(resolved.mediaType, 'document');
  assert.equal(resolved.fileLength, 1234);
  assert.deepEqual(Buffer.from(resolved.mediaKey), key);
  assert.deepEqual(Buffer.from(resolved.fileSha256), sha);
  assert.deepEqual(Buffer.from(resolved.fileEncSha256), encSha);
});

test('persisted Zapo fileLength remains compatible when JSON already contains a number', () => {
  const restored = mediaRecovery.restorePersistedZapoMedia({
    audioMessage: {
      directPath: '/audio',
      mediaKey: Buffer.alloc(32, 7).toString('base64'),
      fileLength: 4321,
    },
  });

  assert.equal(typeof restored.audioMessage.fileLength.toNumber, 'function');
  assert.equal(restored.audioMessage.fileLength.toNumber(), 4321);
});

test('persisted media recovery is recursive and does not decode unrelated application strings', () => {
  const unrelated = Buffer.alloc(32, 9).toString('base64');
  const wrapped = {
    conversation: unrelated,
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              directPath: '/wrapped',
              mediaKey: Buffer.alloc(32, 4).toString('base64'),
              fileSha256: Buffer.alloc(32, 5).toString('base64'),
              fileEncSha256: Buffer.alloc(32, 6).toString('base64'),
            },
          },
        },
      },
    },
  };

  assert.equal(mediaRecovery.isZapoMediaMessage(wrapped), true);
  const restored = mediaRecovery.restorePersistedZapoMedia(wrapped);
  assert.equal(restored.conversation, unrelated);
  assert.ok(restored.ephemeralMessage.message.viewOnceMessageV2.message.imageMessage.mediaKey instanceof Uint8Array);
});

test('Zapo receipt events map to the same Connect API status vocabulary used by Baileys', () => {
  assert.match(parity, /client\.on\('receipt'/);
  assert.match(parity, /delivered: 'DELIVERY_ACK'/);
  assert.match(parity, /inactive: 'DELIVERY_ACK'/);
  assert.match(parity, /read: 'READ'/);
  assert.match(parity, /played: 'PLAYED'/);
  assert.match(parity, /'SERVER_ACK'/);
  assert.match(parity, /Events\.MESSAGES_UPDATE/);
  assert.match(parity, /prismaRepository\.messageUpdate\.create/);
  assert.match(metaStatus, /case 'SERVER_ACK':[\s\S]*return 'sent'/);
  assert.match(metaStatus, /case 'DELIVERY_ACK':[\s\S]*return 'delivered'/);
  assert.match(metaStatus, /case 'READ':[\s\S]*return 'read'/);
});

test('Zapo native receipt alias produces delivery without fabricating read progression', () => {
  assert.equal(callContract.normalizeZapoReceiptStatusForParity('receipt'), 'delivered');
  assert.equal(callContract.normalizeZapoReceiptStatusForParity('RECEIPT'), 'delivered');
  assert.equal(callContract.normalizeZapoReceiptStatusForParity('read'), 'read');
  assert.equal(callContract.normalizeZapoReceiptStatusForParity('played'), 'played');
});

test('Zapo call lifecycle exposes provider-independent states while preserving raw fields', () => {
  assert.equal(callContract.canonicalizeZapoCallStatus('state', { state: 'CALLING' }), 'ringing');
  assert.equal(callContract.canonicalizeZapoCallStatus('state', { state: 'OFFER_RECEIVED' }), 'ringing');
  assert.equal(callContract.canonicalizeZapoCallStatus('state', { state: 'CONNECTED' }), 'answered');
  assert.equal(callContract.canonicalizeZapoCallStatus('state', { state: 'REJECTED' }), 'rejected');
  assert.equal(callContract.canonicalizeZapoCallStatus('state', { state: 'FAILED' }), 'failed');

  assert.equal(
    callContract.canonicalizeZapoCallStatus('ended', {
      direction: 'incoming',
      stateData: { state: 'ENDED', reason: 'TIMEOUT' },
    }),
    'missed',
  );
  assert.equal(
    callContract.canonicalizeZapoCallStatus('ended', {
      direction: 'outgoing',
      stateData: { state: 'ENDED', reason: 'TIMEOUT' },
    }),
    'unanswered',
  );
  assert.equal(
    callContract.canonicalizeZapoCallStatus('ended', {
      stateData: { state: 'ENDED', reason: 'ANSWERED_ON_OTHER_DEVICE' },
    }),
    'answered_elsewhere',
  );

  const payload = callContract.normalizeZapoCallWebhook({
    action: 'state',
    provider: 'WHATSAPP-ZAPO',
    call: {
      callId: 'call-1',
      direction: 'incoming',
      state: 'CONNECTED',
      stateData: { state: 'CONNECTED' },
    },
  });

  assert.equal(payload.action, 'state');
  assert.equal(payload.provider, 'WHATSAPP-ZAPO');
  assert.equal(payload.call.callId, 'call-1');
  assert.equal(payload.call.state, 'CONNECTED');
  assert.equal(payload.call.status, 'answered');
  assert.equal(payload.call.providerState, 'CONNECTED');
  assert.equal(payload.call.terminal, false);
});

test('Zapo live message/status ordering is serialized so receipts cannot overtake media messages', () => {
  assert.match(parity, /private messageWebhookQueue: Promise<void>/);
  assert.match(parity, /private receiptQueue: Promise<void>/);
  assert.match(parity, /const messageBarrier = this\.messageWebhookQueue/);
  assert.match(parity, /await messageBarrier/);
  assert.match(parity, /setImmediate/);
});

test('media parity covers the same primary WhatsApp media families consumed by HUB', () => {
  for (const type of ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
    assert.ok(parity.includes(`'${type}'`), `missing ${type}`);
  }
});
