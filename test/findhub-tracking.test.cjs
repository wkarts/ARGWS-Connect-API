'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');const {EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..');
function load(relative, overrides={},globals={},cache=new Map()) {
 if(cache.has(relative)) return cache.get(relative).exports;
 const module={exports:{}};cache.set(relative,module);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{fileName:relative,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,Buffer,URL,URLSearchParams,AbortSignal,AbortController,Response,Date,console,setTimeout,clearTimeout,setInterval,clearInterval,process:{env:{}},require(name){if(Object.hasOwn(overrides,name))return overrides[name];if(['crypto','zlib'].includes(name))return require('node:'+name);if(name.startsWith('.'))return load(path.normalize(path.join(path.dirname(relative),name+'.ts')),overrides,globals,cache);throw new Error('Unexpected dependency '+name)},...globals},{filename:relative});return module.exports;
}
const dir='src/api/integrations/channel/findhub/services/';
const policy=load(dir+'findhub-tracking.policy.ts');const now=Date.now();const position={deviceId:'one',googleDeviceId:'g',latitude:-12,longitude:-39,timestamp:new Date(now-1000).toISOString(),source:'GOOGLE_DIRECT',ownReport:true};
test('independent interval, timeout and history retention boundaries',()=>{const s=policy.trackingSettings({intervalSeconds:30,timeoutMs:90000,historyEnabled:true,retentionDays:0});assert.equal(s.retentionDays,0);assert.equal(s.timeoutMs,90000);assert.equal(s.intervalSeconds,30)});
for(const values of [{intervalSeconds:-1},{intervalSeconds:0.5},{intervalSeconds:100000},{timeoutMs:0},{timeoutMs:2147483648},{retentionDays:-1},{historyEnabled:'true'}])test('invalid tracking settings are refused '+JSON.stringify(values),()=>assert.throws(()=>policy.trackingSettings(values)));
test('a recent position does not invent an online state',()=>{assert.equal(policy.locationAvailability(position,300,null,now),'recent');assert.equal(policy.locationAvailability(position,300,'online',now),'online');assert.equal(policy.locationAvailability(position,300,'offline',now),'offline')});
test('missing, old, malformed and future coordinates handled truthfully',()=>{assert.equal(policy.locationAvailability(null,300),'no_location');assert.equal(policy.locationAvailability({...position,timestamp:new Date(now-600000).toISOString()},300,null,now),'stale');for(const v of [{latitude:91},{longitude:181},{timestamp:'bad'},{timestamp:new Date(now+600001).toISOString()}])assert.equal(policy.validPosition({...position,...v},now),false)});
test('position identity stable and source-aware',()=>{assert.equal(policy.positionFingerprint(position),policy.positionFingerprint({...position}));assert.notEqual(policy.positionFingerprint(position),policy.positionFingerprint({...position,longitude:-40}))});
function clientHarness(handler) {
 const calls=[];const sockets=[];const env={TRACCAR_ENABLED:'true',TRACCAR_MODE:'internal',TRACCAR_ADMIN_EMAIL:'admin@example.invalid',TRACCAR_ADMIN_PASSWORD:'test-only-secret',TRACCAR_ALLOWED_ORIGINS:'https://external.example.invalid,https://receiver.example.invalid'};
 class Socket extends EventEmitter{constructor(url,options){super();this.url=url;this.options=options;sockets.push(this)}close(){this.emit('close')}terminate(){this.emit('close')}}
 const exports=load(dir+'traccar-client.ts',{'ws':Socket},{process:{env},fetch:async(url,options)=>{calls.push({url,options});return handler(url,options)}});
 return {...exports,calls,sockets,env};
}
const json=(data,headers={})=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json',...headers}});
test('disabled Traccar does not require URL, credentials or network',()=>{const h=clientHarness(()=>{throw Error('unexpected network')});h.env.TRACCAR_ENABLED='false';new h.TraccarClient({mode:'disabled'});assert.equal(h.calls.length,0);assert.throws(()=>new h.TraccarClient({mode:'internal'}))});
test('destinations reject unknown origins, redirect payloads and URL credentials',()=>{const h=clientHarness();for(const url of ['http://169.254.169.254','https://evil.invalid','https://user:pass@external.example.invalid','https://external.example.invalid/path','https://external.example.invalid/?token=x'])assert.throws(()=>h.traccarDestination(url));assert.equal(h.traccarDestination('https://external.example.invalid').origin,'https://external.example.invalid')});
test('internal URL is automatic and secrets are only sent on backend session request',async()=>{const h=clientHarness(()=>json({id:1},{'set-cookie':'JSESSIONID=test-cookie; Path=/; HttpOnly'}));const client=new h.TraccarClient({mode:'internal'});await client.session();assert.equal(h.calls[0].url,'http://traccar:8082/api/session');assert.equal(h.calls[0].options.redirect,'error');assert.equal(new URLSearchParams(h.calls[0].options.body).get('password'),'test-only-secret');client.close()});
test('external token becomes official session, not socket URL',async()=>{const h=clientHarness(()=>json({id:1},{'set-cookie':'JSESSIONID=private; HttpOnly'}));const client=new h.TraccarClient({mode:'external',url:'https://external.example.invalid',receiverUrl:'https://receiver.example.invalid',token:'private-token'});client.start(async()=>{},()=>{});await new Promise(r=>setTimeout(r,5));assert.equal(h.sockets.length,1);assert.equal(String(h.sockets[0].url),'wss://external.example.invalid/api/socket');assert.equal(h.sockets[0].options.headers.Cookie,'JSESSIONID=private');assert.equal(String(h.sockets[0].url).includes('private-token'),false);client.close()});
test('provisioning is stable per account/device and rejects another owner',async()=>{let expected;const h=clientHarness((url,options)=>options.method==='POST'?json({id:8,...JSON.parse(options.body)}):json([]));const client=new h.TraccarClient({mode:'internal'});expected=h.traccarUniqueId('a','one');const d=await client.provision('a','one','Phone');assert.equal(d.uniqueId,expected);assert.notEqual(expected,h.traccarUniqueId('b','one'));assert.equal(JSON.parse(h.calls[1].options.body).attributes.connectInstanceId,'a');client.close();const bad=clientHarness(()=>json([{id:1,uniqueId:expected,attributes:{connectInstanceId:'other'}}]));await assert.rejects(new bad.TraccarClient({mode:'internal'}).provision('a','one','Phone'),/não pertence/)});
test('positions use OsmAnd seconds, not nonexistent REST POST positions',async()=>{const h=clientHarness(()=>new Response(null,{status:200}));await new h.TraccarClient({mode:'internal'}).send('stable-id',position);assert.equal(h.calls[0].url,'http://traccar:5055');const f=new URLSearchParams(h.calls[0].options.body);assert.equal(f.get('timestamp'),String(Date.parse(position.timestamp)/1000));assert.equal(f.get('lat'),'-12');assert.equal(h.calls[0].options.redirect,'error')});
function response(){const res=new EventEmitter();Object.assign(res,{headersSent:false,writableEnded:false,destroyed:false,writableLength:0,frames:[],status(){return this},set(h){this.headers=h;return this},flushHeaders(){this.headersSent=true},write(x){this.frames.push(x);return true},end(){this.writableEnded=true;this.emit('close')}});return res}
const {findHubStream}=load(dir+'findhub-stream.ts');
test('SSE snapshot and instance events; GET body completion does not close stream',async()=>{const res=response();let listener,stopped=0;await findHubStream({params:{instanceName:'account'},destroyed:true,aborted:false},res,{subscribe(name,fn){assert.equal(name,'account');listener=fn;return()=>stopped++},async snapshot(name){return {instanceId:'account'}}});assert.equal(res.headers['X-Accel-Buffering'],'no');assert.equal(res.writableEnded,false);listener({event:'location',instanceId:'account'});assert.equal(res.frames.length,2);res.emit('close');assert.equal(stopped,1);listener({event:'ignored'});assert.equal(res.frames.length,2)});
test('SSE failed authorization/snapshot releases resources before any headers',async()=>{const res=response();let stopped=0;await assert.rejects(findHubStream({params:{instanceName:'x'}},res,{subscribe(){return()=>stopped++},async snapshot(){throw Error('denied')}}));assert.equal(stopped,1);assert.equal(res.headersSent,false)});
test('slow SSE reader is disconnected without unbounded buffer',async()=>{const res=response();let listener,stopped=0;await findHubStream({params:{instanceName:'account'}},res,{subscribe(n,fn){listener=fn;return()=>stopped++},async snapshot(){return {instanceId:'account'}}});res.writableLength=300000;listener({event:'large'});assert.equal(res.writableEnded,true);assert.equal(stopped,1)});

function runtimeHarness(globals={}) {
 const emitter=new EventEmitter(), events=[], calls=[], positions=[];
 const row={id:'d-a',instanceId:'a',accountId:'a',googleDeviceId:'g-a',name:'Phone',identifierType:'ANDROID',deviceType:'PHONE',trackingIntervalSeconds:60,trackingEnabled:false,latestPosition:null,lastLocationAt:null};
 const other={...row,id:'d-b',instanceId:'b',googleDeviceId:'g-b'};const devices=[row,other];
 const account={id:'account-a',instanceId:'a',googleEmail:'a@example.invalid',trackingSettings:{intervalSeconds:60,timeoutMs:30000,staleAfterSeconds:300,historyEnabled:true,retentionDays:30},encryptedTraccar:null};
 function match(r,w){return Object.entries(w||{}).every(([k,v])=>{if(k==='OR')return v.some(x=>match(r,x));if(v && typeof v==='object'){if('in' in v)return v.in.includes(r[k]);if('lt' in v)return r[k]<v.lt;if('lte' in v)return r[k]<=v.lte;if('equals' in v)return r[k]==null;}return r[k]===v})}
 const db={instance:{async update(){}},findHubAccount:{async findUnique({where}){assert.equal(where.instanceId,'a');return account},async update({where,data}){assert.equal(where.instanceId,'a');Object.assign(account,data);return account}},
  findHubDevice:{async findFirst({where}){calls.push(['device',where]);return devices.find(d=>match(d,where))},async findMany({where}){return devices.filter(d=>match(d,where))},async updateMany({where,data}){calls.push(['update',where]);let n=0;for(const d of devices)if(match(d,where)){Object.assign(d,data);n++}return {count:n}},async update({where,data}){const d=devices.find(d=>d.id===where.id);Object.assign(d,data);return d}},
  findHubPosition:{async count(){return positions.length},async upsert({where,create}){calls.push(['history',where]);let old=positions.find(p=>p.fingerprint===create.fingerprint&&p.instanceId===create.instanceId&&p.deviceId===create.deviceId);if(!old){old={id:'p-'+positions.length,...create};positions.push(old)}return old},async findMany({where,take}){calls.push(['history-read',where]);return positions.filter(p=>match(p,where)).slice(0,take)},async deleteMany({where}){calls.push(['history-delete',where]);let n=0;for(let i=positions.length-1;i>=0;i--)if(match(positions[i],where)){positions.splice(i,1);n++}return {count:n}}},
  findHubTraccarBinding:{async findUnique(){return null},async findMany({where}){assert.equal(where.instanceId,'a');return []}},async $transaction(fn){return fn(db)}};
 const overrides={
  '@prisma/client':{Prisma:{DbNull:{isNull:true}}},'@api/server.module':{eventManager:{async emit(e){events.push(e)}}},'@config/logger.config':{Logger:class{setInstance(){}error(){}}},
  '../auth/findhub-auth-broker.service':{FindHubAuthBrokerService:class{}},'../auth/findhub-credential-vault':{FindHubCredentialVault:class{encrypt(v){return JSON.stringify(v)}decrypt(v){return JSON.parse(v)}}},
  './findhub-protocol.client':{FindHubProtocolClient:class{}},'./findhub-traccar.service':{FindHubTraccarService:class{async send(){}}},
  './traccar-client':{TraccarClient:class{close(){}start(fn,state){state('connected')}},resolveTraccarConnection:c=>c,traccarDestination:v=>new URL(v)},
 };
 const {FindHubStartupService}=load(dir+'findhub-runtime.service.ts',overrides,globals);
 const runtime=new FindHubStartupService({get(){return {URL:'https://connect.example.invalid'}}},emitter,db);
 runtime.setInstance({instanceName:'account-a',instanceId:'a',token:'private-api-key'});runtime.stateConnection={state:'open'};runtime.protocol={ready:true,async close(){},async locate(){return []}};
 return {runtime,db,row,other,positions,events,calls,emitter,account};
}
test('runtime refuses a device belonging to a different account',async()=>{const h=runtimeHarness();await assert.rejects(h.runtime.device('d-b'),/not found/);assert.equal(h.calls[0][1].instanceId,'a')});
test('history is deduplicated and scoped; last position never regresses',async()=>{const h=runtimeHarness(),d=await h.runtime.device('d-a'),p={...position,deviceId:d.id,googleDeviceId:d.googleDeviceId};await h.runtime.persistPosition(d,p);await h.runtime.persistPosition(d,p);assert.equal(h.positions.length,1);const older={...p,timestamp:new Date(now-50000).toISOString(),latitude:-13};await h.runtime.persistPosition(d,older);assert.equal(h.row.latestPosition.latitude,p.latitude);assert.equal(h.positions.length,2);assert.equal(h.other.latestPosition,null);assert.ok(h.calls.filter(c=>c[0]==='update').every(c=>c[1].instanceId==='a'))});
test('disabled historian keeps last position but adds no historical row',async()=>{const h=runtimeHarness();h.account.trackingSettings.historyEnabled=false;await h.runtime.persistPosition(await h.runtime.device('d-a'),position);assert.equal(h.positions.length,0);assert.equal(h.row.latestPosition.latitude,position.latitude)});
test('retention 0 preserves all history; positive retention never deletes another account',async()=>{const h=runtimeHarness();h.account.trackingSettings.retentionDays=0;assert.equal(await h.runtime.pruneHistory(),0);h.account.trackingSettings.retentionDays=1;h.runtime.options=undefined;h.positions.push({id:'old-a',instanceId:'a',deviceId:'d-a',recordedAt:new Date(now-172800000)},{id:'old-b',instanceId:'b',deviceId:'d-b',recordedAt:new Date(now-172800000)});assert.equal(await h.runtime.pruneHistory(),1);assert.equal(h.positions[0].instanceId,'b')});
test('runtime SSE subscription does not receive other account events or API credentials',async()=>{const h=runtimeHarness(),seen=[];const stop=h.runtime.subscribe(e=>seen.push(e));h.emitter.emit('findhub:stream:b',{instanceId:'b'});await h.runtime.emit('findhub.location.updated',{location:position});assert.equal(seen.length,1);assert.equal(seen[0].instanceId,'a');assert.ok(!JSON.stringify(seen).includes('private-api-key'));stop();await h.runtime.emit('findhub.error',{});assert.equal(seen.length,1)});
test('history query checks device ownership before reading rows',async()=>{const h=runtimeHarness();await assert.rejects(h.runtime.positions('d-b'));assert.equal(h.calls.filter(c=>c[0]==='history-read').length,0)});
test('settings use an allowlist, never exposing or accepting credential fields',async()=>{const h=runtimeHarness();await assert.rejects(h.runtime.saveSettings({token:'bad'}));const saved=await h.runtime.saveSettings({retentionDays:0});assert.equal(saved.retentionDays,0);assert.equal(h.account.trackingSettings.retentionDays,0)});
test('snapshot reports verified status, real counters, settings and no provider credentials',async()=>{const h=runtimeHarness();const result=await h.runtime.snapshot();assert.equal(result.connected,true);assert.equal(result.devices.length,1);assert.equal(result.counts.devices,1);assert.equal(result.email,'a@example.invalid');assert.equal(result.traccar.mode,'disabled');assert.ok(!JSON.stringify(result).includes('private-api-key'))});


test('manual locate honors its timeout without enabling tracking',async()=>{const h=runtimeHarness();let selected;h.runtime.protocol={locate:async(d,t)=>{selected=t;return []}};await h.runtime.locate('d-a',90000);assert.equal(selected,90000);assert.equal(h.row.trackingEnabled,false);await assert.rejects(h.runtime.locate('d-a',0));});
test('metadata-only push does not consume a pending location request',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g'},30000);
 h.finish();await Promise.resolve();await Promise.resolve();
 h.push([]);assert.equal(h.client.pending.size,1);
 h.push([position]);const rows=await waiting;assert.equal(rows.length,1);assert.equal(h.client.pending.size,0);
});

for (const intervalSeconds of [0,1,2,15,30,60,86400]) test('requested interval survives validation: '+intervalSeconds,()=>{assert.equal(policy.trackingSettings({intervalSeconds}).intervalSeconds,intervalSeconds);assert.equal(policy.trackingDelayMs(intervalSeconds),intervalSeconds*1000)});
test('legacy env recommendation cannot override explicit zero',()=>{const p=load(dir+'findhub-tracking.policy.ts',{}, {process:{env:{FINDHUB_MIN_TRACKING_INTERVAL_SECONDS:'30'}}});assert.equal(p.trackingMinimum(),0);assert.equal(p.trackingSettings({intervalSeconds:0}).intervalSeconds,0)});
test('zero interval retries yield and back off after failures',()=>{assert.equal(policy.trackingDelayMs(0,1),2000);assert.equal(policy.trackingDelayMs(0,4),16000);assert.equal(policy.trackingDelayMs(2,0),2000)});

test('zero tracking persists, restores and never overlaps a pending request',async()=>{
 const timers=[];const h=runtimeHarness({setTimeout(fn,delay){const timer={fn,delay,unref(){}};timers.push(timer);return timer},clearTimeout(){}});
 let release,calls=0;h.runtime.locate=async()=>{calls++;return await new Promise(r=>release=r)};
 await h.runtime.startTracking('d-a',0,30000);assert.equal(h.row.trackingIntervalSeconds,0);assert.equal(timers[0].delay,0);
 const running=timers[0].fn();await Promise.resolve();assert.equal(calls,1);assert.equal(timers.length,1);
 release(position);await running;assert.equal(timers[1].delay,0);
 await h.runtime.stopTracking('d-a');await timers[1].fn();assert.equal(calls,1);
 h.row.trackingEnabled=true;await h.runtime.restoreTracking();assert.equal(timers.at(-1).delay,0);
});

// Full-stack evolution: deadlines and avatars are exclusive to Find Hub.
for(const timeout of [1,2,4999,120001,2147483647]) test('operator deadline is preserved: '+timeout,()=>{
 assert.equal(policy.trackingSettings({timeoutMs:timeout}).timeoutMs,timeout);
});
const avatarCodec=load(dir+'findhub-avatar.ts');
function pngFixture(width=2,height=2,metadata=false) {
 const zlib=require('node:zlib');
 function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1))}return(c^0xffffffff)>>>0}
 function chunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),out.length-4);return out}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...(metadata?[chunk('tEXt',Buffer.from('Comment\0private-metadata'))]:[]),chunk('IDAT',zlib.deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
test('avatar validates raster and strips metadata without fetching external URLs',()=>{
 const image=pngFixture();assert.equal(avatarCodec.normalizeFindHubAvatar(image),image);
 assert.equal(avatarCodec.normalizeFindHubAvatar(pngFixture(2,2,true)),image);
 assert.equal(avatarCodec.normalizeFindHubAvatar(null),null);
 for(const value of [undefined,'https://example.invalid/photo.png','data:image/svg+xml;base64,AAAA',pngFixture(257,1)]) assert.throws(()=>avatarCodec.normalizeFindHubAvatar(value));
 const bytes=Buffer.from(image.split(',')[1],'base64');bytes[bytes.length-1]^=1;
 assert.throws(()=>avatarCodec.normalizeFindHubAvatar('data:image/png;base64,'+bytes.toString('base64')));
});
test('avatar update is instance-scoped, preserves other devices and emits compact revision',async()=>{
 const h=runtimeHarness(),image=pngFixture();await assert.rejects(h.runtime.setDeviceAvatar('d-b',image));
 await h.runtime.setDeviceAvatar('d-a',image);assert.equal(h.row.avatarData,image);assert.equal(h.other.avatarData,undefined);
 const snap=await h.runtime.snapshot();assert.ok(snap.devices[0].avatarVersion);assert.equal(snap.devices[0].avatarData,undefined);
 assert.ok(!JSON.stringify(h.events).includes('data:image'));
 await h.runtime.setDeviceAvatar('d-a',null);assert.equal(h.row.avatarData,null);
});
test('Google synchronization never overwrites operator avatar',async()=>{
 const h=runtimeHarness(),image=pngFixture();h.row.avatarData=image;
 h.runtime.protocol.listDevices=async()=>[{googleDeviceId:'g-a',name:'Updated name',deviceType:'PHONE',identifierType:'ANDROID'}];
 h.db.findHubDevice.upsert=async({update})=>{assert.equal(Object.hasOwn(update,'avatarData'),false);Object.assign(h.row,update);return h.row};
 await h.runtime.refreshDevices();assert.equal(h.row.avatarData,image);
});
function protocolDeadlineHarness(observer){
 const timers=[],calls=[];let finish;
 const overrides={
  '../auth/google-play-auth.client':{GooglePlayAuthClient:class{}},
  '../protocol/fcm.client':{FindHubFcmClient:class{ready=true;registrationToken='fixture'}},
  '../protocol/nova.client':{FindHubNovaClient:class{locate(args,signal){calls.push({args,signal});return new Promise(resolve=>finish=resolve)}}},
  '../protocol/spot.client':{FindHubSpotClient:class{}},
  '../crypto/findhub-crypto':{decryptIdentityKey:()=>Buffer.alloc(32),decryptLocationReport:(_key,report)=>report.location},
  '../protocol/findhub-proto':{
   decodeDeviceMetadata:()=>[],
   decodeDeviceRegistration:()=>({encryptedIdentityKey:Buffer.alloc(32)}),
   decodeLocationReports:metadata=>JSON.parse(metadata.toString()).map(p=>({encryptedLocation:Buffer.from('fixture'),location:p,timestampSeconds:Date.parse(p.timestamp)/1000,ownReport:true})),
   decodeDeviceUpdate:payload=>{const value=JSON.parse(payload.toString());return {requestUuid:value.id,deviceMetadata:Buffer.from(JSON.stringify(value.positions))}},
  },
 };
 const globals={setTimeout(fn,ms){const timer={fn,ms,unref(){},cleared:false};timers.push(timer);return timer},clearTimeout(t){if(t)t.cleared=true}};
 const {FindHubProtocolClient}=load(dir+'findhub-protocol.client.ts',overrides,globals);
 const client=new FindHubProtocolClient({aas:{},ownerKey:Buffer.alloc(32).toString('base64')},Buffer.alloc(32),'fixture',async()=>{},observer);
 return {client,timers,calls,finish:()=>finish(),push(positions,id=calls[0].args.requestUuid){client.handlePushPayload(Buffer.from(JSON.stringify({id,positions})))}};
}
test('1 ms deadline bounds HTTP even when Google push arrives first',async()=>{
 const h=protocolDeadlineHarness();const pending=h.client.locate({id:'one',googleDeviceId:'g'},1);
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,1);
 h.push([position]);h.timers[0].fn();
 await assert.rejects(pending,/timed out/);assert.equal(h.calls[0].signal.aborted,true);h.finish();
 assert.equal(h.client.pending.size,0);assert.ok(h.timers.every(t=>t.cleared));
});
test('submission failure releases push waiter and absolute deadline',async()=>{
 const h=protocolDeadlineHarness();h.client.nova.locate=async()=>{throw Error('upstream fixture')};
 await assert.rejects(h.client.locate({id:'one',googleDeviceId:'g'},2),/upstream fixture/);
 assert.equal(h.client.pending.size,0);assert.ok(h.timers.every(t=>t.cleared));
});
test('Nova abort before token resolution cannot submit a late location command',async()=>{
 let resolveToken,calls=0;const auth={serviceToken:()=>new Promise(resolve=>resolveToken=resolve)};
 const {FindHubNovaClient}=load('src/api/integrations/channel/findhub/protocol/nova.client.ts',{'../auth/google-play-auth.client':{},'./findhub-proto':{encodeExecuteLocateRequest:()=>Buffer.alloc(0)}},{fetch:()=>{calls++;throw Error('late network')}});
 const controller=new AbortController(),client=new FindHubNovaClient(auth,{});
 const pending=client.locate({},controller.signal);controller.abort();resolveToken('fixture');await assert.rejects(pending);assert.equal(calls,0);
});


test('cached FCM report cannot consume the request before a newer real report',async()=>{
 const h=protocolDeadlineHarness(),old={...position,timestamp:new Date(now-600000).toISOString()};
 const waiting=h.client.locate({id:'one',googleDeviceId:'g',latestPosition:old},5000);
 h.finish();await Promise.resolve();await Promise.resolve();
 h.push([old]);assert.equal(h.client.pending.size,1);
 h.push([position]);const rows=await waiting;
 assert.equal(rows[0].timestamp,position.timestamp);assert.equal(h.client.pending.size,0);
 assert.equal(h.calls.length,1);assert.ok(h.timers.every(t=>t.cleared));
});
test('only correlated cached reports are returned at deadline, not a fabricated new fix',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g',latestPosition:position},10);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([position]);
 assert.equal(h.client.pending.size,1);h.timers[0].fn();const rows=await waiting;
 assert.equal(rows[0].timestamp,position.timestamp);assert.equal(rows[0].latitude,position.latitude);
 assert.equal(h.client.pending.size,0);
});
test('an unrelated request cannot satisfy the lookup and timeout never falls back to DB position',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g',latestPosition:position},1);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([position],'another-request');
 h.timers[0].fn();await assert.rejects(waiting,/timed out/);assert.equal(h.client.pending.size,0);
 h.push([position]);assert.equal(h.client.pending.size,0);
});
test('invalid report does not prevent a later valid report in the same request',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g'},30);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([{...position,latitude:999}]);
 assert.equal(h.client.pending.size,1);h.push([position]);assert.equal((await waiting)[0].latitude,position.latitude);
});
test('same coordinates with a newer upstream timestamp are a genuine new observation',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g',latestPosition:{...position,timestamp:new Date(now-50000).toISOString()}},30);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([position]);assert.equal((await waiting)[0].timestamp,position.timestamp);
});
test('runtime exposes cached versus new observation without changing location response shape',async()=>{
 const h=runtimeHarness(),seen=[];h.runtime.subscribe(event=>seen.push(event));h.row.latestPosition={...position,deviceId:'d-a',googleDeviceId:'g-a'};h.row.lastLocationAt=new Date(position.timestamp);
 h.runtime.protocol.locate=async()=>[{...position,deviceId:'d-a',googleDeviceId:'g-a'}];
 const response=await h.runtime.locate('d-a',10);assert.equal(response.latitude,position.latitude);
 assert.equal(seen.at(-1).data.query.status,'known_position');assert.equal((await h.runtime.snapshot()).devices[0].lastQuery.timeoutMs,10);
 assert.equal(h.row.lastLocationAt.getTime(),Date.parse(position.timestamp));
});
test('timeout state is localized by UI but backend preserves existing position and report time',async()=>{
 const h=runtimeHarness();h.row.latestPosition=position;h.runtime.protocol.locate=async()=>{throw Error('Google Find Hub location request timed out')};
 await assert.rejects(h.runtime.locate('d-a',1));const snap=await h.runtime.snapshot();
 assert.equal(h.row.latestPosition,position);assert.equal(snap.devices[0].lastQuery.status,'timeout');
 assert.equal(h.row.lastErrorCode,'LOCATION_TIMEOUT');assert.equal(h.positions.length,0);
});

// Independent protocol fixtures from the supplied reference. No Google/account credentials are used.
const portVectors = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/findhub-port-vectors.json'),'utf8'));
const ownedProto = load('src/api/integrations/channel/findhub/protocol/findhub-proto.ts');
const ownedCrypto = load('src/api/integrations/channel/findhub/crypto/findhub-crypto.ts');
test('port parity: Nova location command is byte-for-byte equal to attached reference',()=>{
 const wire=ownedProto.encodeExecuteLocateRequest({googleDeviceId:'device-fixture',fcmRegistrationId:'fcm-fixture',requestUuid:'request-fixture',clientUuid:'client-fixture'});
 assert.equal(wire.toString('hex'),portVectors.wireRequest);
});
for(const vector of portVectors.network)for(const own of [false,true])test('port parity: independent EAX network report '+vector.name+' own='+own,()=>{
 const u=ownedProto.decodeDeviceUpdate(Buffer.from(vector[own?'updateOwn':'update'],'hex'));
 const registration=ownedProto.decodeDeviceRegistration(u.deviceMetadata);
 const key=ownedCrypto.decryptIdentityKey(Buffer.from(portVectors.ownerKey,'hex'),registration.encryptedIdentityKey);
 assert.equal(key.toString('hex'),portVectors.identityKey);
 const report=ownedProto.decodeLocationReports(u.deviceMetadata)[0];
 const p=ownedCrypto.decryptLocationReport(key,report);
 assert.equal(p.latitude,vector.latitude);assert.equal(p.longitude,vector.longitude);assert.equal(p.altitude,vector.altitude);
 assert.equal(report.deviceTimeOffset,vector.deviceTimeOffset);assert.equal(report.timestampSeconds,vector.timestampSeconds);
});
test('port parity: AES-GCM recent report remains compatible',()=>{
 const p=ownedCrypto.decryptLocationReport(Buffer.from(portVectors.identityKey,'hex'),{encryptedLocation:Buffer.from(portVectors.recentGcm,'hex'),publicKeyRandom:Buffer.alloc(0),ownReport:true});
 assert.equal(p.latitude,12.3456789);assert.equal(p.longitude,-45.1234567);assert.equal(p.altitude,12);
});
test('network report rejects a tampered authentication tag',()=>{
 const u=ownedProto.decodeDeviceUpdate(Buffer.from(portVectors.network[0].update,'hex'));const report=ownedProto.decodeLocationReports(u.deviceMetadata)[0];
 report.encryptedLocation[0]^=1;assert.throws(()=>ownedCrypto.decryptLocationReport(Buffer.from(portVectors.identityKey,'hex'),report));
});
test('FCM observation survives local HTTP timeout without making timed-out request successful',async()=>{
 const seen=[],h=protocolDeadlineHarness(o=>seen.push(o));const p=h.client.locate({id:'one',googleDeviceId:'g'},1);
 h.finish();await Promise.resolve();await Promise.resolve();h.timers[0].fn();await assert.rejects(p,/timed out/);
 h.push([position]);assert.equal(seen.length,1);assert.equal(seen[0].afterRequest,true);assert.equal(seen[0].positions[0].timestamp,position.timestamp);
 assert.equal(h.client.pending.size,0);h.push([position]);assert.equal(seen.length,1);
 h.client.stopObserving('one');h.push([{...position,timestamp:new Date(now).toISOString()}]);assert.equal(seen.length,1);
});
test('all valid observations are delivered immediately, including later fixes of a completed command',async()=>{
 const seen=[],h=protocolDeadlineHarness(o=>seen.push(o));const p=h.client.locate({id:'one',googleDeviceId:'g'},5000);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([position]);await p;
 const fresh={...position,latitude:-11,timestamp:new Date(now).toISOString()};h.push([fresh]);
 assert.equal(seen.length,2);assert.equal(seen[1].positions[0].latitude,-11);assert.equal(seen[1].afterRequest,true);
 h.push([fresh],'unknown-id');assert.equal(seen.length,2);
});
test('observation registry is bounded and disconnect drops correlations',async()=>{
 const h=protocolDeadlineHarness();h.client.fcm.stop=async()=>{};
 for(let i=0;i<514;i++)h.client.observations.set('old-'+i,{device:{id:'one'},expiresAt:Date.now()+10000,delivered:new Set()});
 h.client.pruneObservations();assert.ok(h.client.observations.size<=512);
 h.client.observations.set('expired',{device:{id:'one'},expiresAt:0,delivered:new Set()});h.client.pruneObservations();assert.equal(h.client.observations.has('expired'),false);
 await h.client.close();assert.equal(h.client.observations.size,0);
});
test('runtime writes a late observation only for actively tracked owned device',async()=>{
 const h=runtimeHarness(),p={...position,deviceId:'d-a',googleDeviceId:'g-a'};let forwards=0;h.runtime.forwardTraccar=async()=>forwards++;
 await h.runtime.acceptObservations('d-a',[p],0,h.runtime.protocol,true);assert.equal(h.row.latestPosition,null);
 h.row.trackingEnabled=true;await h.runtime.acceptObservations('d-a',[p],0,h.runtime.protocol,true);
 assert.equal(h.row.latestPosition.latitude,p.latitude);assert.equal(forwards,1);assert.equal(h.positions.length,1);
 await h.runtime.acceptObservations('d-a',[p],0,h.runtime.protocol,true);assert.equal(forwards,1);assert.equal(h.positions.length,1);
 await h.runtime.acceptObservations('d-a',[{...p,deviceId:'d-b',googleDeviceId:'g-b'}],0,h.runtime.protocol,true);assert.equal(h.other.latestPosition,null);
 await assert.rejects(h.runtime.acceptObservations('d-b',[p],0,h.runtime.protocol,true));
 const oldProtocol=h.runtime.protocol;await h.runtime.closeClient();await h.runtime.acceptObservations('d-a',[{...p,latitude:10}],0,oldProtocol,true);assert.equal(forwards,1);
});
test('concurrent observer and HTTP result persist/forward a new report once',async()=>{
 const h=runtimeHarness(),p={...position,deviceId:'d-a',googleDeviceId:'g-a'};let forwards=0;h.runtime.forwardTraccar=async()=>forwards++;
 await Promise.all([h.runtime.acceptObservations('d-a',[p],0,h.runtime.protocol,false),h.runtime.acceptObservations('d-a',[p],0,h.runtime.protocol,false)]);
 assert.equal(forwards,1);assert.equal(h.positions.length,1);assert.equal(h.runtime.observationWrites.size,0);
});
function heartbeatHarness(){
 const timers=[],writes=[];let destroyed=0;
 const {FindHubFcmClient}=load('src/api/integrations/channel/findhub/protocol/fcm.client.ts',{'tls':{}},{setTimeout(fn,ms){const t={fn,ms,unref(){},cleared:false};timers.push(t);return t},clearTimeout(t){if(t)t.cleared=true}});
 const client=new FindHubFcmClient(null,async()=>{},()=>{});client.authenticated=true;client.socket={write(packet){writes.push(packet)},destroy(){destroyed++}};
 return{client,timers,writes,get destroyed(){return destroyed}};
}
test('FCM monitor sends an idle heartbeat and closes a silent half-open connection',()=>{
 const h=heartbeatHarness();h.client.monitorHeartbeat();assert.equal(h.timers[0].ms,20000);h.timers[0].fn();assert.equal(h.writes[0][1],0);
 assert.equal(h.timers[1].ms,5000);h.timers[1].fn();assert.equal(h.destroyed,1);assert.equal(h.client.ready,false);
});
test('FCM heartbeat ACK clears its deadline; stop removes heartbeat timers',async()=>{
 const h=heartbeatHarness();h.client.monitorHeartbeat();h.timers[0].fn();h.client.handleFrame(1,Buffer.alloc(0));assert.equal(h.timers[1].cleared,true);assert.equal(h.timers.at(-1).ms,20000);
 await h.client.stop();assert.ok(h.timers.slice(1).every(t=>t.cleared));assert.equal(h.client.ready,false);
});
test('reference protobuf + real EAX decode reaches runtime, history and SSE after HTTP deadline',async()=>{
 const h=runtimeHarness();h.row.googleDeviceId='device-fixture';h.row.trackingEnabled=true;
 const frames=[],writes=[],timers=[];h.runtime.subscribe(e=>frames.push(e));let forwards=0;h.runtime.forwardTraccar=async()=>forwards++;
 const {FindHubProtocolClient}=load(dir+'findhub-protocol.client.ts',{
  crypto:{...require('node:crypto'),randomUUID:()=> 'request-fixture'},
  '../auth/google-play-auth.client':{GooglePlayAuthClient:class{}},
  '../protocol/fcm.client':{FindHubFcmClient:class{ready=true;registrationToken='synthetic-token';async stop(){}}},
  '../protocol/nova.client':{FindHubNovaClient:class{async locate(){}}},
  '../protocol/spot.client':{FindHubSpotClient:class{}},
 },{setTimeout(fn,ms){const t={fn,ms,unref(){}};timers.push(t);return t},clearTimeout(){}});
 const protocol=new FindHubProtocolClient({ownerKey:Buffer.from(portVectors.ownerKey,'hex').toString('base64'),aas:{}},Buffer.alloc(32),'fixture-client',async()=>{},o=>writes.push(h.runtime.acceptObservations(o.deviceId,o.positions,0,protocol,o.afterRequest)));
 h.runtime.protocol=protocol;
 const pending=protocol.locate(await h.runtime.device('d-a'),1);
 await Promise.resolve();await Promise.resolve();timers[0].fn();await assert.rejects(pending,/timed out/);
 protocol.handlePushPayload(Buffer.from(portVectors.network[0].update,'hex'));await Promise.all(writes);
 assert.equal(h.row.latestPosition.latitude,portVectors.network[0].latitude);assert.equal(h.row.latestPosition.longitude,portVectors.network[0].longitude);
 assert.equal(h.row.latestPosition.timestamp,new Date(portVectors.network[0].timestampSeconds*1000).toISOString());
 assert.equal(h.row.latestPosition.source,'CROWDSOURCED');assert.equal(h.positions.length,1);assert.equal(forwards,1);
 const frame=frames.find(f=>f.event==='findhub.location.updated');assert.equal(frame.instanceId,'a');assert.equal(frame.data.device.id,'d-a');assert.equal(frame.data.location.longitude,portVectors.network[0].longitude);
 protocol.handlePushPayload(Buffer.from(portVectors.network[0].update,'hex'));await Promise.all(writes);assert.equal(forwards,1);
 await protocol.close();
});
