'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

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
const { decodeBinaryNodeStanza, encodeBinaryNodeStanza } = require('zapo-js/transport');
const { buildAcceptStanza, encodeWAMessage } = require(path.join(dist, 'signaling/signaling.js'));

const A = { pn: '5511990000001@s.whatsapp.net', lid: '111111111111111@lid' };
const B = { pn: '5511990000002@s.whatsapp.net', lid: '222222222222222@lid' };
const device = (jid, index) => jid.replace('@', `:${index}@`);
const messages = (context, tag) => context.sent.filter(node => node.tag === 'call' && node.content?.[0]?.tag === tag);
const tagOf = node => node.tag === 'call' ? node.content?.[0]?.tag : node.tag;

// The answer acknowledges the media key delivered in the encrypted offer; it
// does not deliver another key. Independent wire-format reference:
// https://github.com/oxidezap/whatsapp-rust/blob/6502b871e35664ffb80044ba7c6317a6427754e2/wacore/src/stanza/call.rs
// The answering facade addresses incoming.from, preserving the caller device:
// https://github.com/oxidezap/whatsapp-rust/blob/6502b871e35664ffb80044ba7c6317a6427754e2/src/voip/facade.rs
// These tests verify address preservation, not delivery by the WhatsApp server.
for (const format of ['cjs', 'esm']) {
  for (const mode of ['lid', 'pn']) {
    for (const video of [false, true]) {
      for (const callerDevice of [null, 0, 18]) {
        test(`${format.toUpperCase()} ${mode.toUpperCase()} ${video ? 'video' : 'audio'} accept preserves ${callerDevice ?? 'bare'} caller address and offer media-key negotiation`, async () => {
          const builder = format === 'cjs' ? buildAcceptStanza :
            (await import(pathToFileURL(path.join(dist, 'esm/signaling/signaling.js')).href)).buildAcceptStanza;
          const peerJid = callerDevice === null ? A[mode] : device(A[mode], callerDevice);
          const callCreator = A[mode];
          const callId = '0123456789ABCDEF0123456789ABCDEF';
          const unexpectedKeyExchange = () => assert.fail('accept must not synchronize Signal or encrypt the offer key again');
          const deps = {
            authClient: { getCurrentCredentials: unexpectedKeyExchange },
            messageDispatch: { syncSignalSession: unexpectedKeyExchange },
            signalProtocol: { encryptMessage: unexpectedKeyExchange },
          };
          const callKey = new Uint8Array(32).fill(0x5a);
          const built = await builder(deps, callId, callKey, peerJid, callCreator, video);
          const decoded = await decodeBinaryNodeStanza(encodeBinaryNodeStanza(built));

          assert.equal(built.attrs.to, peerJid, 'accept must reply to the exact sender of the offer');
          assert.deepEqual(parseSignalAddressFromJid(decoded.attrs.to), parseSignalAddressFromJid(peerJid),
            'the caller device must survive binary serialization');
          assert.match(decoded.attrs.id, /^[A-Fa-f0-9]+$/, 'the wrapper id correlates the server ACK');
          const accept = decoded.content[0];
          assert.equal(accept.tag, 'accept');
          assert.equal(accept.attrs['call-id'], callId);
          assert.equal(accept.attrs['call-creator'], callCreator, 'account metadata must not become a device address');
          assert.deepEqual(accept.content.map(node => node.tag),
            video ? ['audio', 'net', 'encopt', 'video'] : ['audio', 'net', 'encopt']);
          assert.deepEqual(accept.content.find(node => node.tag === 'audio').attrs, { enc: 'opus', rate: '16000' });
          assert.deepEqual(accept.content.find(node => node.tag === 'net').attrs, { medium: '2' });
          assert.deepEqual(accept.content.find(node => node.tag === 'encopt').attrs, { keygen: '2' });
          if (video) assert.deepEqual(accept.content.find(node => node.tag === 'video').attrs, { enc: 'vp8' });
          assert.equal(accept.content.some(node => ['enc', 'device-identity'].includes(node.tag)), false);
          assert.deepEqual(callKey, new Uint8Array(32).fill(0x5a), 'the offer key remains available for SRTP');
        });
      }
    }
  }
}

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
  const wireJid = index === null ? account[mode] : device(account[mode], index);
  const creator = creatorIndex === undefined ? account[mode] : device(account[mode], creatorIndex);
  const context = { wireJid, sent: [], states: [], ended: [], synced: [], encrypted: [], decrypted: [] };
  const logger = createNoopLogger();
  const deps = {
    authClient: {
      getCurrentCredentials: () => ({
        // Account-level call-creator is valid metadata; the transport sender can
        // still be a companion. The encrypted offer must retain the sender device.
        meJid: mode === 'pn' ? creator : device(account.pn, creatorIndex ?? index ?? 0),
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

async function setup(t, { mode = 'lid', callerDevice = 18, creatorDevice } = {}) {
  const caller = makeEndpoint(A, callerDevice, mode, creatorDevice);
  const receiver = makeEndpoint(B, 6, mode, 6);
  const phone = makeEndpoint(B, 0, mode, 0);
  const callerPhone = callerDevice === 0 || callerDevice === null ? caller : makeEndpoint(A, 0, mode, 0);
  const endpoints = [...new Set([caller, callerPhone, receiver, phone])];
  const pending = [];
  const deliveries = [];
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    let count = 0;
    try {
      while (pending.length) {
        assert.ok(count++ < 100, 'signaling queue must settle instead of reflecting control stanzas forever');
        const { target, incoming } = pending.shift();
        deliveries.push({ target: target.wireJid, tag: tagOf(incoming), id: incoming.attrs.id });
        await routeCallStanza(target.manager, target.deps, incoming, target.logger);
      }
    } finally {
      draining = false;
    }
  }
  t.after(() => endpoints.forEach(endpoint => endpoint.manager.destroy()));
  for (const endpoint of endpoints) {
    endpoint.deps.lowLevelCoordinator.sendNode = async node => {
      endpoint.sent.push(node);
      const tag = tagOf(node);
      // Route answers by transport address, never by the target's call state.
      // In this fixture bare/zero identifies the primary; it must not magically
      // reach a companion because that companion happens to own the call.
      // This remains a simulated device network, not a WhatsApp server test.
      const destinations = tag === 'offer' ? [receiver, phone]
        : ['accept', 'terminate', 'relaylatency', 'mute_v2'].includes(tag)
          ? endpoints.filter(target => {
            try {
              // Relay reports fan out to the remote account. Other controls
              // keep their device-addressed routing.
              if (tag === 'relaylatency') return toUserJid(node.attrs.to) === toUserJid(target.wireJid);
              return JSON.stringify(parseSignalAddressFromJid(node.attrs.to)) ===
                JSON.stringify(parseSignalAddressFromJid(target.wireJid));
            } catch { return false; }
          }) : [];
      for (const target of destinations) {
        const incoming = { ...node, attrs: { ...node.attrs, from: endpoint.wireJid } };
        pending.push({ target, incoming });
      }
      await drain();
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
  return { caller, callerPhone, receiver, phone, callId, session, pending, deliveries };
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

test('an external legacy encrypted accept remains supported by the receiver', async t => {
  const { caller, receiver, phone, callId } = await setup(t);
  const call = receiver.manager.getCall(callId);
  const offerKey = new Uint8Array(call.encryptionKey);
  const envelope = signalEnvelope(parseSignalAddressFromJid(receiver.wireJid),
    parseSignalAddressFromJid(caller.wireJid), await encodeWAMessage({ call: { callKey: offerKey } }));
  await routeCallStanza(caller.manager, caller.deps, {
    tag: 'call', attrs: { from: receiver.wireJid, id: 'external-legacy-accept' },
    content: [{
      tag: 'accept', attrs: { 'call-id': callId, 'call-creator': call.callCreator },
      content: [{ tag: 'enc', attrs: { v: '2', type: envelope.type, count: '0' }, content: envelope.ciphertext }],
    }],
  }, caller.logger);
  assert.equal(caller.decrypted.length, 1);
  assert.deepEqual(caller.manager.getCall(callId).encryptionKey, offerKey);
  assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
  assert.equal(phone.manager.getCall(callId), null);
  assert.equal(receiver.manager.getCall(callId).stateData.state, 'incoming_ringing');
});

for (const mode of ['lid', 'pn']) {
  test(`${mode.toUpperCase()} account-only answer reaches the idle primary instead of the originating companion`, async t => {
    const { caller, callerPhone, receiver, phone, callId, deliveries } = await setup(t, { mode });
    const wrongId = `account-only-answer-${mode}`;
    await receiver.deps.lowLevelCoordinator.sendNode({
      tag: 'call', attrs: { to: A[mode], id: wrongId },
      content: [{ tag: 'accept', attrs: { 'call-id': callId, 'call-creator': caller.wireJid } }],
    });
    assert.deepEqual(deliveries.filter(delivery => delivery.id === wrongId).map(delivery => delivery.target),
      [callerPhone.wireJid], 'transport addresses determine the recipient independently of session ownership');
    assert.ok(callerPhone.sent.some(node => node.tag === 'ack' && node.attrs.id === wrongId),
      'an ACK from the primary is not confirmation that the companion received accept');
    assert.equal(callerPhone.manager.getCall(callId), null, 'the primary did not originate this call');
    assert.equal(caller.manager.getCall(callId).stateData.state, 'ringing');
    assert.equal(phone.manager.getCall(callId).stateData.state, 'incoming_ringing');

    await receiver.manager.acceptCall(callId);
    const answer = messages(receiver, 'accept').at(-1);
    assert.deepEqual(deliveries.filter(delivery => delivery.id === answer.attrs.id).map(delivery => delivery.target),
      [caller.wireJid], 'the companion answer must target the original sender, without account fan-out');
    assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
    assert.equal(phone.manager.getCall(callId), null);
  });

  for (const creatorDevice of [undefined, 0, 18]) {
    test(`${mode.toUpperCase()} companion answer reaches caller device 18 with ${creatorDevice ?? 'bare'} call-creator`, async t => {
      const { caller, callerPhone, receiver, phone, callId, deliveries } = await setup(t, { mode, creatorDevice });
      const creator = receiver.manager.getCall(callId).callCreator;
      const offerKey = new Uint8Array(caller.manager.getCall(callId).encryptionKey);
      assert.equal(creator, creatorDevice === undefined ? A[mode] : device(A[mode], creatorDevice));
      await receiver.manager.acceptCall(callId);

      const accepts = messages(receiver, 'accept');
      assert.equal(accepts.length, 1);
      assert.equal(accepts[0].attrs.to, caller.wireJid, 'accept envelope must address the originating device');
      assert.deepEqual(deliveries.filter(delivery => delivery.id === accepts[0].attrs.id).map(delivery => delivery.target),
        [caller.wireJid]);
      assert.equal(callerPhone.manager.getCall(callId), null);
      assert.equal(accepts[0].content[0].attrs['call-creator'], creator, 'call metadata must be preserved');
      assert.deepEqual(receiver.synced, [], 'the answer does not establish another Signal session');
      assert.deepEqual(receiver.encrypted, [], 'the offer key is not re-encrypted in the answer');
      assert.equal(caller.decrypted.length, 0, 'the answer has no second key payload to decrypt');
      assert.deepEqual(caller.manager.getCall(callId).encryptionKey, offerKey);
      assert.deepEqual(receiver.manager.getCall(callId).encryptionKey, offerKey);
      assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
      assert.equal(receiver.manager.getCall(callId).stateData.state, 'connecting');
      assert.equal(phone.manager.getCall(callId), null, 'sibling phone must stop ringing');
      assert.deepEqual(phone.ended, ['accepted_elsewhere']);
      assert.deepEqual(messages(caller, 'terminate').map(node => parseSignalAddressFromJid(node.attrs.to)),
        [parseSignalAddressFromJid(phone.wireJid)]);
      assert.equal(receiver.ended.length, 0, 'winner must remain connected');
    });
  }

  for (const callerDevice of [null, 0]) {
    test(`${mode.toUpperCase()} ${callerDevice ?? 'bare'} mobile caller remains able to receive the companion answer`, async t => {
      const { caller, receiver, phone, callId } = await setup(t, { mode, callerDevice, creatorDevice: 0 });
      await receiver.manager.acceptCall(callId);
      assert.deepEqual(parseSignalAddressFromJid(messages(receiver, 'accept')[0].attrs.to),
        parseSignalAddressFromJid(caller.wireJid));
      assert.equal(caller.decrypted.length, 0);
      assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
      assert.equal(phone.manager.getCall(callId), null);
    });
  }

  test(`${mode.toUpperCase()} relay and mute exchange settle before the real companion accept and phone cancellation`, async t => {
    const { caller, receiver, phone, callId, session, pending, deliveries } = await setup(t, { mode });
    const participants = [caller.wireJid, receiver.wireJid, phone.wireJid];
    const endpoints = [{
      relayName: 'relay-a', c2rRtt: 12,
      addressBytes: new Uint8Array([127, 0, 0, 1, 13, 150]),
    }];
    for (const endpoint of [caller, receiver, phone]) {
      endpoint.manager.getCall(callId).relayData = { endpoints, participantJids: participants };
    }
    await session.sendIncomingRelayLatency();
    assert.equal(pending.length, 0, 'relay exchange must settle while devices are still ringing');
    assert.ok(deliveries.some(delivery => delivery.tag === 'relaylatency'));
    assert.ok(deliveries.filter(delivery => delivery.tag === 'relaylatency').length < 20);
    await receiver.manager.acceptCall(callId);
    assert.equal(pending.length, 0);
    assert.equal(caller.decrypted.length, 0, 'the caller retains its offer key without decrypting an answer');
    assert.equal(caller.manager.getCall(callId).stateData.state, 'connecting');
    assert.equal(receiver.manager.getCall(callId).stateData.state, 'connecting');
    assert.equal(phone.manager.getCall(callId), null);
    assert.deepEqual(phone.ended, ['accepted_elsewhere']);
    assert.ok(deliveries.some(delivery => delivery.tag === 'mute_v2'));
    assert.ok(deliveries.filter(delivery => delivery.tag === 'mute_v2').length < 10);
    session.sctpRelay.connect();
    caller.manager.getSessionOrThrow(callId).sctpRelay.connect();
    assert.equal(receiver.manager.getCall(callId).stateData.state, 'active');
    assert.equal(caller.manager.getCall(callId).stateData.state, 'active');
  });
}

test('accept send failure rejects local answer without publishing connecting and permits retry', async t => {
  const { caller, receiver, phone, callId } = await setup(t);
  const object = receiver.deps.lowLevelCoordinator;
  const method = 'sendNode';
  const original = object[method];
  object[method] = async (...args) => {
    if (tagOf(args[0]) === 'accept') throw new Error('simulated send failure');
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
  const gate = holdMethod(receiver.deps.lowLevelCoordinator, 'sendNode', node => tagOf(node) === 'accept');
  const first = receiver.manager.acceptCall(callId);
  await gate.entered;
  const second = receiver.manager.acceptCall(callId);
  const outcomes = Promise.allSettled([first, second]);
  gate.release();
  assert.deepEqual((await outcomes).map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(messages(receiver, 'accept').length, 1);
  assert.equal(receiver.states.filter(state => state === 'connecting').length, 1);
});

for (const stage of ['mute_v2', 'transport', 'accept']) {
  for (const interrupter of ['remote end', 'own smartphone']) {
    test(`${interrupter} during ${stage} prevents a late local accept from resurrecting the session`, { timeout: 2000 }, async t => {
      const { caller, receiver, callId, session } = await setup(t);
      const gate = holdMethod(receiver.deps.lowLevelCoordinator, 'sendNode', node => tagOf(node) === stage);
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
      // A send already in flight cannot be unsent, but subsequent signaling stops.
      const late = receiver.sent.slice(sentBeforeRelease);
      assert.equal(late.filter(node => ['transport', 'mute_v2', 'accept'].includes(tagOf(node)) && tagOf(node) !== stage).length, 0);
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
