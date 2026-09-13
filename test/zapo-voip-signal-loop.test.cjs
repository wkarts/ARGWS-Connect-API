'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

// Real signaling routers, managers, sessions and stanza builders; only native
// media and network delivery are simulated. This does not validate a live call.
const packageRoot = process.env.ARGWS_VOIP_PACKAGE_ROOT
  ? path.resolve(process.env.ARGWS_VOIP_PACKAGE_ROOT)
  : path.resolve(path.dirname(require.resolve('@innovatorssoft/voip')), '..');
const dist = path.join(packageRoot, 'dist');

class MediaRelay extends EventEmitter {
  hasConnection() { return false; }
  cleanup() { this.removeAllListeners(); }
}

class AudioEngine {
  setAudioSender() {}
  setOnAudioFinished() {}
  stop() {}
}

function loadProvider() {
  const originalLoad = Module._load;
  Module._load = function loadWithMediaFakes(request, parent, isMain) {
    if (parent?.filename.startsWith(`${dist}${path.sep}`)) {
      if (request.endsWith('/WaSctpRelay.js')) return { WaSctpRelay: MediaRelay };
      if (request.endsWith('/WaAudioEngine.js')) return { WaAudioEngine: AudioEngine };
      if (request.endsWith('/mlow-codec.js')) return { MLowCodec: {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      ...require(path.join(dist, 'call/WaCallManager.js')),
      ...require(path.join(dist, 'call/call-state.js')),
      ...require(path.join(dist, 'signaling/bridge.js')),
      ...require(path.join(dist, 'signaling/signaling.js')),
    };
  } finally {
    Module._load = originalLoad;
  }
}

const { WaCallManager, CallInfo, routeCallStanza, buildRelayLatencyStanza, buildMuteV2Stanza } = loadProvider();
const { createNoopLogger } = require('zapo-js');
const { toUserJid } = require('zapo-js/protocol');
const A = '111111111111111:3@lid';
const B = '222222222222222:6@lid';
const PHONE = '222222222222222:0@lid';
const CALL_ID = '0123456789ABCDEF0123456789ABCDEF';
const tagOf = node => node.tag === 'call' ? node.content?.[0]?.tag : node.tag;
const messages = (endpoint, tag) => endpoint.sent.filter(node => tagOf(node) === tag);

function endpoint(t, jid = B, peer = A) {
  const sent = [];
  const logger = createNoopLogger();
  const deps = {
    authClient: { getCurrentCredentials: () => ({ meJid: jid, meLid: jid }) },
    lowLevelCoordinator: { async sendNode(node) { sent.push(node); } },
  };
  const manager = new WaCallManager({ deps, logger, stores: {}, maxConcurrentCalls: 1 });
  const info = jid === A
    ? CallInfo.newOutgoing(CALL_ID, peer, A, 'audio')
    : CallInfo.newIncoming(CALL_ID, peer, A, undefined, 'audio');
  if (jid === A) info.applyTransition({ type: 'offer_sent' });
  info.relayData = { endpoints: [], participantJids: [A, B] };
  const session = manager.createSession(info);
  t.after(() => manager.destroy());
  return { jid, sent, logger, deps, manager, session };
}

function relay(from = A, to = B, { latency = 10, address = 1, name = 'relay-a' } = {}) {
  const node = buildRelayLatencyStanza(to, CALL_ID, A, [{
    relayName: name,
    latency,
    addressBytes: new Uint8Array([127, 0, 0, address, 13, 150]),
  }], [A, B], from);
  return { ...node, attrs: { ...node.attrs, from } };
}

function mute(from = A, to = B, state = 0) {
  const node = buildMuteV2Stanza(to, CALL_ID, A, state, from);
  return { ...node, attrs: { ...node.attrs, from } };
}

async function deliver(target, node) {
  return routeCallStanza(target.manager, target.deps, node, target.logger);
}

for (const [tag, makeNode] of [['relaylatency', relay], ['mute_v2', mute]]) {
  test(`two real API sessions stop reflecting ${tag} while acknowledging each received stanza`, async t => {
    const caller = endpoint(t, A, B);
    const receiver = endpoint(t, B, A);
    const peers = [caller, receiver];
    const queue = [{ target: receiver, node: makeNode() }];
    for (const source of peers) {
      source.deps.lowLevelCoordinator.sendNode = async node => {
        source.sent.push(node);
        if (tagOf(node) !== tag) return;
        // Account-addressed forwards reach the remote API; explicit device
        // addresses use the same endpoint. This queue avoids recursive mocks.
        const target = peers.find(candidate => toUserJid(candidate.jid) === toUserJid(node.attrs.to));
        assert.ok(target, 'control stanza must address a known account');
        queue.push({ target, node: { ...node, attrs: { ...node.attrs, from: source.jid } } });
      };
    }
    let delivered = 0;
    while (queue.length && delivered < 40) {
      const next = queue.shift();
      await deliver(next.target, next.node);
      delivered++;
    }
    const replies = peers.reduce((count, source) => count + messages(source, tag).length, 0);
    const acks = peers.reduce((count, source) => count + messages(source, 'ack').length, 0);
    assert.equal(queue.length, 0, `${tag} reflection still generates a new stanza after ${delivered} deliveries`);
    assert.ok(replies <= 4, `one control payload generated ${replies} responses`);
    assert.equal(acks, delivered, 'duplicate suppression must preserve transport acknowledgments');
    assert.equal(caller.session.info.stateData.state, 'ringing');
    assert.equal(receiver.session.info.stateData.state, 'incoming_ringing');
  });
}

test('relay forwarding keeps the first report and new latency, address and destination information', async t => {
  const receiver = endpoint(t);
  await deliver(receiver, relay());
  assert.equal(messages(receiver, 'relaylatency').length, 1);
  await deliver(receiver, relay()); // A new stanza id is not new relay information.
  assert.equal(messages(receiver, 'relaylatency').length, 1);
  await deliver(receiver, relay(A, B, { latency: 11 }));
  assert.equal(messages(receiver, 'relaylatency').length, 2);
  await deliver(receiver, relay(A, B, { latency: 11, address: 2 }));
  assert.equal(messages(receiver, 'relaylatency').length, 3);
  receiver.session.info.relayData.participantJids.push(PHONE);
  await deliver(receiver, relay(A, B, { latency: 11, address: 2 }));
  assert.equal(messages(receiver, 'relaylatency').length, 4);
  const last = messages(receiver, 'relaylatency').at(-1).content[0];
  assert.equal(last.content.find(child => child.tag === 'te').attrs.latency, String(0x2000000 + 11));
  assert.deepEqual(last.content.find(child => child.tag === 'destination').content.map(child => child.attrs.jid),
    [A, B, PHONE]);
});

test('concurrent copies of a relay report share the first pending forward', { timeout: 2000 }, async t => {
  const receiver = endpoint(t);
  let release;
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  receiver.deps.lowLevelCoordinator.sendNode = async node => {
    receiver.sent.push(node);
    if (tagOf(node) === 'relaylatency') { notify(); await waiting; }
  };
  const first = deliver(receiver, relay());
  await started;
  let duplicateFinished = false;
  const second = deliver(receiver, relay()).then(() => { duplicateFinished = true; });
  await new Promise(setImmediate);
  assert.equal(duplicateFinished, false, 'the duplicate must await the pending forward');
  release();
  await Promise.all([first, second]);
  assert.equal(messages(receiver, 'relaylatency').length, 1);
  assert.equal(messages(receiver, 'ack').length, 2);
});

for (const [tag, makeNode] of [['relaylatency', relay], ['mute_v2', mute]]) {
  test(`concurrent ${tag} responses share the same failure and permit a later retry`, async t => {
    const receiver = endpoint(t);
    const failure = new Error('simulated concurrent transport failure');
    let rejectSend;
    let notify;
    let attempts = 0;
    const started = new Promise(resolve => { notify = resolve; });
    receiver.deps.lowLevelCoordinator.sendNode = async () => {
      attempts++;
      notify();
      await new Promise((_, reject) => { rejectSend = reject; });
    };
    // Invoke the real helper to observe rejection before the existing handlers log it.
    const send = () => {
      const node = makeNode();
      return receiver.session.argwsSendSignalingResponse(node, A, node.content[0]);
    };
    const first = send();
    await started;
    let duplicateFinished = false;
    const second = send().finally(() => { duplicateFinished = true; });
    const outcomes = Promise.allSettled([first, second]);
    await new Promise(setImmediate);
    assert.equal(duplicateFinished, false, 'a pending send is not a successful response');
    rejectSend(failure);
    const results = await outcomes;
    assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));
    assert.equal(attempts, 1);
    receiver.deps.lowLevelCoordinator.sendNode = async () => { attempts++; };
    await send();
    assert.equal(attempts, 2, 'failed concurrent attempt must release the reservation');
    await send();
    assert.equal(attempts, 2, 'the successful retry must suppress the next duplicate');
  });
}

test('a failed relay forward remains retryable when the same report arrives again', async t => {
  const receiver = endpoint(t);
  let attempts = 0;
  receiver.deps.lowLevelCoordinator.sendNode = async node => {
    receiver.sent.push(node);
    if (tagOf(node) === 'relaylatency' && ++attempts === 1) throw new Error('simulated transport failure');
  };
  await deliver(receiver, relay());
  await deliver(receiver, relay());
  assert.equal(attempts, 2, 'failed send must release its duplicate reservation');
  await deliver(receiver, relay());
  assert.equal(attempts, 2, 'successful retry must suppress the next identical report');
});

test('ended sessions do not resume relay forwarding through an already acquired session reference', async t => {
  const receiver = endpoint(t);
  receiver.session.handleCallTerminate('user_ended');
  await receiver.session.handleCallRelaylatency(relay(), A);
  await receiver.session.handleCallMuteV2(mute(), A);
  assert.equal(messages(receiver, 'relaylatency').length, 0);
  assert.equal(messages(receiver, 'mute_v2').length, 0);
});

test('mute responses preserve the first new peer state and suppress repeated equivalent updates', async t => {
  const receiver = endpoint(t);
  await deliver(receiver, mute());
  await deliver(receiver, mute());
  assert.equal(messages(receiver, 'mute_v2').length, 1);
  await deliver(receiver, mute(A, B, 1));
  assert.equal(messages(receiver, 'mute_v2').length, 2);
  await deliver(receiver, mute(A, B, 1));
  assert.equal(messages(receiver, 'mute_v2').length, 2);
  assert.equal(messages(receiver, 'ack').length, 4);
});

test('equivalent relay bytes and attribute key ordering do not bypass duplicate suppression', async t => {
  const receiver = endpoint(t);
  await deliver(receiver, relay());
  const equivalent = relay();
  const te = equivalent.content[0].content.find(child => child.tag === 'te');
  te.attrs = { relay_name: te.attrs.relay_name, latency: te.attrs.latency };
  te.content = Buffer.from(te.content);
  await deliver(receiver, equivalent);
  assert.equal(messages(receiver, 'relaylatency').length, 1);
});

test('relay history is bounded per minute and renews to forward subsequent legitimate updates', async t => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const receiver = endpoint(t);
    for (let latency = 0; latency < 300; latency++) {
      await deliver(receiver, relay(A, B, { latency }));
    }
    assert.equal(messages(receiver, 'relaylatency').length, 256);
    await deliver(receiver, relay(A, B, { latency: 0 }));
    assert.equal(messages(receiver, 'relaylatency').length, 256,
      'the oldest fingerprint must not be evicted within the same window');
    await deliver(receiver, mute());
    assert.equal(messages(receiver, 'mute_v2').length, 1, 'response budgets are independent per tag');
    now += 59_999;
    await deliver(receiver, relay(A, B, { latency: 500 }));
    assert.equal(messages(receiver, 'relaylatency').length, 256);
    now++;
    await deliver(receiver, relay(A, B, { latency: 500 }));
    assert.equal(messages(receiver, 'relaylatency').length, 257, 'new window must admit new relay information');
    await deliver(receiver, relay(A, B, { latency: 0 }));
    assert.equal(messages(receiver, 'relaylatency').length, 258, 'old history expires with its window');
    await deliver(receiver, relay(A, B, { latency: 0 }));
    assert.equal(messages(receiver, 'relaylatency').length, 258);
    const independent = endpoint(t);
    await deliver(independent, relay(A, B, { latency: 0 }));
    assert.equal(messages(independent, 'relaylatency').length, 1, 'history must remain scoped to one session');
  } finally {
    Date.now = originalNow;
  }
});

test('window rollover preserves pending duplicates and bounds in-flight response memory', async t => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  try {
    const receiver = endpoint(t);
    receiver.deps.lowLevelCoordinator.sendNode = async node => {
      receiver.sent.push(node);
      if (tagOf(node) === 'relaylatency') await waiting;
    };
    const firstWindow = Array.from({ length: 256 }, (_, latency) => deliver(receiver, relay(A, B, { latency })));
    await new Promise(setImmediate);
    assert.equal(messages(receiver, 'relaylatency').length, 256);
    now += 60_000;
    let duplicateFinished = false;
    const duplicate = deliver(receiver, relay(A, B, { latency: 0 }))
      .then(() => { duplicateFinished = true; });
    await deliver(receiver, relay(A, B, { latency: 1000 }));
    assert.equal(duplicateFinished, false, 'rollover must not drop a pending promise');
    assert.equal(messages(receiver, 'relaylatency').length, 256,
      'pending sends from the previous window still occupy the finite response capacity');
    release();
    await Promise.all([...firstWindow, duplicate]);
    await deliver(receiver, relay(A, B, { latency: 0 }));
    assert.equal(messages(receiver, 'relaylatency').length, 256,
      'a send completed after rollover must enter the current duplicate history');
    now += 60_000;
    await deliver(receiver, relay(A, B, { latency: 1000 }));
    assert.equal(messages(receiver, 'relaylatency').length, 257);
  } finally {
    release();
    Date.now = originalNow;
  }
});
