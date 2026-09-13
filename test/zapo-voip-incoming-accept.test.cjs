'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

// Run the installed provider's actual managers, sessions, builders, protobuf
// call-key encoding/parsing and SRTP setup. Network, native audio/relay and Signal
// encryption are simulated: this is a signaling regression, not a real call test.
const packageRoot = process.env.ARGWS_VOIP_PACKAGE_ROOT
  ? path.resolve(process.env.ARGWS_VOIP_PACKAGE_ROOT)
  : path.resolve(path.dirname(require.resolve('@innovatorssoft/voip')), '..');
const dist = path.join(packageRoot, 'dist');

class MediaRelay extends EventEmitter {
  connected = false;
  configurations = 0;
  hasConnection() { return this.connected; }
  setSubscriptionSsrc() {}
  resendSubscriptions() {}
  setSsrc() {}
  async configureRelays() { this.configurations++; }
  getConnectedCount() { return this.connected ? 1 : 0; }
  connect() { this.connected = true; this.emit('relay_connected'); }
  cleanup() { this.connected = false; this.removeAllListeners(); }
}

class AudioEngine {
  playbackStarts = 0;
  captureStarts = 0;
  setAudioSender() {}
  setOnAudioFinished() {}
  startPlayback() { this.playbackStarts++; }
  startCapture() { this.captureStarts++; }
  stop() {}
  static feedWatermarksMs() { return { pauseMs: 1000, resumeMs: 500 }; }
}

function loadProvider() {
  const originalLoad = Module._load;
  Module._load = function loadWithNativeFakes(request, parent, isMain) {
    if (parent?.filename.startsWith(`${dist}${path.sep}`)) {
      if (request.endsWith('/WaSctpRelay.js')) return { WaSctpRelay: MediaRelay };
      if (request.endsWith('/WaAudioEngine.js')) return { WaAudioEngine: AudioEngine };
      if (request.endsWith('/mlow-codec.js')) {
        return {
          MLowCodec: {
            async create() {
              return { destroy() {}, getStats: () => ({ success: 0, errors: 0 }), getFrameSize: () => 960 };
            },
          },
        };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      ...require(path.join(dist, 'call/WaCallManager.js')),
      ...require(path.join(dist, 'signaling/bridge.js')),
    };
  } finally {
    Module._load = originalLoad;
  }
}

const { WaCallManager, routeCallStanza } = loadProvider();
const { createNoopLogger } = require('zapo-js');
const { parseSignalAddressFromJid, toUserJid } = require('zapo-js/protocol');

const A = { pn: '5511990000001@s.whatsapp.net', lid: '111111111111111@lid' };
const B = { pn: '5511990000002@s.whatsapp.net', lid: '222222222222222@lid' };
const device = (jid, index) => jid.replace('@', `:${index}@`);
const messages = (context, tag) => context.sent.filter(node => node.tag === 'call' && node.content?.[0]?.tag === tag);
const tagOf = node => node.tag === 'call' ? node.content?.[0]?.tag : node.tag;

function signalEnvelope(sender, recipient, plaintext) {
  // Deliberately NOT cryptography. Bind bytes to the exact sender and recipient
  // Signal address so device 0 cannot decrypt ciphertext for device 3 (or vice versa).
  return {
    type: 'msg',
    ciphertext: new Uint8Array(Buffer.from(JSON.stringify({
      sender, recipient, plaintext: Buffer.from(plaintext).toString('base64'),
    }))),
  };
}

function makeEndpoint(account, index, mode, creatorIndex) {
  const wireJid = device(account[mode], index);
  const creator = creatorIndex === undefined ? account[mode] : device(account[mode], creatorIndex);
  const context = { wireJid, sent: [], states: [], ended: [], synced: [], encrypted: [], decrypted: [] };
  const logger = createNoopLogger();
  const deps = {
    authClient: {
      getCurrentCredentials: () => ({
        // Account-level call-creator is valid metadata; the transport sender can
        // still be a companion. The accept must use wireJid's device, not metadata.
        meJid: mode === 'pn' ? creator : device(account.pn, creatorIndex ?? index),
        meLid: mode === 'lid' ? creator : undefined,
      }),
    },
    lowLevelCoordinator: { async sendNode(node) { context.sent.push(node); } },
    messageDispatch: { async syncSignalSession(jid) { context.synced.push(jid); } },
    signalDeviceSync: {
      async resolveUserJidPair(jid) {
        const base = toUserJid(jid);
        const owner = [A, B].find(candidate => [candidate.pn, candidate.lid].includes(base));
        return { pnJid: owner?.pn, lidJid: owner?.lid };
      },
      async queryLidsByPhoneJids(jids) {
        return jids.map(jid => ({
          pnJid: toUserJid(jid),
          lidJid: mode === 'lid' ? [A, B].find(candidate => candidate.pn === toUserJid(jid))?.lid : undefined,
        }));
      },
      async syncDeviceList(jids) {
        return jids.map(jid => ({ jid, deviceJids: [device(B[mode], 0), device(B[mode], 6)] }));
      },
    },
    sessionResolver: {
      async ensureSessionsBatch(jids) {
        return jids.map(jid => ({ address: parseSignalAddressFromJid(jid), session: {} }));
      },
    },
    signalProtocol: {
      async encryptMessagesBatch(entries) {
        return entries.map(({ address, plaintext }) =>
          signalEnvelope(parseSignalAddressFromJid(wireJid), address, plaintext));
      },
      async encryptMessage(address, plaintext) {
        context.encrypted.push(address);
        return signalEnvelope(parseSignalAddressFromJid(wireJid), address, plaintext);
      },
      async decryptMessage(address, encrypted) {
        const envelope = JSON.parse(Buffer.from(encrypted.ciphertext).toString());
        assert.deepEqual(envelope.recipient, parseSignalAddressFromJid(wireJid), 'Signal recipient/device mismatch');
        assert.deepEqual(envelope.sender, address, 'Signal sender/device mismatch');
        context.decrypted.push({ sender: address, recipient: envelope.recipient });
        return new Uint8Array(Buffer.from(envelope.plaintext, 'base64'));
      },
    },
  };
  const manager = new WaCallManager({
    deps, logger, maxConcurrentCalls: 1,
    stores: { privacyToken: { async getByJid() { return null; } } },
  });
  manager.on('call_state', info => context.states.push(info.stateData.state));
  manager.on('call_ended', info => context.ended.push(info.stateData.endReason));
  Object.assign(context, { deps, manager, logger });
  return context;
}

async function setup(t, { mode = 'lid', callerDevice = 3, creatorDevice } = {}) {
  const caller = makeEndpoint(A, callerDevice, mode, creatorDevice);
  const receiver = makeEndpoint(B, 6, mode, 6);
  const phone = makeEndpoint(B, 0, mode, 0);
  const endpoints = [caller, receiver, phone];
  t.after(() => endpoints.forEach(endpoint => endpoint.manager.destroy()));
  for (const endpoint of endpoints) {
    endpoint.deps.lowLevelCoordinator.sendNode = async node => {
      endpoint.sent.push(node);
      const tag = tagOf(node);
      // Simulate transport fan-out for the real offer and exact device routing
      // for accepts. An account-addressed accept is not delivered to companion 3.
      const destinations = tag === 'offer' ? [receiver, phone]
        : ['accept', 'terminate'].includes(tag)
          ? endpoints.filter(target => {
            try {
              return JSON.stringify(parseSignalAddressFromJid(node.attrs.to)) ===
                JSON.stringify(parseSignalAddressFromJid(target.wireJid));
            } catch { return false; }
          }) : [];
      for (const target of destinations) {
        const incoming = { ...node, attrs: { ...node.attrs, from: endpoint.wireJid } };
        await routeCallStanza(target.manager, target.deps, incoming, target.logger);
      }
    };
  }
  const callId = await caller.manager.startCall({ peerJid: B[mode] });
  assert.equal(caller.manager.getCall(callId).stateData.state, 'ringing');
  assert.equal(receiver.manager.getCall(callId).stateData.state, 'incoming_ringing');
  assert.equal(phone.manager.getCall(callId).stateData.state, 'incoming_ringing');
  assert.deepEqual(receiver.manager.getCall(callId).encryptionKey, caller.manager.getCall(callId).encryptionKey);
  assert.equal(receiver.manager.getCall(callId).encryptionKey.length, 32);
  const session = receiver.manager.getSessionOrThrow(callId);
  receiver.sent.length = 0;
  return { caller, receiver, phone, callId, session };
}

function terminal(from, callId) {
  return {
    tag: 'call', attrs: { from, id: `remote-end-${callId}` },
    content: [{ tag: 'terminate', attrs: { 'call-id': callId, reason: 'user_ended' } }],
  };
}

function holdMethod(object, method, predicate = () => true) {
  let started;
  let release;
  const entered = new Promise(resolve => { started = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const original = object[method];
  object[method] = async (...args) => {
    if (predicate(...args)) { started(); await released; }
    return original.apply(object, args);
  };
  return { entered, release };
}

for (const mode of ['lid', 'pn']) {
  for (const creatorDevice of [undefined, 0]) {
    test(`${mode.toUpperCase()} companion answer reaches caller device 3 with ${creatorDevice === 0 ? 'device-0' : 'bare'} call-creator`, async t => {
      const { caller, receiver, phone, callId } = await setup(t, { mode, creatorDevice });
      const creator = receiver.manager.getCall(callId).callCreator;
      assert.notEqual(creator, caller.wireJid);
      await receiver.manager.acceptCall(callId);

      const accepts = messages(receiver, 'accept');
      assert.equal(accepts.length, 1);
      assert.equal(accepts[0].attrs.to, caller.wireJid, 'answer must address the originating companion');
      assert.equal(accepts[0].content[0].attrs['call-creator'], creator, 'call metadata must be preserved');
      assert.deepEqual(receiver.synced, [caller.wireJid]);
      assert.deepEqual(receiver.encrypted, [parseSignalAddressFromJid(caller.wireJid)]);
      assert.equal(caller.decrypted.length, 1, 'caller must actually decrypt the real accept payload');
      assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
      assert.equal(receiver.manager.getCall(callId).stateData.state, 'connecting');
      assert.equal(phone.manager.getCall(callId), null, 'sibling phone must stop ringing');
      assert.deepEqual(phone.ended, ['accepted_elsewhere']);
      assert.deepEqual(messages(caller, 'terminate').map(node => parseSignalAddressFromJid(node.attrs.to)),
        [parseSignalAddressFromJid(phone.wireJid)]);
      assert.equal(receiver.ended.length, 0, 'winner must remain connected');
    });
  }

  test(`${mode.toUpperCase()} device-0 mobile caller remains able to receive the companion answer`, async t => {
    const { caller, receiver, phone, callId } = await setup(t, { mode, callerDevice: 0, creatorDevice: 0 });
    await receiver.manager.acceptCall(callId);
    assert.deepEqual(parseSignalAddressFromJid(messages(receiver, 'accept')[0].attrs.to),
      parseSignalAddressFromJid(caller.wireJid));
    assert.equal(caller.decrypted.length, 1);
    assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
    assert.equal(phone.manager.getCall(callId), null);
  });
}

for (const stage of ['sync', 'encrypt', 'send']) {
  test(`${stage} failure rejects local answer without publishing connecting and permits retry`, async t => {
    const { caller, receiver, phone, callId } = await setup(t);
    const object = stage === 'sync' ? receiver.deps.messageDispatch
      : stage === 'encrypt' ? receiver.deps.signalProtocol : receiver.deps.lowLevelCoordinator;
    const method = stage === 'sync' ? 'syncSignalSession' : stage === 'encrypt' ? 'encryptMessage' : 'sendNode';
    const original = object[method];
    object[method] = async (...args) => {
      if (stage !== 'send' || tagOf(args[0]) === 'accept') throw new Error(`simulated ${stage} failure`);
      return original.apply(object, args);
    };
    await assert.rejects(receiver.manager.acceptCall(callId), /failure/);
    assert.equal(receiver.manager.getCall(callId).stateData.state, 'incoming_ringing');
    assert.ok(!receiver.states.includes('connecting'));
    assert.equal(receiver.manager.getCall(callId).stateData.acceptedAt, undefined);
    assert.equal(caller.manager.getCall(callId).stateData.state, 'ringing');
    assert.equal(phone.manager.getCall(callId).stateData.state, 'incoming_ringing');
    object[method] = original;
    await receiver.manager.acceptCall(callId);
    assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
    assert.equal(receiver.manager.getCall(callId).stateData.state, 'connecting');
  });
}

for (const size of [undefined, 0, 31, 33]) {
  test(`missing or invalid ${size ?? 'undefined'}-byte key cannot report an accepted call`, async t => {
    const { receiver, session, callId } = await setup(t);
    session.info.encryptionKey = size === undefined ? undefined : new Uint8Array(size);
    await assert.rejects(receiver.manager.acceptCall(callId));
    assert.equal(session.info.stateData.state, 'incoming_ringing');
    assert.ok(!receiver.states.includes('connecting'));
    assert.equal(messages(receiver, 'accept').length, 0);
    assert.equal(receiver.encrypted.length, 0);
  });
}

test('concurrent local answers share one pending accept and one state transition', { timeout: 2000 }, async t => {
  const { receiver, callId } = await setup(t);
  const gate = holdMethod(receiver.deps.messageDispatch, 'syncSignalSession');
  const first = receiver.manager.acceptCall(callId);
  await gate.entered;
  const second = receiver.manager.acceptCall(callId);
  const outcomes = Promise.allSettled([first, second]);
  gate.release();
  assert.deepEqual((await outcomes).map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(messages(receiver, 'accept').length, 1);
  assert.equal(receiver.states.filter(state => state === 'connecting').length, 1);
});

for (const stage of ['sync', 'encrypt', 'send']) {
  for (const interrupter of ['remote end', 'own smartphone']) {
    test(`${interrupter} during ${stage} prevents a late local accept from resurrecting the session`, { timeout: 2000 }, async t => {
      const { caller, receiver, callId, session } = await setup(t);
      const object = stage === 'sync' ? receiver.deps.messageDispatch
        : stage === 'encrypt' ? receiver.deps.signalProtocol : receiver.deps.lowLevelCoordinator;
      const method = stage === 'sync' ? 'syncSignalSession' : stage === 'encrypt' ? 'encryptMessage' : 'sendNode';
      const gate = holdMethod(object, method, (...args) => stage !== 'send' || tagOf(args[0]) === 'accept');
      const accepting = receiver.manager.acceptCall(callId);
      const outcome = Promise.allSettled([accepting]);
      await gate.entered;
      if (interrupter === 'remote end') {
        await receiver.manager.handleCallTerminate(terminal(caller.wireJid, callId));
      } else {
        // This fixture represents the external smartphone event only. The main
        // API-to-API path above always builds accept via the real acceptCall().
        const from = device(B.lid, 0);
        await receiver.manager.handleCallAccept({
          tag: 'call', attrs: { from, id: `phone-accept-${callId}` },
          content: [{ tag: 'accept', attrs: { 'call-id': callId } }],
        }, from);
      }
      const sentBeforeRelease = receiver.sent.length;
      gate.release();
      await outcome;
      assert.equal(receiver.manager.getCall(callId), null);
      assert.equal(session.info.stateData.state, 'ended');
      assert.equal(receiver.states.at(-1), 'ended');
      assert.ok(!receiver.states.includes('connecting'));
      assert.equal(receiver.ended.length, 1);
      // A send already in flight cannot be unsent, but later transport/media
      // signaling must stop. During construction no accept may be sent at all.
      const late = receiver.sent.slice(sentBeforeRelease);
      assert.equal(late.filter(node => ['transport', 'mute_v2'].includes(tagOf(node))).length, 0);
      if (stage !== 'send') assert.equal(late.filter(node => tagOf(node) === 'accept').length, 0);
      assert.equal(session.audioEngine.captureStarts, 0);
    });
  }
}

test('relay connected before accept send completes becomes active only after successful signaling', { timeout: 2000 }, async t => {
  const { receiver, session, callId } = await setup(t);
  const gate = holdMethod(receiver.deps.lowLevelCoordinator, 'sendNode', node => tagOf(node) === 'accept');
  const accepting = receiver.manager.acceptCall(callId);
  await gate.entered;
  session.sctpRelay.connect();
  const stateBeforeSend = session.info.stateData.state;
  const captureBeforeSend = session.audioEngine.captureStarts;
  gate.release();
  await accepting;
  assert.equal(stateBeforeSend, 'incoming_ringing', 'relay readiness alone does not acknowledge the call');
  assert.equal(captureBeforeSend, 0);
  assert.equal(session.info.stateData.state, 'active');
  assert.deepEqual(receiver.states.slice(-2), ['connecting', 'active']);
  assert.equal(session.audioEngine.captureStarts, 1);
  assert.equal(session.audioEngine.playbackStarts, 1);
});
