'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, overrides = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, { fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { Buffer, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: {} }, console, module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (['crypto', 'tls', 'http2'].includes(name)) return require(name);
      if (name.startsWith('.')) return load(path.normalize(path.join(path.dirname(relative), name + '.ts')), overrides, globals);
      throw new Error('Unexpected module: ' + name);
    }, ...globals }, { filename: relative });
  return module.exports;
}
function harness(options = {}) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), owner = crypto.randomBytes(32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedOwnerKey = Buffer.concat([iv, cipher.update(owner), cipher.final(), cipher.getAuthTag()]);
  const stored = [], stages = [];
  const overrides = {
    '../protocol/spot.client': { FindHubSpotClient: class { async ownerKeyEnvelope() { if (options.spotFailure) throw new Error('SENSITIVE'); return { encryptedOwnerKey }; } } },
    './google-play-auth.client': { GooglePlayAuthClient: class { async exchange(email, token, androidId) {
      stages.push('exchange'); if (options.exchangeFailure) throw new Error('SENSITIVE'); if (options.wait) await options.wait;
      return { email, androidId, aasToken: 'synthetic-aas' };
    } } },
  };
  const { FindHubBrowserAuthService, findHubVaultKeys } = load('src/api/integrations/channel/findhub/auth/findhub-browser-auth.service.ts', overrides);
  const broker = { async start(name, email) { const sessionId = crypto.randomUUID(), bridgeToken = crypto.randomBytes(32).toString('base64url');
    return { sessionId, bridgeToken, state: 'WAITING_AUTH', expiresAt: new Date(Date.now()+600000).toISOString() }; },
    async importBundle(name, data) { stages.push('import'); stored.push(data); }, cancel() { stages.push('cancel'); },
  };
  const runtime = { instanceId: 'google-local-id', instanceName: 'google', connectionStatus: { state: 'close' }, transportReady: false, auth: () => broker,
    async connect() { stages.push('connect'); if (options.connectFailure) throw new Error('SENSITIVE'); runtime.connectionStatus.state = 'open'; runtime.transportReady = true; },
  };
  const service = new FindHubBrowserAuthService();
  const vaultKeys = JSON.stringify({ finder_hw: [{ epoch: 1, key: Object.fromEntries([...key].map((v,i)=>[i,v])) }] });
  return { service, runtime, stored, stages, vaultKeys, findHubVaultKeys, key };
}
test('browser flow starts without authenticating; nonce and expiry are internal', async () => {
  const h = harness(); const session = await h.service.start(h.runtime, 'operator@example.com');
  assert.equal(session.authMode, 'browser-extension'); assert.equal(session.state, 'WAITING_USER');
  assert.equal(h.runtime.transportReady, false); assert.equal(h.stored.length, 0);
  assert.equal(session.loginUrl, 'https://accounts.google.com/EmbeddedSetup');
  assert.ok(!JSON.stringify(h.service.pending(h.runtime)).includes(session.bridgeToken));
  h.service.cancel(h.runtime, session);
});
test('complete validates owner-key encryption before saving; connection checked before READY', async () => {
  const h = harness(); const session = await h.service.start(h.runtime, 'operator@example.com');
  const exchange = await h.service.exchange(h.runtime, { ...session, oauthToken: 'synthetic-oauth' });
  assert.equal(exchange.state, 'WAITING_VAULT_KEY'); assert.equal(h.stored.length, 0);
  const url = new URL(exchange.unlockUrl); assert.equal(url.origin,'https://accounts.google.com'); assert.ok(url.searchParams.get('kdi'));
  const result = await h.service.complete(h.runtime, { ...session, vaultKeys: h.vaultKeys });
  assert.equal(result.connected,true); assert.equal(result.state,'READY');
  assert.deepEqual(h.stages,['exchange','import','connect']); assert.equal(h.service.pending(h.runtime),null);
  await assert.rejects(h.service.complete(h.runtime,{...session,vaultKeys:h.vaultKeys}),/expirada/);
});
test('wrong account key is refused without persisting any bundle', async () => {
  const h = harness(); const session = await h.service.start(h.runtime,'operator@example.com');
  await h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'});
  const unrelated = JSON.stringify({finder_hw:[{key:Array(32).fill(3)}]});
  await assert.rejects(h.service.complete(h.runtime,{...session,vaultKeys:unrelated}),/Não foi possível/);
  assert.equal(h.stored.length,0); assert.equal(h.runtime.transportReady,false);
});
for (const failure of ['exchangeFailure','spotFailure','connectFailure']) test(`fail closed with redacted ${failure}`, async () => {
  const h=harness({[failure]:true});const session=await h.service.start(h.runtime,'operator@example.com');
  const operation = async () => { await h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'}); await h.service.complete(h.runtime,{...session,vaultKeys:h.vaultKeys}); };
  await assert.rejects(operation, e=> !e.message.includes('SENSITIVE'));
  assert.equal(h.runtime.transportReady,false);assert.equal(h.service.pending(h.runtime),null);
});
test('cancel during token exchange wins over a late Google response',async()=>{
  let release;const wait = new Promise(r=>release=r); const h=harness({wait});const session=await h.service.start(h.runtime,'operator@example.com');
  const operation = h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'});h.service.cancel(h.runtime,session);release();
  await assert.rejects(operation,/Não foi possível/);assert.equal(h.stored.length,0);assert.equal(h.service.pending(h.runtime),null);
});
test('wrong instance, wrong bridge secret, expiry and duplicate exchange are rejected',async()=>{
 const h=harness();const session=await h.service.start(h.runtime,'operator@example.com');
 await assert.rejects(h.service.exchange({...h.runtime,instanceId:'other'}, {...session,oauthToken:'synthetic'}),/não autorizada/);
 await assert.rejects(h.service.exchange(h.runtime, {...session,bridgeToken:'wrong',oauthToken:'synthetic'}),/não autorizada/);
 await h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'});
 await assert.rejects(h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'}),/já foi processado/);
 h.service.attempts.get(session.sessionId).expiresAt=0;
 await assert.rejects(h.service.complete(h.runtime,{...session,vaultKeys:h.vaultKeys}),/expirada/);h.service.abort(h.runtime);
});
test('vault parser rejects foreign domains, oversized response and malformed byte values',()=>{
 const {findHubVaultKeys}=harness();
 for(const value of [null,'{}','not-json','x'.repeat(65537),JSON.stringify({finder_hw:[{key:[0]}]}),JSON.stringify({finder_hw:[{key:Array(32).fill(-1)}]})])assert.throws(()=>findHubVaultKeys(value));
});
test('AAS exchange binds the Google-returned account and never submits password',async()=>{
 let forms=[];let response='Token=synthetic-aas\nEmail=operator@example.com';
 const {GooglePlayAuthClient}=load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts',{}, {fetch:async(url,request)=>{forms.push(new URLSearchParams(request.body));assert.equal(request.redirect,'error');return {ok:true,text:async()=>response};}});
 const client=new GooglePlayAuthClient();assert.equal((await client.exchange('operator@example.com','synthetic-oauth','0011')).aasToken,'synthetic-aas');
 assert.equal(forms[0].has('Passwd'),false);assert.equal(forms[0].get('Token'),'synthetic-oauth');
 response='Token=synthetic-aas\nEmail=other@example.com';await assert.rejects(client.exchange('operator@example.com','synthetic-oauth','0011'),/diferente/);
 response='Token=synthetic-aas';await assert.rejects(client.exchange('operator@example.com','synthetic-oauth','0011'),/não confirmou/);
});
for(const provider of ['WHATSAPP-BAILEYS','WHATSAPP-ZAPO','WHATSAPP-BUSINESS'])test(`${provider}: new boundary does not change WhatsApp dispatch or query Google`,async()=>{
 const {findHubChannelBoundary}=load('src/api/integrations/channel/findhub/findhub-boundary.guard.ts',{'@api/server.module':{waMonitor:{waInstances:{unit:{integration:provider}}},prismaRepository:{instance:{findUnique(){throw new Error('Unexpected query');}}}},'@exceptions':{BadRequestException:Error}});
 let next=0;await findHubChannelBoundary({params:{instanceName:'unit'},originalUrl:'/message/sendText/unit'},null,()=>next++);assert.equal(next,1);
});
test('Find Hub endpoints and transports allowed; direct WhatsApp/bot APIs refused',async()=>{
 const {findHubChannelBoundary}=load('src/api/integrations/channel/findhub/findhub-boundary.guard.ts',{'@api/server.module':{waMonitor:{waInstances:{unit:{integration:'GOOGLE-FIND-HUB'}}}},'@exceptions':{BadRequestException:Error}});
 for(const prefix of ['findhub','webhook','websocket','rabbitmq','nats','sqs','kafka','pusher','instance']) {let next=0;await findHubChannelBoundary({params:{instanceName:'unit'},originalUrl:`/${prefix}/find/unit`},null,()=>next++);assert.equal(next,1);}
 for(const prefix of ['settings','proxy','chatwoot','openai','typebot','message','chat','business','group','call','localTemplate']) await assert.rejects(findHubChannelBoundary({params:{instanceName:'unit'},originalUrl:`/${prefix}/find/unit`},null,()=>{}),/não pertence/);
});
test('MCS handles fragmented initial frames and rejects oversized frames',()=>{
 const {FindHubFcmClient}=load('src/api/integrations/channel/findhub/protocol/fcm.client.ts');
 const fcm=new FindHubFcmClient(null,async()=>{},()=>{});let acknowledged=0;fcm.loginResult=()=>acknowledged++;
 const payload=Buffer.from([10,2,111,107]);const packet=Buffer.concat([Buffer.from([41,3,payload.length]),payload]);
 fcm.consume(packet.subarray(0,2));assert.equal(acknowledged,0);fcm.consume(packet.subarray(2,4));assert.equal(acknowledged,0);fcm.consume(packet.subarray(4));assert.equal(acknowledged,1);
 assert.throws(()=>fcm.consume(Buffer.alloc(1048577)),/too large/);
});
