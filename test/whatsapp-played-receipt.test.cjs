'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function load(relative, overrides = {}) {
  const code = ts.transpileModule(read(relative), {
    fileName: relative,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      throw new Error('Unexpected dependency ' + name);
    },
  }, { filename: relative });
  return module.exports;
}

test('public PLAYED endpoint is additive and keeps markMessageAsRead untouched', () => {
  const router = read('src/api/routes/chat.router.ts');
  const controller = read('src/api/controllers/chat.controller.ts');
  const dto = read('src/api/dto/chat.dto.ts');
  const schema = read('src/validate/chat.schema.ts');

  assert.match(router, /routerPath\('markMessageAsRead'\)/);
  assert.match(router, /routerPath\('markMessageAsPlayed'\)/);
  assert.match(router, /schema: playedMessageSchema/);
  assert.match(controller, /markMessageAsPlayed\(data\)/);
  assert.match(dto, /class PlayedMessageDto/);
  assert.match(dto, /participant\?: string/);
  assert.match(schema, /fromMe: \{ type: 'boolean', enum: \[false\] \}/);
  assert.match(schema, /required: \['id', 'fromMe', 'remoteJid'\]/);
});

test('Baileys PLAYED uses native receipt and never aliases playback to readMessages', () => {
  const source = read('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts');
  const start = source.indexOf('public async markMessageAsPlayed');
  const end = source.indexOf('\n  public async ', start + 10);
  const method = source.slice(start, end < 0 ? source.length : end);

  assert.ok(start >= 0);
  assert.match(method, /sendReceipts\(keys, 'played'\)/);
  assert.doesNotMatch(method, /readMessages\(/);
  assert.match(method, /message\?\.fromMe !== false/);
  assert.match(method, /participant/);

  const readStart = source.indexOf('public async markMessageAsRead');
  const readEnd = source.indexOf('\n  public async ', readStart + 10);
  const readMethod = source.slice(readStart, readEnd);
  assert.match(readMethod, /this\.client\.readMessages\(keys\)/);
});

test('ZAPO PLAYED uses the native receipt type and keeps group participant', () => {
  const source = read('src/api/integrations/channel/whatsapp/zapo.provider.account.extensions.ts');
  const start = source.indexOf('public async markMessageAsPlayed');
  const end = source.indexOf('\n  public async ', start + 10);
  const method = source.slice(start, end < 0 ? source.length : end);

  assert.ok(start >= 0);
  assert.match(method, /type: 'played'/);
  assert.match(method, /participant: group\.participant/);
  assert.match(method, /remoteJid\.endsWith\('@g\.us'\)/);
  assert.doesNotMatch(method, /type: 'read'/);
});

test('media download and history paths never infer PLAYED', () => {
  const baileys = read('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts');
  const zapo = read('src/api/integrations/channel/whatsapp/zapo.provider.account.extensions.ts');

  const baileysMediaStart = baileys.indexOf('public async getBase64FromMediaMessage');
  const baileysMediaEnd = baileys.indexOf('\n  public async ', baileysMediaStart + 10);
  const baileysMedia = baileys.slice(baileysMediaStart, baileysMediaEnd);
  assert.doesNotMatch(baileysMedia, /sendReceipts|played|markMessageAsPlayed/);

  const zapoMediaStart = zapo.indexOf('public async getBase64FromMediaMessage');
  const zapoMediaEnd = zapo.indexOf('\n  public async ', zapoMediaStart + 10);
  const zapoMedia = zapo.slice(zapoMediaStart, zapoMediaEnd);
  assert.doesNotMatch(zapoMedia, /sendReceipt|played|markMessageAsPlayed/);
});

test('local PLAYED persistence is idempotent and does not regress deleted messages', async () => {
  const Events = { MESSAGES_UPDATE: 'messages.update' };
  const { persistPlayedReceipt } = load(
    'src/api/integrations/channel/whatsapp/played-receipt.helper.ts',
    {
      '@api/types/wa.types': { Events },
      '@utils/prismaJsonPath': { prismaJsonPath: (field) => [field] },
    },
  );

  const stored = { id: 'db-message', status: 'READ' };
  const updates = [];
  const emitted = [];
  const repository = {
    message: {
      async findFirst() { return stored; },
      async update({ data }) { Object.assign(stored, data); return stored; },
    },
    messageUpdate: {
      async findFirst({ where }) {
        return updates.find((item) =>
          item.instanceId === where.instanceId &&
          item.messageId === where.messageId &&
          item.keyId === where.keyId &&
          item.status === where.status
        ) || null;
      },
      async create({ data }) { updates.push({ ...data }); return data; },
    },
  };
  const key = {
    id: 'MSG-1',
    remoteJid: '5575988881111@s.whatsapp.net',
    fromMe: false,
  };

  const first = await persistPlayedReceipt(repository, 'instance-1', key, true, (event, data) => {
    emitted.push({ event, data });
  });
  const second = await persistPlayedReceipt(repository, 'instance-1', key, true, (event, data) => {
    emitted.push({ event, data });
  });

  assert.equal(first.persisted, true);
  assert.equal(first.changed, true);
  assert.equal(second.persisted, true);
  assert.equal(second.changed, false);
  assert.equal(stored.status, 'PLAYED');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'PLAYED');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, Events.MESSAGES_UPDATE);

  stored.status = 'DELETED';
  const deleted = await persistPlayedReceipt(
    repository,
    'instance-1',
    { ...key, id: 'MSG-2' },
    true,
    () => { throw new Error('deleted message must not emit PLAYED'); },
  );
  assert.equal(deleted.persisted, true);
  assert.equal(deleted.changed, false);
  assert.equal(stored.status, 'DELETED');
});
