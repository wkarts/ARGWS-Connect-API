'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, overrides = {}, globals = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative).exports;
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, { fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  cache.set(relative, module);
  vm.runInNewContext(code, { Buffer, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: {} }, console, module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (['crypto', 'tls', 'http2', 'node:https'].includes(name)) return require(name);
      if (name.startsWith('.')) return load(path.normalize(path.join(path.dirname(relative), name + '.ts')), overrides, globals, cache);
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
    '../protocol/fcm.client': { FindHubFcmClient: class { async ensureRegistered() {
      if (options.registrationFailure) throw new Error('SENSITIVE');
      return { gcm: { androidId: '12345678901234567', securityToken: 'synthetic-secret' },
        registration: { token: 'synthetic-fcm' }, keys: { privateKey: 'synthetic-key' } };
    } } },
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
  await assert.rejects(h.service.complete(h.runtime,{...session,vaultKeys:h.vaultKeys}),/FH-AUTH-9110/);
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
  await assert.rejects(operation,/FH-AUTH-9110/);assert.equal(h.stored.length,0);assert.equal(h.service.pending(h.runtime),null);
});
test('wrong instance, wrong bridge secret, expiry and duplicate exchange are rejected',async()=>{
 const h=harness();const session=await h.service.start(h.runtime,'operator@example.com');
 await assert.rejects(h.service.exchange({...h.runtime,instanceId:'other'}, {...session,oauthToken:'synthetic'}),/FH-AUTH-9110/);
 await assert.rejects(h.service.exchange(h.runtime, {...session,bridgeToken:'wrong',oauthToken:'synthetic'}),/FH-AUTH-9110/);
 await h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'});
 await assert.rejects(h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'}),/já foi processado/);
 h.service.attempts.get(session.sessionId).expiresAt=0;
 await assert.rejects(h.service.complete(h.runtime,{...session,vaultKeys:h.vaultKeys}),/FH-AUTH-9110/);h.service.abort(h.runtime);
});
test('vault parser rejects foreign domains, oversized response and malformed byte values',()=>{
 const {findHubVaultKeys}=harness();
 for(const value of [null,'{}','not-json','x'.repeat(65537),JSON.stringify({finder_hw:[{key:[0]}]}),JSON.stringify({finder_hw:[{key:Array(32).fill(-1)}]})])assert.throws(()=>findHubVaultKeys(value));
});
test('AAS validates the requested account and the resulting Find Hub service permission', async () => {
  const { GooglePlayAuthClient } = load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
  const forms = [];
  const client = new GooglePlayAuthClient(async (body) => {
    const form = new URLSearchParams(body); forms.push(form);
    return { status: 200, text: form.has('Token') ? 'Token=synthetic-aas\nEmail=operator@example.com' : 'Auth=synthetic-adm' };
  });
  assert.equal((await client.exchange('operator@example.com', 'synthetic-oauth', '123456789')).aasToken, 'synthetic-aas');
  assert.equal(forms.length, 2);
  assert.equal(forms[0].get('Token'), 'synthetic-oauth');
  assert.equal(forms[1].get('EncryptedPasswd'), 'synthetic-aas');
  assert.equal(forms[1].get('service'), 'oauth2:https://www.googleapis.com/auth/android_device_manager');
  assert.ok(forms.every(form => !form.has('Passwd') && !form.has('password')));
});

test('regression: Token without optional Email proceeds only after a real service-token response', async () => {
  const { GooglePlayAuthClient } = load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
  let count = 0;
  const client = new GooglePlayAuthClient(async () => ({ status: 200, text: ++count === 1 ? 'Token=synthetic-aas' : 'Auth=synthetic-adm' }));
  const credentials = await client.exchange('operator@example.com', 'synthetic-oauth', '123456789');
  assert.equal(credentials.email, 'operator@example.com'); assert.equal(count, 2);
  let rejectedCount = 0;
  const rejected = new GooglePlayAuthClient(async () => ({ status: 200, text: ++rejectedCount === 1 ? 'Token=synthetic-aas' : 'Error=BadAuthentication' }));
  await assert.rejects(rejected.exchange('operator@example.com', 'synthetic-oauth', '123456789'), error => error.code === 9102);
});

test('explicit different Google identity is refused in exchange and service verification', async () => {
  const { GooglePlayAuthClient } = load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
  for (const mismatchAt of [1, 2]) {
    let count = 0;
    const client = new GooglePlayAuthClient(async () => ({ status: 200, text: (++count === 1 ? 'Token=synthetic-aas' : 'Auth=synthetic-adm') + (count === mismatchAt ? '\nEmail=other@example.com' : '') }));
    await assert.rejects(client.exchange('operator@example.com', 'synthetic-oauth', '123456789'), error => error.code === 9104);
    assert.equal(count, mismatchAt);
  }
});

test('cookie URI encoding is normalized once, preserving plus and equals', async () => {
  const { GooglePlayAuthClient } = load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
  for (const token of ['oauth2_4/opaque+test==', 'oauth2_4%2Fopaque%2Btest%3D%3D']) {
    const client = new GooglePlayAuthClient(async body => {
      const form = new URLSearchParams(body);
      if (form.has('Token')) assert.equal(form.get('Token'), 'oauth2_4/opaque+test==');
      return { status: 200, text: form.has('Token') ? 'Token=test' : 'Auth=test' };
    });
    await client.exchange('operator@example.com', token, '123456789');
  }
  const noNetwork = new GooglePlayAuthClient(async () => { throw Error('Must not request'); });
  for (const token of ['', 'x%0Ay', 'a b', 'a%EF%FF', 'x'.repeat(16385)]) {
    await assert.rejects(noNetwork.exchange('operator@example.com', token, '123456789'), error => error.code === 9101);
  }
});

for (const [status, text, code] of [
  [403, 'Error=BadAuthentication\nErrorDetail=DO_NOT_EXPOSE', 9102],
  [403, 'Error=NeedsBrowser\nUrl=https://example.invalid/?token=DO_NOT_EXPOSE', 9103],
  [200, 'Auth=DO_NOT_EXPOSE', 9105], [200, '<html>DO_NOT_EXPOSE</html>', 9106],
  [302, 'Location=DO_NOT_EXPOSE', 9103], [429, 'Error=DO_NOT_EXPOSE', 9109],
  [503, 'DO_NOT_EXPOSE', 9109], [200, 'Token=one\nToken=DO_NOT_EXPOSE', 9106],
]) test(`safe Google failure status=${status} code=${code}`, async () => {
  const { GooglePlayAuthClient } = load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
  let requests = 0;
  const client = new GooglePlayAuthClient(async () => { requests++; return { status, text }; });
  await assert.rejects(client.exchange('operator@example.com', 'synthetic-oauth', '123456789'), error =>
    error.code === code && !JSON.stringify(error).includes('DO_NOT_EXPOSE') && !error.message.includes('DO_NOT_EXPOSE'));
  assert.equal(requests, 1, 'one-use artifact must never be retried automatically');
});

function transportHarness({ status = 200, chunks = [Buffer.from('Token=synthetic')], failure, stalled = false } = {}) {
  const { EventEmitter } = require('node:events');
  const options = [], destinations = [], bodies = [], agents = []; let timeout;
  const { requestGoogleAuth } = load('src/api/integrations/channel/findhub/auth/google-auth.transport.ts', {
    'node:https': {
      Agent: class { constructor(options) { agents.push(options); } },
      request(url, opts, callback) {
        options.push(opts); destinations.push(url);
        const req = new EventEmitter(); req.destroy = () => {};
        req.end = body => {
          bodies.push(body);
          queueMicrotask(() => {
            if (stalled) return;
            if (failure) { req.emit('error', Object.assign(new Error('DO_NOT_EXPOSE'), { code: failure })); return; }
            const res = new EventEmitter(); res.statusCode = status; res.destroy = () => {};
            callback(res); for (const chunk of chunks) res.emit('data', chunk); res.emit('end');
          });
        };
        return req;
      },
    },
  }, { setTimeout: fn => { timeout = fn; return { unref() {} }; }, clearTimeout: () => {},
    fetch: () => { throw Error('Global fetch must not be used for Android auth'); } });
  return { requestGoogleAuth, options, destinations, bodies, agents, expire: () => timeout() };
}

test('private auth uses isolated HTTPS/1.1 without ALPN; CA/hostname verification and TLS 1.2 remain enabled', async () => {
  const h = transportHarness(); assert.equal((await h.requestGoogleAuth('Token=synthetic')).status, 200);
  assert.equal(h.destinations[0], 'https://android.clients.google.com/auth');
  assert.equal(h.options[0].method, 'POST'); assert.equal(h.options[0].headers['User-Agent'], 'GoogleAuth/1.4');
  for (const opts of [h.agents[0], h.options[0]]) {
    assert.equal(opts.rejectUnauthorized, true); assert.equal(opts.minVersion, 'TLSv1.2');
    assert.equal(opts.ALPNProtocols.length, 0); assert.equal(opts.checkServerIdentity, undefined);
  }
  assert.equal(h.options[0].headers['Content-Length'], Buffer.byteLength(h.bodies[0]));
});

test('transport enforces absolute timeout and bounded response, no insecure retries', async () => {
  const stalled = transportHarness({ stalled: true }); const pending = stalled.requestGoogleAuth('test=1');
  const rejected = assert.rejects(pending, error => error.code === 9107); stalled.expire(); await rejected;
  const large = transportHarness({ chunks: [Buffer.alloc(65537)] });
  await assert.rejects(large.requestGoogleAuth('test=1'), error => error.code === 9106);
  assert.equal(stalled.bodies.length, 1); assert.equal(large.bodies.length, 1);
});

for (const [failure, code] of [['CERT_HAS_EXPIRED', 9108], ['ERR_TLS_CERT_ALTNAME_INVALID', 9108], ['ETIMEDOUT', 9107], ['ENOTFOUND', 9109]]) {
  test(`transport maps ${failure} without leaking details`, async () => {
    const h = transportHarness({ failure });
    await assert.rejects(h.requestGoogleAuth('Token=DO_NOT_EXPOSE'), error => error.code === code && !error.message.includes('DO_NOT_EXPOSE'));
  });
}

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


test('regression: browser exchange uses registered Google decimal ID and reuses the exact FCM credentials', async () => {
 const h=harness(); const session=await h.service.start(h.runtime,'operator@example.com');
 await h.service.exchange(h.runtime,{...session,oauthToken:'synthetic'});
 await h.service.complete(h.runtime,{...session,vaultKeys:h.vaultKeys});
 assert.equal(h.stored[0].androidId,'12345678901234567');
 assert.equal(h.stored[0].fcm.gcm.androidId,h.stored[0].androidId);
});
test('failed receiver registration never issues a Google login session or claims ready', async () => {
 const h=harness({registrationFailure:true});
 await assert.rejects(h.service.start(h.runtime,'operator@example.com'),e=>e.code===9114 && !e.message.includes('SENSITIVE'));
 assert.equal(h.service.pending(h.runtime),null); assert.equal(h.stored.length,0);
});
test('fabricated hexadecimal identity cannot be sent to Google', async () => {
 const {GooglePlayAuthClient}=load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
 let sent=false; const client=new GooglePlayAuthClient(async()=>{sent=true;return {status:200,text:'Token=x'};});
 for(const id of ['a19b22ff','-1','0','18446744073709551616','123/secret'])
   await assert.rejects(client.exchange('operator@example.com','synthetic',id),e=>e.code===9101);
 assert.equal(sent,false);
});
test('regression: former 9106 at request line 66 now distinguishes HTTP status and upstream phase without secrets', async () => {
 const {GooglePlayAuthClient}=load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
 const client=new GooglePlayAuthClient(async()=>({status:400,text:'Error=InvalidRequest\nErrorDetail=SECRET email@private.example\nToken=PRIVATE-TOKEN'}));
 await assert.rejects(client.exchange('operator@example.com','synthetic','123456789'), e=>
   e.code===9106 && e.message.includes('etapa=exchange; http=400; motivo=InvalidRequest; campos=1011') && !/SECRET|private|PRIVATE/.test(e.message));
});
test('unknown error text cannot leak via diagnostic context; service phase remains distinguishable', async () => {
 const {GooglePlayAuthClient}=load('src/api/integrations/channel/findhub/auth/google-play-auth.client.ts');
 const client=new GooglePlayAuthClient(async()=>({status:403,text:'Error=USER-SECRET-VALUE'}));
 await assert.rejects(client.serviceToken({email:'operator@example.com',androidId:'1234',aasToken:'secret'},'adm'),e=>
  e.message.includes('etapa=adm; http=403; motivo=UNCLASSIFIED') && !e.message.includes('USER-SECRET'));
});


function nativeRegistrationHarness({ missingInstallationToken = false } = {}) {
  const requests = []; const checkin = Buffer.alloc(18);
  checkin[0] = 57; checkin.writeBigUInt64LE(12345678901234567n, 1);
  checkin[9] = 65; checkin.writeBigUInt64LE(9876543210123456n, 10);
  const globals = { fetch: async (url, options) => {
    requests.push({url,options});
    if (requests.length === 1) return {ok:true,arrayBuffer:async()=>checkin};
    if (requests.length === 2) return {ok:true,text:async()=>'token=synthetic-gcm\n'};
    if (requests.length === 3) {
      const data=JSON.parse(options.body); assert.match(data.fid,/^[cdef][A-Za-z0-9_-]{21}$/);
      return {ok:true,text:async()=>JSON.stringify({fid:data.fid,authToken:missingInstallationToken?{}:{token:'synthetic-install'}})};
    }
    if (requests.length === 4) return {ok:true,text:async()=>JSON.stringify({token:'synthetic-registration'})};
    throw Error('Unexpected registration replay');
  }};
  const {FindHubFcmClient}=load('src/api/integrations/channel/findhub/protocol/fcm.client.ts',{},globals);
  return {requests,client:new FindHubFcmClient(null,async()=>{},()=>{})};
}
test('native Google registration uses 22-character URL-safe FID and preserves decimal check-in identity',async()=>{
  const h=nativeRegistrationHarness();const credentials=await h.client.ensureRegistered();
  assert.equal(h.requests.length,4);assert.equal(credentials.gcm.androidId,'12345678901234567');
  assert.equal(credentials.gcm.token,'synthetic-gcm');
  assert.equal(new URLSearchParams(h.requests[1].options.body).get('device'),credentials.gcm.androidId);
  const registration=JSON.parse(h.requests[3].options.body);
  assert.ok(registration.web.endpoint.endsWith('/synthetic-gcm'));assert.ok(!registration.web.endpoint.includes('\n'));
  assert.equal(await h.client.ensureRegistered(),credentials);assert.equal(h.requests.length,4);
});
test('registration stops before push registration if Firebase does not return installation authorization',async()=>{
  const h=nativeRegistrationHarness({missingInstallationToken:true});
  await assert.rejects(h.client.ensureRegistered(),/Invalid Firebase installation response/);
  assert.equal(h.requests.length,3);assert.equal(h.client.currentCredentials,null);
});
