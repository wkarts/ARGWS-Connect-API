'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts');
const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
const serviceClass = source.statements.find(
  (statement) => ts.isClassDeclaration(statement) && statement.name?.text === 'ZapoStartupService',
);
assert.ok(serviceClass, 'Production ZapoStartupService must be present');

// Run the production methods without booting WhatsApp, Prisma, or external integrations.
const methods = ['persistGroupConversation', 'bindClientEvents'].map((name) => {
  const method = serviceClass.members.find((member) => member.name?.getText(source) === name);
  assert.ok(method && ts.isMethodDeclaration(method), `Production method ${name} must be present`);
  return method.getText(source);
});
const compiled = ts.transpileModule(`class Subject { ${methods.join('\n')} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const Subject = new Function('Events', `${compiled}\nreturn Subject;`)({ GROUPS_UPDATE: 'groups.update' });
const groupJid = '120363000000000000@g.us';

function subjectFor(upsert, instanceId = 'fixture-instance') {
  const subject = new Subject();
  subject.instanceId = instanceId;
  subject.configService = { get: () => ({ SAVE_DATA: { CHATS: true, CONTACTS: false } }) };
  subject.groupIdentities = { resolve: async () => undefined, invalidate() {} };
  subject.persistedGroups = new Map();
  subject.prismaRepository = { chat: { upsert } };
  subject.webhooks = [];
  subject.sendDataWebhook = (...args) => subject.webhooks.push(args);
  return subject;
}

function conflict() {
  return Object.assign(new Error('fixture unique constraint conflict'), {
    code: 'P2002',
    meta: { modelName: 'Chat', target: ['instanceId', 'remoteJid'] },
  });
}

if (process.argv.includes('--message-rejection-probe')) {
  const subject = new Subject();
  const logged = [];
  const unhandled = [];
  const failure = conflict();
  let handled = 0;
  subject.client = new EventEmitter();
  subject.logger = { error: (error) => logged.push(error) };
  subject.handleIncomingMessage = async () => {
    handled += 1;
    throw failure;
  };
  process.on('unhandledRejection', (error) => unhandled.push(error));
  subject.bindClientEvents();
  subject.client.emit('message', { fixture: true });
  setImmediate(() => {
    process.stdout.write(JSON.stringify({
      handled,
      logged: logged.length,
      loggedOriginalError: logged[0] === failure,
      unhandled: unhandled.length,
    }));
  });
} else {
  test('concurrent group creation without metadata settles both calls and creates one scoped chat', async () => {
    const rows = new Map();
    const calls = [];
    let initialReads = 0;
    let releaseReads;
    const bothReadMissing = new Promise((resolve) => { releaseReads = resolve; });

    const subject = subjectFor(async (args) => {
      calls.push(args);
      const key = JSON.stringify(args.where.instanceId_remoteJid);
      const existing = rows.get(key);
      if (existing) return Object.assign(existing, args.update);

      // Simulate Prisma's read/create fallback: both readers see the row absent.
      initialReads += 1;
      if (initialReads === 2) releaseReads();
      await bothReadMissing;
      if (rows.has(key)) throw conflict();
      const row = { id: 'fixture-chat', ...args.create };
      rows.set(key, row);
      return row;
    });

    await Promise.all([
      subject.persistGroupConversation(groupJid),
      subject.persistGroupConversation(groupJid),
    ]);

    assert.equal(rows.size, 1);
    assert.equal(calls.length, 3);
    assert.equal(initialReads, 2);
    assert.deepEqual(calls[2], calls[1], 'The retry must preserve the original where, update, and create');
    assert.deepEqual(calls[0].where, {
      instanceId_remoteJid: { instanceId: 'fixture-instance', remoteJid: groupJid },
    });
    assert.deepEqual(calls[0].update, {});
    assert.equal([...rows.values()][0].name, 'Grupo WhatsApp');
    assert.equal(subject.webhooks.length, 0);
  });

  test('missing metadata preserves the existing group name after a concurrent insert', async () => {
    const existing = { id: 'fixture-chat', name: 'Existing group subject' };
    const calls = [];
    const subject = subjectFor(async (args) => {
      calls.push(args);
      if (calls.length === 1) throw conflict();
      return Object.assign(existing, args.update);
    });

    await subject.persistGroupConversation(groupJid);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], calls[0]);
    assert.deepEqual(calls[1].update, {});
    assert.equal(existing.name, 'Existing group subject');
    assert.equal(subject.persistedGroups.size, 0);
    assert.equal(subject.webhooks.length, 0);
  });

  test('retrying chat persistence does not repeat the contact write or group webhook', async () => {
    const info = { subject: 'Group subject', avatar: 'https://example.invalid/group.png' };
    let chatCalls = 0;
    const contactCalls = [];
    const subject = subjectFor(async () => {
      chatCalls += 1;
      if (chatCalls === 1) throw conflict();
      return { id: 'fixture-chat' };
    });
    subject.configService = { get: () => ({ SAVE_DATA: { CHATS: true, CONTACTS: true } }) };
    subject.prismaRepository.contact = { upsert: async (args) => { contactCalls.push(args); } };

    await subject.persistGroupConversation(groupJid, info);

    assert.equal(chatCalls, 2);
    assert.equal(contactCalls.length, 1);
    assert.equal(subject.webhooks.length, 1);
    assert.deepEqual(contactCalls[0].where, {
      remoteJid_instanceId: { remoteJid: groupJid, instanceId: 'fixture-instance' },
    });
    assert.equal(subject.persistedGroups.get(groupJid), info);
  });

  test('non-unique database errors propagate without a retry', async () => {
    const failure = Object.assign(new Error('fixture database unavailable'), { code: 'P1001' });
    let calls = 0;
    const subject = subjectFor(async () => { calls += 1; throw failure; });

    await assert.rejects(subject.persistGroupConversation(groupJid), (error) => error === failure);

    assert.equal(calls, 1);
    assert.equal(subject.webhooks.length, 0);
  });

  test('a second unique conflict propagates after exactly one retry', async () => {
    const failures = [conflict(), conflict()];
    let calls = 0;
    const subject = subjectFor(async () => { throw failures[calls++]; });

    await assert.rejects(subject.persistGroupConversation(groupJid), (error) => error === failures[1]);

    assert.equal(calls, 2);
    assert.equal(subject.webhooks.length, 0);
  });

  test('a different database failure on the retry propagates unchanged', async () => {
    const failure = Object.assign(new Error('fixture database unavailable'), { code: 'P1001' });
    let calls = 0;
    const subject = subjectFor(async () => {
      calls += 1;
      throw calls === 1 ? conflict() : failure;
    });

    await assert.rejects(subject.persistGroupConversation(groupJid), (error) => error === failure);

    assert.equal(calls, 2);
  });

  test('the message callback observes rejected work and logs the original error once', () => {
    // Isolate the regression probe so a pre-fix unhandled rejection cannot leak into node:test.
    const result = spawnSync(process.execPath, [__filename, '--message-rejection-probe'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      handled: 1,
      logged: 1,
      loggedOriginalError: true,
      unhandled: 0,
    });
  });
}
