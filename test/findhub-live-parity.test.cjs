'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, overrides = {}, globals = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative).exports;
  const module = { exports: {} }; cache.set(relative, module);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, URL, URLSearchParams, AbortSignal, AbortController, Response, Date, console, setTimeout, clearTimeout, setInterval, clearInterval, process: { env: {} }, require(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (['crypto', 'tls', 'http2', 'node:https'].includes(name)) return require(name);
    if (name.startsWith('.')) return load(path.normalize(path.join(path.dirname(relative), name + '.ts')), overrides, globals, cache);
    throw new Error('Unexpected dependency ' + name);
  }, ...globals }, { filename: relative }); return module.exports;
}
const crypto = load('src/api/integrations/channel/findhub/crypto/findhub-crypto.ts');
const fixtures = require('./fixtures/findhub-location-parity.json').vectors;
for (const vector of fixtures) test('reference wire/crypto parity: ' + vector.name, () => {
  const result = crypto.decryptLocationReport(Buffer.from(vector.identityKey, 'hex'), { ...vector, publicKeyRandom: Buffer.from(vector.publicKeyRandom, 'hex'), encryptedLocation: Buffer.from(vector.encryptedLocation, 'hex') });
  for (const key of ['latitude','longitude','altitude']) assert.equal(result[key], vector.expected[key]);
});
test('network ciphertext tampering is rejected', () => {
  const v = fixtures[1], data = Buffer.from(v.encryptedLocation, 'hex'); data[0] ^= 1;
  assert.throws(() => crypto.decryptLocationReport(Buffer.from(v.identityKey,'hex'), {...v, publicKeyRandom:Buffer.from(v.publicKeyRandom,'hex'),encryptedLocation:data}));
});

function heartbeatHarness() {
  const intervals=[],timeouts=[],writes=[];let clock=1000,destroyed=0;
  class Clock extends Date { static now(){return clock;} }
  const globals={Date:Clock,setInterval(fn,ms){const t={fn,ms,unref(){}};intervals.push(t);return t;},clearInterval(t){if(t)t.cleared=true;},setTimeout(fn,ms){const t={fn,ms,unref(){}};timeouts.push(t);return t;},clearTimeout(t){if(t)t.cleared=true;}};
  const {FindHubFcmClient}=load('src/api/integrations/channel/findhub/protocol/fcm.client.ts',{},globals);
  const socket={write(packet){writes.push(packet);},destroy(){destroyed++;client.scheduleReconnect();}};
  const client=new FindHubFcmClient(null,async()=>{},()=>{});
  client.socket=socket;client.authenticated=true;client.firstOutbound=false;client.startHeartbeatMonitor(socket);
  return {client,intervals,timeouts,writes,setClock(v){clock=v;},destroyed:()=>destroyed};
}
test('FCM proactively probes an idle connection and accepts heartbeat acknowledgement',async()=>{
 const h=heartbeatHarness();h.setClock(20999);h.intervals[0].fn();assert.equal(h.writes.length,0);
 h.setClock(21000);h.intervals[0].fn();assert.equal(h.writes.length,1);assert.equal(h.writes[0][0],0);
 h.setClock(22000);h.client.handleFrame(1,Buffer.alloc(0));h.setClock(26000);h.intervals[0].fn();
 assert.equal(h.destroyed(),0);assert.equal(h.client.ready,true);assert.equal(h.client.heartbeatSentAt,undefined);
 await h.client.stop();assert.ok(h.intervals[0].cleared);
});
test('FCM missing heartbeat acknowledgement closes the dead connection and schedules recovery',async()=>{
 const h=heartbeatHarness();h.setClock(21000);h.intervals[0].fn();h.setClock(26000);h.intervals[0].fn();
 assert.equal(h.destroyed(),1);assert.equal(h.client.ready,false);assert.equal(h.timeouts.length,1);assert.equal(h.timeouts[0].ms,5000);
 assert.ok(h.intervals[0].cleared);await h.client.stop();assert.ok(h.timeouts[0].cleared);assert.equal(h.client.reconnectTimer,undefined);
});
test('FCM any inbound frame keeps a healthy connection alive and old sockets cannot be probed',async()=>{
 const h=heartbeatHarness();h.setClock(20000);h.client.handleFrame(1,Buffer.alloc(0));h.setClock(21000);h.intervals[0].fn();assert.equal(h.writes.length,0);
 h.client.socket={write(){throw Error('wrong socket')}};h.setClock(60000);h.intervals[0].fn();assert.equal(h.writes.length,0);assert.equal(h.destroyed(),0);
 h.client.stopHeartbeatMonitor();
});
test('outgoing Nova command remains byte-identical to the supplied Python protobuf schema',()=>{
 const v=require('./fixtures/findhub-location-parity.json').command;
 const proto=load('src/api/integrations/channel/findhub/protocol/findhub-proto.ts');
 assert.equal(proto.encodeExecuteLocateRequest(v.args).toString('hex'),v.hex);
});
