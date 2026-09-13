'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

// Execute the installed provider's actual router, manager, session, JID helpers,
// crypto and stanza builders. Only native media and the network are simulated.
const packageRoot = process.env.ARGWS_VOIP_PACKAGE_ROOT
  ? path.resolve(process.env.ARGWS_VOIP_PACKAGE_ROOT)
  : path.resolve(path.dirname(require.resolve('@innovatorssoft/voip')), '..');
const dist = path.join(packageRoot, 'dist');

class MediaRelay extends EventEmitter {
  hasConnection() { return false; }
  setSubscriptionSsrc() {}
  resendSubscriptions() {}
  setSsrc() {}
  async configureRelays() {}
  getConnectedCount() { return 0; }
  cleanup() { this.removeAllListeners(); }
}

class AudioEngine {
  setAudioSender() {}
  setOnAudioFinished() {}
  stop() {}
  startSilenceCapture() {}
  static feedWatermarksMs() { return { pauseMs: 1000, resumeMs: 500 }; }
}

function loadProvider() {
  const originalLoad = Module._load;
  Module._load = function loadWithMediaFakes(request, parent, isMain) {
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
      ...require(path.join(dist, 'call/call-state.js')),
      ...require(path.join(dist, 'signaling/bridge.js')),
      ...require(path.join(dist, 'types.js')),
    };
  } finally {
    Module._load = originalLoad;
  }
}

const { WaCallManager, CallInfo, CallMediaType, routeCallStanza } = loadProvider();
const { createNoopLogger } = require('zapo-js');
const { parseSignalAddressFromJid, toUserJid } = require('zapo-js/protocol');
const { derivePerJidSrtpKey } = require(path.join(dist, 'crypto/encryption.js'));
const { generateSecureSsrc } = require(path.join(dist, 'crypto/ssrc.js'));
const { SrtpContext } = require(path.join(dist, 'crypto/srtp.js'));
const { RtpSession } = require(path.join(dist, 'media/rtp.js'));

const OWN_PN = '5511990000001@s.whatsapp.net';
const OWN_LID = '111111111111111@lid';
const PEER_PN = '5511990000002@s.whatsapp.net';
const PEER_LID = '222222222222222@lid';
const device = (jid, index) => jid.replace('@', `:${index}@`);
const PHONE = device(PEER_LID, 0);
const COMPANION = device(PEER_LID, 6);
const CALL_ID = '0123456789ABCDEF0123456789ABCDEF';

function stanza(tag, from, callId = CALL_ID, attributes = {}) {
  return {
    tag: 'call',
    attrs: { from, id: `stanza-${tag}-${callId}` },
    content: [{ tag, attrs: { 'call-id': callId, 'call-creator': device(OWN_LID, 3), ...attributes } }],
  };
}

function messages(sent, tag) {
  return sent.filter(node => node.tag === 'call' && node.content?.[0]?.tag === tag);
}

function setup() {
  const sent = [];
  const ended = [];
  const states = [];
  const logger = createNoopLogger();
  const deps = {
    authClient: {
      getCurrentCredentials: () => ({ meJid: device(OWN_PN, 3), meLid: device(OWN_LID, 3) }),
    },
    lowLevelCoordinator: { async sendNode(node) { sent.push(node); } },
    signalDeviceSync: {
      async resolveUserJidPair(jid) {
        const base = toUserJid(jid);
        if (base === OWN_PN || base === OWN_LID) return { pnJid: OWN_PN, lidJid: OWN_LID };
        if (base === PEER_PN || base === PEER_LID) return { pnJid: PEER_PN, lidJid: PEER_LID };
        return { pnJid: undefined, lidJid: undefined };
      },
      async queryLidsByPhoneJids(jids) {
        return jids.map(jid => {
          const pnJid = toUserJid(jid);
          const lidJid = pnJid === OWN_PN ? OWN_LID : pnJid === PEER_PN ? PEER_LID : undefined;
          return { pnJid, phoneJid: pnJid, lidJid };
        });
      },
      async syncDeviceList(jids) {
        return jids.map(jid => ({ jid, deviceJids: [PHONE, COMPANION] }));
      },
    },
    sessionResolver: {
      async ensureSessionsBatch(jids) {
        return jids.map(jid => ({ address: parseSignalAddressFromJid(jid), session: {} }));
      },
    },
    signalProtocol: {
      async encryptMessagesBatch(entries) {
        return entries.map(() => ({ type: 'msg', ciphertext: new Uint8Array([1, 2, 3]) }));
      },
    },
  };
  const manager = new WaCallManager({
    deps,
    stores: { privacyToken: { async getByJid() { return null; } } },
    logger,
    maxConcurrentCalls: 1,
  });
  manager.on('call_ended', info => ended.push({ callId: info.callId, reason: info.stateData.endReason }));
  manager.on('call_state', info => states.push({ callId: info.callId, state: info.stateData.state }));
  return { manager, deps, sent, ended, states, logger };
}

function outgoing(context, participants = [device(OWN_LID, 3), device(OWN_PN, 0), PHONE, COMPANION]) {
  const info = CallInfo.newOutgoing(CALL_ID, PEER_LID, device(OWN_LID, 3), CallMediaType.Audio);
  info.applyTransition({ type: 'offer_sent' });
  info.relayData = { endpoints: [], participantJids: participants };
  const session = context.manager.createSession(info);
  session.offeredDeviceJids = [PHONE, COMPANION];
  return session;
}

test('answer from the phone preserves its PN/LID aliases and terminates only other remote devices', async () => {
  const context = setup();
  outgoing(context);
  await context.manager.handleCallAccept(stanza('accept', PEER_PN), PEER_PN);

  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  assert.deepEqual(messages(context.sent, 'terminate').map(node => node.attrs.to), [COMPANION]);
  assert.equal(messages(context.sent, 'terminate')[0].content[0].attrs.reason, 'accepted_elsewhere');
  assert.equal(messages(context.sent, 'transport').length, 1);
  assert.equal(context.ended.length, 0);
  context.manager.destroy();
});

test('bare LID and explicit device zero identify the same answering phone', async () => {
  const context = setup();
  outgoing(context);
  await context.manager.handleCallAccept(stanza('accept', PEER_LID), PEER_LID);

  assert.deepEqual(messages(context.sent, 'terminate').map(node => node.attrs.to), [COMPANION]);
  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  context.manager.destroy();
});

test('failed PN/LID lookup never turns an uncertain identity into a losing device', async () => {
  const context = setup();
  context.deps.signalDeviceSync.resolveUserJidPair = async () => { throw new Error('lookup unavailable'); };
  outgoing(context);
  await context.manager.handleCallAccept(stanza('accept', PEER_PN), PEER_PN);

  assert.equal(messages(context.sent, 'terminate').length, 0);
  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  assert.equal(context.ended.length, 0);
  context.manager.destroy();
});

test('duplicate and concurrent accepts cannot replace the first answering device', async () => {
  const context = setup();
  outgoing(context);
  await Promise.all([
    context.manager.handleCallAccept(stanza('accept', PEER_PN), PEER_PN),
    context.manager.handleCallAccept(stanza('accept', COMPANION), COMPANION),
  ]);
  await context.manager.handleCallAccept(stanza('accept', PHONE), PHONE);
  await context.manager.handleCallAccept(stanza('accept', COMPANION), COMPANION);

  const terminateTargets = messages(context.sent, 'terminate').map(node => node.attrs.to);
  assert.ok(terminateTargets.length > 0);
  assert.ok(terminateTargets.every(jid => jid === COMPANION), JSON.stringify(terminateTargets));
  assert.equal(messages(context.sent, 'transport').length, 1);
  assert.notEqual(messages(context.sent, 'transport')[0].attrs.to, COMPANION);
  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  context.manager.destroy();
});

test('answer on our own phone removes only the incoming companion session', async () => {
  const context = setup();
  const info = CallInfo.newIncoming(CALL_ID, COMPANION, COMPANION, undefined, CallMediaType.Audio);
  info.relayData = {
    endpoints: [],
    participantJids: [COMPANION, device(OWN_LID, 3), device(OWN_LID, 0)],
  };
  context.manager.createSession(info);
  await context.manager.handleCallAccept(stanza('accept', OWN_PN), OWN_PN);

  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.deepEqual(context.ended, [{ callId: CALL_ID, reason: 'accepted_elsewhere' }]);
  assert.equal(messages(context.sent, 'terminate').length, 0);
  assert.equal(messages(context.sent, 'transport').length, 0);
  context.manager.destroy();
});

test('terminate is consumed by call-id even when its sender cannot be normalized', async () => {
  const context = setup();
  outgoing(context);
  const result = await routeCallStanza(
    context.manager,
    context.deps,
    stanza('terminate', 'not-a-device-jid', CALL_ID, { reason: 'accepted_elsewhere' }),
    context.logger,
  );

  assert.equal(result, 'terminate');
  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.deepEqual(context.ended, [{ callId: CALL_ID, reason: 'accepted_elsewhere' }]);
  assert.equal(context.sent.filter(node => node.tag === 'ack').length, 1);
  assert.equal(messages(context.sent, 'terminate').length, 0);
});

test('failure to send the termination ACK cannot keep a remotely ended session alive', async () => {
  const context = setup();
  outgoing(context);
  context.deps.lowLevelCoordinator.sendNode = async node => {
    context.sent.push(node);
    if (node.tag === 'ack') throw new Error('ack transport unavailable');
  };

  assert.equal(await routeCallStanza(
    context.manager, context.deps, stanza('terminate', PHONE), context.logger,
  ), 'terminate');
  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.equal(context.ended.length, 1);
  assert.equal(messages(context.sent, 'terminate').length, 0);
});

test('three received calls followed by remote termination leave no accumulated sessions', async () => {
  const context = setup();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const callId = attempt.toString(16).padStart(32, '0').toUpperCase();
    const offer = stanza('offer', COMPANION, callId, { 'call-creator': COMPANION });
    await routeCallStanza(context.manager, context.deps, offer, context.logger);
    assert.equal(context.manager.getCalls().length, 1);
    assert.equal(context.manager.getCall(callId).stateData.acceptBlocked, undefined);

    await routeCallStanza(
      context.manager, context.deps, stanza('terminate', COMPANION, callId), context.logger,
    );
    assert.equal(context.manager.getCalls().length, 0);
  }
  assert.equal(context.ended.length, 3);
});

test('reject of a ringing call reaches the manager and releases the session', async () => {
  const context = setup();
  outgoing(context);
  await routeCallStanza(
    context.manager, context.deps, stanza('reject', PHONE, CALL_ID, { reason: 'declined' }), context.logger,
  );

  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.equal(context.ended.length, 1);
  assert.equal(context.ended[0].reason, 'declined');
});

test('a busy companion does not cancel a phone that is still ringing', async () => {
  const context = setup();
  outgoing(context);
  await routeCallStanza(
    context.manager, context.deps, stanza('reject', COMPANION, CALL_ID, { reason: 'busy' }), context.logger,
  );

  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'ringing');
  assert.equal(context.ended.length, 0);
  await context.manager.handleCallAccept(stanza('accept', PHONE), PHONE);
  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  context.manager.destroy();
});

test('rejection from another device cannot terminate an already accepted call', async () => {
  const context = setup();
  outgoing(context);
  await context.manager.handleCallAccept(stanza('accept', PHONE), PHONE);
  await routeCallStanza(
    context.manager, context.deps, stanza('reject', COMPANION, CALL_ID, { reason: 'declined' }), context.logger,
  );

  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  assert.equal(context.ended.length, 0);
  context.manager.destroy();
});

test('cancel before the offer ACK reaches every device that received the actual offer', async () => {
  const context = setup();
  const callId = await context.manager.startCall({ peerJid: PEER_PN });
  const offer = messages(context.sent, 'offer')[0];
  const offeredTargets = offer.content[0].content.find(node => node.tag === 'destination').content
    .map(node => node.attrs.jid);
  assert.deepEqual(offeredTargets, [PHONE, COMPANION]);
  assert.equal(context.manager.getCall(callId).relayData, undefined);

  await context.manager.endCall(callId);
  const terminateTargets = messages(context.sent, 'terminate').map(node => node.attrs.to);
  for (const target of offeredTargets) assert.ok(terminateTargets.includes(target), target);
  assert.ok(terminateTargets.includes(PEER_LID));
  assert.equal(context.manager.getCall(callId), null);
  assert.equal(context.ended.length, 1);
});

test('hangup after answer is sent only to the device that answered', async () => {
  const context = setup();
  outgoing(context);
  await context.manager.handleCallAccept(stanza('accept', PHONE), PHONE);
  context.sent.length = 0;
  await context.manager.endCall(CALL_ID);

  const terminateTargets = messages(context.sent, 'terminate').map(node => node.attrs.to);
  assert.equal(terminateTargets.length, 1);
  assert.ok([PHONE, PEER_LID].includes(terminateTargets[0]));
  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.equal(context.ended.length, 1);
});

test('partial signaling failure does not declare success and permits a complete retry', async () => {
  const context = setup();
  outgoing(context);
  let shouldFail = true;
  context.deps.lowLevelCoordinator.sendNode = async node => {
    context.sent.push(node);
    if (node.content?.[0]?.tag === 'terminate' && node.attrs.to === COMPANION && shouldFail) {
      throw new Error('simulated signaling transport failure');
    }
  };

  await assert.rejects(context.manager.endCall(CALL_ID));
  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'ringing');
  assert.equal(context.ended.length, 0);

  shouldFail = false;
  await context.manager.endCall(CALL_ID);
  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.equal(context.ended.length, 1);
});

test('remote termination while the offer is being sent cannot resurrect a ringing session', async () => {
  const context = setup();
  context.deps.lowLevelCoordinator.sendNode = async node => {
    context.sent.push(node);
    if (node.content?.[0]?.tag === 'offer') {
      const callId = node.content[0].attrs['call-id'];
      await routeCallStanza(
        context.manager, context.deps, stanza('terminate', PHONE, callId), context.logger,
      );
    }
  };

  const callId = await context.manager.startCall({ peerJid: PEER_PN });
  assert.equal(context.manager.getCall(callId), null);
  assert.equal(context.ended.length, 1);
  assert.equal(context.states.at(-1).state, 'ended');
});

test('accept delivered before offer send resolves is retained as the negotiated winner', async () => {
  const context = setup();
  context.deps.lowLevelCoordinator.sendNode = async node => {
    context.sent.push(node);
    if (node.content?.[0]?.tag === 'offer') {
      const callId = node.content[0].attrs['call-id'];
      await context.manager.handleCallAccept(stanza('accept', PHONE, callId), PHONE);
    }
  };

  const callId = await context.manager.startCall({ peerJid: PEER_PN });
  assert.equal(context.manager.getCall(callId).stateData.state, 'connecting');
  assert.equal(messages(context.sent, 'transport').length, 1);
  assert.equal(context.states.at(-1).state, 'connecting');
  context.manager.destroy();
});

test('remote termination during accept identity lookup prevents all later media signaling', { timeout: 2000 }, async () => {
  const context = setup();
  outgoing(context);
  let releaseLookup;
  let notifyLookup;
  const lookupStarted = new Promise(resolve => { notifyLookup = resolve; });
  const lookupReleased = new Promise(resolve => { releaseLookup = resolve; });
  context.deps.signalDeviceSync.resolveUserJidPair = async () => {
    notifyLookup();
    await lookupReleased;
    return { pnJid: PEER_PN, lidJid: PEER_LID };
  };

  const accepting = context.manager.handleCallAccept(stanza('accept', PEER_PN), PEER_PN);
  const lookupWasStarted = await Promise.race([lookupStarted.then(() => true), accepting.then(() => false)]);
  assert.equal(lookupWasStarted, true, 'the identity lookup must be pending before remote termination');
  await routeCallStanza(
    context.manager, context.deps, stanza('terminate', PHONE), context.logger,
  );
  releaseLookup();
  await accepting;

  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.equal(context.ended.length, 1);
  assert.equal(messages(context.sent, 'terminate').length, 0);
  assert.equal(messages(context.sent, 'transport').length, 0);
  assert.equal(messages(context.sent, 'mute_v2').length, 0);
  assert.equal(context.states.at(-1).state, 'ended');
});

test('remote hangup during winner selection stops subsequent transport and mute stanzas', async () => {
  const context = setup();
  outgoing(context);
  context.deps.lowLevelCoordinator.sendNode = async node => {
    context.sent.push(node);
    if (node.content?.[0]?.tag === 'terminate' && node.content[0].attrs.reason === 'accepted_elsewhere') {
      await context.manager.handleCallTerminate(stanza('terminate', PHONE));
    }
  };

  await context.manager.handleCallAccept(stanza('accept', PHONE), PHONE);

  assert.equal(context.manager.getCall(CALL_ID), null);
  assert.equal(context.ended.length, 1);
  assert.equal(messages(context.sent, 'transport').length, 0);
  assert.equal(messages(context.sent, 'mute_v2').length, 0);
  assert.equal(context.states.at(-1).state, 'ended');
});

test('PN/LID equivalence does not rewrite the peer identity used by real SRTP and SSRC', async () => {
  const context = setup();
  const session = outgoing(context);
  const callKey = new Uint8Array(32).fill(37);
  session.info.encryptionKey = callKey;
  await session.initMedia(device(OWN_LID, 3), PEER_LID);
  await context.manager.handleCallAccept(stanza('accept', PEER_PN), PEER_PN);

  const peerDeviceJid = device(PEER_PN, 0);
  const peerSsrc = generateSecureSsrc(CALL_ID, peerDeviceJid);
  const sender = new SrtpContext(derivePerJidSrtpKey(callKey, peerDeviceJid), 4);
  const rtp = RtpSession.whatsappOpus(peerSsrc);
  const payload = new Uint8Array([11, 22, 33, 44]);
  const encrypted = sender.protect(rtp.createPacket(payload));

  assert.deepEqual(session.srtpSession.unprotect(encrypted).payload, payload);
  assert.deepEqual(session.peerSsrcs, [peerSsrc]);
  assert.equal(messages(context.sent, 'transport')[0].attrs.to, PEER_PN);
  assert.deepEqual(messages(context.sent, 'terminate').map(node => node.attrs.to), [COMPANION]);
  context.manager.destroy();
});

test('late relay offer ACK preserves the accepted peer and the SRTP anti-replay state', async () => {
  const context = setup();
  const session = outgoing(context);
  const callKey = new Uint8Array(32).fill(19);
  session.info.encryptionKey = callKey;
  await session.initMedia(device(OWN_LID, 3), PEER_LID);
  await context.manager.handleCallAccept(stanza('accept', PEER_PN), PEER_PN);

  const peerDeviceJid = device(PEER_PN, 0);
  const peerSsrc = generateSecureSsrc(CALL_ID, peerDeviceJid);
  const sender = new SrtpContext(derivePerJidSrtpKey(callKey, peerDeviceJid), 4);
  const rtp = RtpSession.whatsappOpus(peerSsrc);
  const encrypted = sender.protect(rtp.createPacket(new Uint8Array([1, 2, 3])));
  session.srtpSession.unprotect(encrypted);

  await context.manager.handleCallAck({
    tag: 'ack',
    attrs: { class: 'call', type: 'offer', 'call-id': CALL_ID },
    content: [{
      tag: 'relay', attrs: { uuid: 'test-relay' }, content: [
        { tag: 'participant', attrs: { jid: device(OWN_LID, 3) } },
        { tag: 'participant', attrs: { jid: COMPANION } },
        { tag: 'participant', attrs: { jid: PHONE } },
        { tag: 'te2', attrs: {}, content: new Uint8Array([127, 0, 0, 1, 13, 150]) },
      ],
    }],
  });

  assert.equal(session.info.relayData.endpoints.length, 1);
  assert.deepEqual(session.peerSsrcs, [peerSsrc]);
  assert.throws(() => session.srtpSession.unprotect(encrypted), /replay/i);
  const nextPayload = new Uint8Array([4, 5, 6]);
  assert.deepEqual(session.srtpSession.unprotect(sender.protect(rtp.createPacket(nextPayload))).payload, nextPayload);
  assert.equal(context.manager.getCall(CALL_ID).stateData.state, 'connecting');
  context.manager.destroy();
});
