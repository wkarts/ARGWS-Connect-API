'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTs(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(output, { module: loaded, exports: loaded.exports });
  return loaded.exports;
}

const contract = loadTs('src/api/integrations/channel/whatsapp/zapo.call-contract.helpers.ts');
const manager = loadTs('manager/src/services/normalizers.ts');

function loadCallActions() {
  const file = path.join(root, 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts');
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ZapoStartupService');
  assert.ok(service, 'ZapoStartupService must exist');
  const names = new Set(['endCall', 'rejectCall', 'normalizeCall']);
  const methods = service.members.filter(node => ts.isMethodDeclaration(node) && names.has(node.name.getText(ast)));
  assert.equal(methods.length, names.size, 'Load the actual service actions and normalizer');
  const output = ts.transpileModule(`export class CallActions { ${methods.map(node => node.getText(ast)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(output, { module: loaded, exports: loaded.exports });
  return loaded.exports.CallActions;
}

const CallActions = loadCallActions();

function callActionFixture(action, fail = false) {
  const callId = 'provider-call';
  const call = { callId, peerJid: 'opaque@lid', stateData: { state: 'ringing' } };
  const liveCalls = new Map([[callId, call]]);
  const service = new CallActions();
  service.ensureConnected = async () => {};
  service.ensureVoip = () => {};
  service.callMuteStates = new Map([[callId, true]]);
  service.outgoingCallPeers = new Map([[callId, '5511999999999@s.whatsapp.net']]);
  service.toJson = value => JSON.parse(JSON.stringify(value));
  service.client = { voip: {
    getCall: id => liveCalls.get(id) ?? null,
    [action]: async id => {
      assert.equal(id, callId);
      if (fail) throw new Error('Provider signaling failed');
      call.stateData.state = 'ended';
      call.stateData.endReason = action === 'rejectCall' ? 'declined' : 'user_ended';
      liveCalls.delete(id);
    },
  } };
  return { service, callId, call, liveCalls };
}

for (const action of ['endCall', 'rejectCall']) {
  test(`${action} returns the completed provider state even when the provider removes its live call`, async () => {
    const { service, callId, liveCalls } = callActionFixture(action);
    const result = await service[action](callId);
    assert.equal(liveCalls.size, 0);
    assert.equal(result.state, 'ended');
    assert.equal(result.stateData.state, 'ended');
    assert.equal(result.stateData.endReason, action === 'rejectCall' ? 'declined' : 'user_ended');
    assert.equal(result.peerJid, '5511999999999@s.whatsapp.net');
    assert.equal(result.muted, true);
    assert.equal(service.callMuteStates.has(callId), false);
    assert.equal(service.outgoingCallPeers.has(callId), false);
  });

  test(`${action} propagates provider failure without clearing call metadata or fabricating an ended state`, async () => {
    const { service, callId, call, liveCalls } = callActionFixture(action, true);
    await assert.rejects(service[action](callId), /Provider signaling failed/);
    assert.equal(call.stateData.state, 'ringing');
    assert.equal(liveCalls.has(callId), true);
    assert.equal(service.callMuteStates.get(callId), true);
    assert.equal(service.outgoingCallPeers.get(callId), '5511999999999@s.whatsapp.net');
  });
}

test('actual VoIP 1.0.0 lifecycle states reach Manager with meaningful nonterminal status', () => {
  // Values from @innovatorssoft/voip 1.0.0 CallState; retain its raw stateData.
  for (const [state, expected] of [
    ['initiating', 'ringing'],
    ['ringing', 'ringing'],
    ['incoming_ringing', 'ringing'],
    ['connecting', 'answered'],
    ['active', 'answered'],
    ['on_hold', 'answered'],
  ]) {
    const snapshot = contract.normalizeZapoCallSnapshot({ callId: 'live', stateData: { state } });
    assert.equal(snapshot.status, expected, state);
    assert.equal(snapshot.stateData.state, state);
    assert.equal(snapshot.terminal, false);
    const [call] = manager.calls([snapshot]);
    assert.equal(call.state, expected);
    assert.equal(manager.isCallActive(call), true);
  }
});

test('accepted_elsewhere is terminal only for that call and preserves the provider reason', () => {
  const payload = contract.normalizeZapoCallWebhook({
    action: 'ended',
    call: { callId: 'companion', state: 'ended', stateData: { state: 'ended', endReason: 'accepted_elsewhere' } },
  });
  assert.equal(payload.call.status, 'answered_elsewhere');
  assert.equal(payload.call.providerReason, 'accepted_elsewhere');
  assert.equal(payload.call.stateData.endReason, 'accepted_elsewhere');
  assert.equal(payload.call.terminal, true);

  const live = contract.normalizeZapoCallSnapshot({ callId: 'other-call', stateData: { state: 'active' } });
  const calls = manager.calls([payload.call, live]);
  assert.equal(calls[0].state, 'answered_elsewhere');
  assert.equal(calls.filter(manager.isCallActive).length, 1);
  assert.equal(calls.filter(manager.isCallActive)[0].callId, 'other-call');
});

test('VoIP terminal reasons remain distinct in API snapshots and disappear from active Manager calls', () => {
  for (const [reason, direction, expected] of [
    ['declined', 'incoming', 'rejected'],
    ['busy', 'outgoing', 'rejected'],
    ['do_not_disturb', 'outgoing', 'rejected'],
    ['failed', 'outgoing', 'failed'],
    ['timeout', 'incoming', 'missed'],
    ['timeout', 'outgoing', 'unanswered'],
    ['user_ended', 'incoming', 'ended'],
    ['cancelled', 'outgoing', 'ended'],
  ]) {
    const snapshot = contract.normalizeZapoCallSnapshot({
      callId: reason, direction, state: 'ended', stateData: { state: 'ended', endReason: reason },
    });
    assert.equal(snapshot.status, expected);
    assert.equal(snapshot.terminal, true);
    const [call] = manager.calls([snapshot]);
    assert.equal(call.state, expected);
    assert.equal(manager.isCallActive(call), false);
  }
});

test('Manager respects explicit terminal snapshots and keeps older active responses usable', () => {
  const calls = manager.calls([
    { callId: 'terminal-flag', state: 'ringing', terminal: true },
    { callId: 'canonical-terminal', state: 'ringing', status: 'answered_elsewhere', terminal: true },
    { callId: 'legacy-live', state: 'active' },
    { callId: 'unknown-canonical', state: 'ringing', status: 'unknown' },
    { callId: 'legacy-ended', state: 'ENDED' },
  ]);
  assert.equal(calls[1].state, 'answered_elsewhere');
  assert.equal(calls[2].state, 'active');
  assert.equal(calls[3].state, 'ringing');
  assert.equal(JSON.stringify(calls.filter(manager.isCallActive).map(call => call.callId)),
    JSON.stringify(['legacy-live', 'unknown-canonical']));
});
