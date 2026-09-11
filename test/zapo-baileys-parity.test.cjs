'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const parity = fs.readFileSync('src/api/integrations/channel/whatsapp/zapo.parity.extensions.ts', 'utf8');
const channel = fs.readFileSync('src/api/integrations/channel/channel.controller.ts', 'utf8');
const baileys = fs.readFileSync('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts', 'utf8');
const metaStatus = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-status.mapper.ts', 'utf8');
const sdk = require('@innovatorssoft/zapo-js');

test('Zapo parity is an additive provider layer and leaves Baileys as the reference implementation', () => {
  assert.match(channel, /ZapoParityStartupService/);
  assert.match(channel, /return new ZapoParityStartupService\(/);
  assert.match(channel, /return new BaileysStartupService\(/);
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
