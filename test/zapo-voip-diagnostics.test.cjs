'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/api/integrations/channel/whatsapp/zapo.call-diagnostics.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled, filename);
const { bindZapoCallDiagnostics } = loaded.exports;
const read = record => JSON.parse(record.slice('[ZapoCallTrace] '.length));
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const accept = (id = 'accept-stanza', callId = 'call-1') => ({
  tag: 'call', attrs: { id, to: '111:3@lid' },
  content: [{ tag: 'accept', attrs: { 'call-id': callId, 'call-creator': '111:3@lid' } }],
});
const relay = (id, callId = 'call-1') => ({
  tag: 'call', attrs: { id, to: '111:3@lid', token: 'SECRET-TOKEN' },
  content: [{ tag: 'relaylatency', attrs: { 'call-id': callId, key: 'SECRET-KEY' },
    content: [{ tag: 'token', attrs: {}, content: Buffer.from('SECRET-RELAY-TOKEN') }] }],
});
const trace = () => {
  const client = new EventEmitter();
  const records = [];
  bindZapoCallDiagnostics(client, 'test-instance', line => records.push(line), true);
  assert.equal(read(records.shift()).kind, 'enabled');
  return { client, records, emit: node => client.emit('debug_transport_node_in', { node }) };
};

test('disabled diagnostics attach no listeners; enabling later attaches once', () => {
  const client = new EventEmitter();
  const records = [];
  bindZapoCallDiagnostics(client, 'instance', line => records.push(line), false);
  assert.deepEqual(client.eventNames(), []);
  bindZapoCallDiagnostics(client, 'instance', line => records.push(line), true);
  bindZapoCallDiagnostics(client, 'instance', line => records.push(line), true);
  assert.equal(client.eventNames().length, 5);
  for (const event of client.eventNames()) assert.equal(client.listenerCount(event), 1);
  client.emit('debug_transport_node_in', { node: accept() });
  assert.equal(records.length, 2);
  assert.equal(read(records[0]).kind, 'enabled');
});

test('correlates outgoing accept with an ACK error containing no inner call id', () => {
  const { client, records, emit } = trace();
  client.emit('debug_transport_node_out', { node: accept(), frame: Buffer.from('SECRET-FRAME') });
  emit({ tag: 'ack', attrs: { id: 'accept-stanza', class: 'call', type: 'accept', error: '403' },
    content: [{ tag: 'error', attrs: { code: '403', reason: 'forbidden', token: 'SECRET-TOKEN' } }] });
  const [out, ack] = records.map(read);
  assert.equal(out.kind, 'transport_out');
  assert.equal(ack.kind, 'transport_in');
  assert.equal(ack.callId, 'call-1');
  assert.equal(ack.node.attrs.type, 'accept');
  assert.equal(ack.node.attrs.error, '403');
  assert.deepEqual(ack.node.children[0], { tag: 'error', attrs: { code: '403', reason: 'forbidden' } });
  assert.equal(ack.instance, `instance-${hash('test-instance')}`);
  assert.ok(Number.isFinite(Date.parse(ack.timestamp)));
  assert.ok(!records.join('').includes('SECRET'));
});

test('records incoming accept with device, creator and participant preserved', () => {
  const { records, emit } = trace();
  const node = accept();
  node.attrs.from = '222:6@lid';
  node.attrs.participant = '222:6@s.whatsapp.net';
  emit(node);
  const record = read(records[0]);
  assert.equal(record.callId, 'call-1');
  assert.equal(record.node.attrs.from, `peer-${hash('222@lid')}:6@lid`);
  assert.equal(record.node.attrs.participant, `peer-${hash('222@s.whatsapp.net')}:6@s.whatsapp.net`);
  assert.equal(record.node.children[0].attrs['call-creator'], `peer-${hash('111@lid')}:3@lid`);
  assert.ok(!records[0].includes('222:6'));
});

test('independent clients produce matching account pseudonyms while preserving each device', () => {
  const left = trace();
  const right = trace();
  const a = accept();
  const b = accept();
  a.attrs.from = '5511999999999:3@s.whatsapp.net';
  b.attrs.from = '5511999999999:6@s.whatsapp.net';
  left.emit(a);
  right.emit(b);
  const fromA = read(left.records[0]).node.attrs.from;
  const fromB = read(right.records[0]).node.attrs.from;
  assert.equal(fromA.replace(':3@', '@'), fromB.replace(':6@', '@'));
  assert.equal(read(left.records[0]).instance, read(right.records[0]).instance);
  assert.ok(!left.records[0].includes('5511999999999'));
  assert.ok(!left.records[0].includes('test-instance'));
});

test('includes retry receipts carrying a call child or a correlated stanza id', () => {
  const { client, records, emit } = trace();
  client.emit('debug_transport_node_out', { node: accept() });
  emit({ tag: 'receipt', attrs: { id: 'accept-stanza', type: 'retry' },
    content: [{ tag: 'retry', attrs: { code: '2' } }] });
  emit({ tag: 'receipt', attrs: { id: 'other-receipt', type: 'retry' },
    content: [{ tag: 'accept', attrs: { 'call-id': 'call-2' } }] });
  assert.deepEqual(records.slice(1).map(read).map(record => record.callId), ['call-1', 'call-2']);
});

test('state, incoming and ended include only the allowed call fields', () => {
  const { client, records } = trace();
  const call = { callId: 'call-1', direction: 'incoming', stateData: { state: 'connecting', endReason: 'failed',
    encryptionKey: 'SECRET' }, canAccept: false, signedIdentity: 'SECRET', callKey: 'SECRET', peerJid: 'omitted@lid' };
  for (const event of ['state', 'incoming', 'ended']) client.emit(`voip_call_${event}`, call);
  assert.deepEqual(records.map(read).map(record => record.kind), ['state', 'incoming', 'ended']);
  const record = read(records[0]);
  assert.equal(record.canAccept, false);
  assert.equal(record.direction, 'incoming');
  assert.equal(record.state, 'connecting');
  assert.equal(record.endReason, 'failed');
  assert.deepEqual(Object.keys(record).sort(), ['timestamp', 'instance', 'kind', 'callId', 'direction', 'state', 'endReason', 'canAccept'].sort());
  assert.ok(!records.join('').includes('SECRET'));
});

test('binary bodies expose only byte lengths and never serialize secrets or arbitrary objects', () => {
  const { client, records } = trace();
  const node = accept();
  node.attrs.token = 'SECRET-TOKEN';
  node.attrs.error = { toJSON() { throw Error('must not serialize objects'); } };
  node.content[0].content = [
    { tag: 'enc', attrs: { type: 'msg', callKey: 'SECRET-KEY' }, content: Buffer.from('SECRET-CIPHERTEXT') },
    { tag: 'device-identity', attrs: {}, content: new Uint8Array([1, 2, 3]) },
    { tag: 'privacy', attrs: {}, content: 'SECRET-PRIVACY' },
  ];
  node.signedIdentity = 'SECRET-IDENTITY';
  client.emit('debug_transport_node_out', { node, frame: Buffer.from('SECRET-FRAME') });
  const children = read(records[0]).node.children[0].children;
  assert.equal(children[0].byteLength, Buffer.byteLength('SECRET-CIPHERTEXT'));
  assert.deepEqual(children[0].attrs, { type: 'msg' });
  assert.equal(children[1].byteLength, 3);
  assert.equal(children[2].byteLength, undefined);
  assert.ok(!records[0].includes('SECRET'));
  assert.ok(!records[0].includes(Buffer.from('SECRET-CIPHERTEXT').toString('base64')));
});

test('accept protocol metadata retains codec, rate, medium and keygen without bodies or private attributes', () => {
  const { client, records } = trace();
  const node = accept();
  node.content[0].content = [
    { tag: 'audio', attrs: { enc: 'opus', rate: 16000, medium: '3', keygen: '2', label: 'SECRET-LABEL' }, content: 'SECRET-AUDIO' },
    { tag: 'net', attrs: { medium: '3', enc: 'opus', rate: '16000', keygen: '2', address: 'SECRET-IP' } },
    { tag: 'encopt', attrs: { keygen: '2', enc: 'opus', rate: '16000', medium: '3', key: 'SECRET-KEY' }, content: Buffer.from('SECRET-BYTES') },
    { tag: 'enc', attrs: { type: 'msg', keygen: '2' }, content: Buffer.from('SECRET-CIPHERTEXT') },
  ];
  client.emit('debug_transport_node_out', { node });
  const children = read(records[0]).node.children[0].children;
  assert.deepEqual(children.map(child => child.attrs), [
    { enc: 'opus', rate: '16000' }, { medium: '3' }, { keygen: '2' }, { type: 'msg' },
  ]);
  assert.equal(children[0].content, undefined);
  assert.equal(children[2].byteLength, Buffer.byteLength('SECRET-BYTES'));
  assert.equal(children[3].byteLength, Buffer.byteLength('SECRET-CIPHERTEXT'));
  assert.ok(!records[0].includes('SECRET'));
  assert.ok(!records[0].includes(Buffer.from('SECRET-BYTES').toString('base64')));
});

test('new accept metadata rejects free text, unsupported values and coercible objects', () => {
  const { emit, records } = trace();
  const poison = { toString() { throw Error('must not coerce objects'); } };
  for (const value of ['SECRET-CONVERSATION', -1, 1e9, NaN, true, poison, null]) {
    const node = accept();
    node.content[0].content = [
      { tag: 'audio', attrs: { enc: value, rate: value } },
      { tag: 'net', attrs: { medium: value } },
      { tag: 'encopt', attrs: { keygen: value } },
    ];
    emit(node);
    const children = read(records.at(-1)).node.children[0].children;
    assert.deepEqual(children.map(child => child.attrs), [{}, {}, {}]);
  }
  assert.equal(records.length, 7);
  assert.ok(!records.join('').includes('SECRET'));
});

test('ordinary messages, non-call ACKs and unrelated receipts produce no trace', () => {
  const { records, emit } = trace();
  emit({ tag: 'message', attrs: { id: 'm1' }, content: [{ tag: 'enc', content: Buffer.from('secret') }] });
  emit({ tag: 'ack', attrs: { id: 'm1', class: 'message', type: 'accept' } });
  emit({ tag: 'receipt', attrs: { id: 'm1', type: 'read' } });
  emit({ tag: 'iq', attrs: {}, content: [{ tag: 'call' }] });
  assert.equal(records.length, 0);
});

test('writer failures and malformed nodes cannot interrupt other protocol listeners', () => {
  const client = new EventEmitter();
  let protocolEvents = 0;
  bindZapoCallDiagnostics(client, 'instance', () => { throw Error('log unavailable'); }, true);
  client.on('debug_transport_node_in', () => { protocolEvents++; });
  for (const event of [null, { node: accept() }, { get node() { throw Error('malformed accessor'); } },
    { node: { tag: 'call', get attrs() { throw Error('malformed attrs'); } } }]) {
    assert.doesNotThrow(() => client.emit('debug_transport_node_in', event));
  }
  assert.doesNotThrow(() => client.emit('voip_call_state', { callId: 'call-1', get canAccept() { throw Error('getter'); } }));
  assert.doesNotThrow(() => bindZapoCallDiagnostics({ on() { throw Error('unsupported'); } }, 'instance', () => {}, true));
  assert.equal(protocolEvents, 4);
});

test('child traversal and attribute lengths are bounded, including cyclic nodes', () => {
  const { records, emit } = trace();
  const node = accept();
  node.attrs.reason = 'x'.repeat(10_000);
  node.content[0].content = Array.from({ length: 1000 }, () => node);
  assert.doesNotThrow(() => emit(node));
  const record = read(records[0]);
  assert.equal(record.node.attrs.reason.length, 160);
  function check(summary, depth = 0) {
    assert.ok(depth <= 3);
    assert.ok((summary.children?.length || 0) <= 12);
    return 1 + (summary.children || []).reduce((total, child) => total + check(child, depth + 1), 0);
  }
  assert.ok(check(record.node) <= 48);
});

test('priority correlation cache keeps the newest 256 ids only', () => {
  const { client, records, emit } = trace();
  for (let i = 0; i < 257; i++) client.emit('debug_transport_node_out', { node: accept(`stanza-${i}`, `call-${i}`) });
  emit({ tag: 'ack', attrs: { id: 'stanza-0', class: 'call', type: 'accept' } });
  emit({ tag: 'ack', attrs: { id: 'stanza-1', class: 'call', type: 'accept' } });
  emit({ tag: 'ack', attrs: { id: 'stanza-256', class: 'call', type: 'accept' } });
  assert.deepEqual(records.slice(-3).map(read).map(record => record.callId), [undefined, 'call-1', 'call-256']);
});

test('relay and ACK bursts retain a later accept, its ACK, state and ended records', () => {
  const originalNow = Date.now;
  const startedAt = originalNow();
  let now = startedAt;
  Date.now = () => now;
  try {
    const { client, records, emit } = trace();
    const offer = accept('offer-stanza');
    offer.content[0].tag = 'offer';
    emit(offer);
    client.emit('voip_call_incoming', { callId: 'call-1', state: 'ringing' });
    // Repeated incoming/outgoing relaylatency plus ACKs exhaust the old shared budget in 2.5 seconds.
    for (let i = 0; i < 80; i++) {
      now = startedAt + Math.floor(i * 2500 / 80);
      client.emit('debug_transport_node_out', { node: relay(`out-relay-${i}`) });
      emit({ tag: 'ack', attrs: { class: 'call', id: `out-relay-${i}` } });
      emit(relay(`in-relay-${i}`));
      client.emit('debug_transport_node_out', { node: {
        tag: 'ack', attrs: { class: 'call', id: `in-relay-${i}` },
      } });
    }
    now = startedAt + 6000;
    client.emit('debug_transport_node_out', { node: accept() });
    emit({ tag: 'ack', attrs: { class: 'call', id: 'accept-stanza' } });
    client.emit('voip_call_state', { callId: 'call-1', state: 'connecting', canAccept: false });
    client.emit('voip_call_ended', { callId: 'call-1', state: 'ended', endReason: 'user_ended' });
    const observed = records.map(read);
    assert.deepEqual(observed.filter(record => record.kind === 'suppressed').map(record => ({
      bucket: record.bucket, limitPerMinute: record.limitPerMinute,
    })), [{ bucket: 'relaylatency', limitPerMinute: 100 }]);
    assert.equal(observed.at(-4).node.children[0].tag, 'accept');
    assert.equal(observed.at(-3).node.tag, 'ack');
    assert.equal(observed.at(-3).callId, 'call-1');
    assert.deepEqual(observed.slice(-2).map(record => record.kind), ['state', 'ended']);
    assert.equal(observed.at(-4).timestamp, new Date(startedAt + 6000).toISOString());
    assert.equal(observed.length, 107); // 100 noise records, one summary and six lifecycle records.
    assert.ok(!records.join('').includes('SECRET'));
    assert.ok(!records.join('').includes(Buffer.from('SECRET-RELAY-TOKEN').toString('base64')));
  } finally {
    Date.now = originalNow;
  }
});

test('hundreds of relay ids cannot evict a delayed accept ACK and both caches remain bounded', () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const { client, records, emit } = trace();
    client.emit('debug_transport_node_out', { node: accept() });
    for (let i = 0; i < 1000; i++) {
      client.emit('debug_transport_node_out', { node: relay(`relay-${i}`, `relay-call-${i}`) });
    }
    // Most of these delayed, untyped ACKs outlive the noise cache; they must not consume the reserve.
    for (let i = 0; i < 1000; i++) emit({ tag: 'ack', attrs: { class: 'call', id: `relay-${i}` } });
    emit({ tag: 'ack', attrs: { class: 'call', id: 'accept-stanza' } });
    assert.equal(read(records.at(-1)).callId, 'call-1');
    assert.equal(read(records.at(-1)).node.attrs.id, 'accept-stanza');
    now += 60_000;
    for (const i of [0, 743, 744, 999]) {
      emit({ tag: 'ack', attrs: { class: 'call', type: 'relaylatency', id: `relay-${i}` } });
    }
    assert.deepEqual(records.slice(-4).map(read).map(record => record.callId), [
      undefined, undefined, 'relay-call-744', 'relay-call-999',
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test('relay suppression preserves errors and all explicit lifecycle signals', () => {
  const { client, records, emit } = trace();
  for (let i = 0; i < 120; i++) client.emit('debug_transport_node_out', { node: relay(`relay-${i}`) });
  emit({ tag: 'ack', attrs: { class: 'call', id: 'relay-0', type: 'relaylatency', error: '403' } });
  emit({ tag: 'ack', attrs: { class: 'call', id: 'relay-1', type: 'relaylatency' },
    content: [{ tag: 'error', attrs: { code: '500' } }] });
  for (const tag of ['offer', 'preaccept', 'accept', 'reject', 'terminate']) {
    emit({ tag: 'ack', attrs: { class: 'call', id: 'relay-2', type: tag } });
    const node = relay(`${tag}-stanza`);
    node.content.push({ tag, attrs: { 'call-id': 'call-1' } });
    emit(node);
  }
  const retained = records.slice(-12).map(read);
  assert.equal(retained[0].node.attrs.error, '403');
  assert.equal(retained[0].callId, 'call-1');
  assert.equal(retained[1].node.children[0].tag, 'error');
  assert.deepEqual(retained.slice(2).filter((_, i) => i % 2 === 0).map(record => record.node.attrs.type),
    ['offer', 'preaccept', 'accept', 'reject', 'terminate']);
  assert.ok(retained.every(record => record.kind === 'transport_in'));
});

test('lifecycle flood emits at most 300 records plus one bucket summary per minute', () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const { records, emit } = trace();
    for (let i = 0; i < 1000; i++) emit(accept());
    assert.equal(records.length, 300); // The startup enabled record consumes one rate slot.
    assert.equal(read(records.at(-1)).kind, 'suppressed');
    assert.equal(read(records.at(-1)).bucket, 'lifecycle');
    assert.equal(read(records.at(-1)).limitPerMinute, 300);
    now += 60_000;
    emit(accept());
    assert.equal(records.length, 301);
    assert.equal(read(records.at(-1)).kind, 'transport_in');
  } finally {
    Date.now = originalNow;
  }
});

test('simultaneous floods remain bounded at 400 records and two summaries per minute', () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const { records, emit } = trace();
    for (let i = 0; i < 1000; i++) {
      emit(accept());
      emit(relay(`relay-${i}`));
      emit({ tag: 'ack', attrs: { class: 'call', type: 'relaylatency', id: `relay-${i}` } });
    }
    assert.equal(records.length, 401); // Enabled already consumed one of the 400 slots.
    assert.deepEqual(records.map(read).filter(record => record.kind === 'suppressed')
      .map(record => record.bucket).sort(), ['lifecycle', 'relaylatency']);
    now += 60_000;
    emit(relay('new-window'));
    emit(accept());
    assert.deepEqual(records.slice(-2).map(read).map(record => record.node.children[0].tag),
      ['relaylatency', 'accept']);
    // A clock correction also starts a fresh finite window.
    now -= 5000;
    for (let i = 0; i < 1000; i++) emit(relay(`corrected-${i}`));
    assert.equal(records.length, 504);
    assert.equal(read(records.at(-1)).bucket, 'relaylatency');
  } finally {
    Date.now = originalNow;
  }
});
