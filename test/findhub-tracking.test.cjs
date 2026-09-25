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
 const account={id:'account-a',instanceId:'a',googleEmail:'a@example.invalid',trackingSettings:{intervalSeconds:60,timeoutMs:30000,staleAfterSeconds:300,historyEnabled:true,retentionDays:30,reconciliationEnabled:true,reconciliationOnBoot:true,reconciliationPeriodicEnabled:false,reconciliationPeriodSeconds:3600,reconciliationMinGapSeconds:300,reconciliationAttempts:3},encryptedTraccar:null};
 function match(r,w){return Object.entries(w||{}).every(([k,v])=>{if(k==='OR')return v.some(x=>match(r,x));if(v && typeof v==='object'){if('in' in v)return v.in.includes(r[k]);if('gt' in v && !(r[k]>v.gt))return false;if('gte' in v && !(r[k]>=v.gte))return false;if('lt' in v && !(r[k]<v.lt))return false;if('lte' in v && !(r[k]<=v.lte))return false;if('equals' in v)return v.equals===null?r[k]==null:r[k]===v.equals;if(['gt','gte','lt','lte'].some(op=>op in v))return true;}return r[k]===v})}
 const db={instance:{async update(){}},findHubAccount:{async findUnique({where}){assert.equal(where.instanceId,'a');return account},async update({where,data}){assert.equal(where.instanceId,'a');Object.assign(account,data);return account}},
  findHubDevice:{async findFirst({where}){calls.push(['device',where]);return devices.find(d=>match(d,where))},async findMany({where}){return devices.filter(d=>match(d,where))},async updateMany({where,data}){calls.push(['update',where]);let n=0;for(const d of devices)if(match(d,where)){Object.assign(d,data);n++}return {count:n}},async update({where,data}){const d=devices.find(d=>d.id===where.id);Object.assign(d,data);return d}},
  findHubPosition:{async count({where}={}){return positions.filter(p=>match(p,where||{})).length},async upsert({where,create}){calls.push(['history',where]);let old=positions.find(p=>p.fingerprint===create.fingerprint&&p.instanceId===create.instanceId&&p.deviceId===create.deviceId);if(!old){old={id:'p-'+positions.length,...create};positions.push(old)}return old},async findMany({where,take,orderBy,select}={}){calls.push(['history-read',where]);let rows=positions.filter(p=>match(p,where||{}));if(orderBy?.recordedAt==='asc')rows.sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));if(orderBy?.recordedAt==='desc')rows.sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));rows=rows.slice(0,take??rows.length);if(select)rows=rows.map(r=>Object.fromEntries(Object.keys(select).filter(k=>select[k]).map(k=>[k,r[k]])));return rows},async deleteMany({where}){calls.push(['history-delete',where]);let n=0;for(let i=positions.length-1;i>=0;i--)if(match(positions[i],where)){positions.splice(i,1);n++}return {count:n}}},
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
test('reconciliation settings are additive and keep periodic mode opt-in',()=>{
 const settings=policy.trackingSettings({});
 assert.equal(settings.reconciliationEnabled,true);
 assert.equal(settings.reconciliationOnBoot,true);
 assert.equal(settings.reconciliationPeriodicEnabled,false);
 assert.equal(settings.reconciliationPeriodSeconds,3600);
 assert.equal(settings.reconciliationMinGapSeconds,300);
 assert.equal(settings.reconciliationAttempts,3);
});
test('manual reconciliation imports every valid Google report while measuring only the target gap',async()=>{
 const h=runtimeHarness();h.row.trackingEnabled=true;h.row.lastLocationAt=new Date(now-5*60*60*1000);
 const inGap={...position,deviceId:'d-a',googleDeviceId:'g-a',timestamp:new Date(now-2*60*60*1000).toISOString(),source:'NETWORK'};
 const olderAvailable={...inGap,timestamp:new Date(now-8*60*60*1000).toISOString(),latitude:-11.5};
 let locateCalls=0;h.runtime.protocol.locate=async()=>{locateCalls++;return [inGap,olderAvailable]};
 const result=await h.runtime.reconcileDevice('d-a',{from:new Date(now-5*60*60*1000).toISOString(),to:new Date(now).toISOString(),attempts:3,timeoutMs:10});
 assert.equal(result.recoveredPositions,1);assert.equal(result.providerReportsObserved,2);assert.equal(result.completenessGuaranteed,false);
 assert.equal(h.positions.length,2);assert.equal(locateCalls,3);
 const repeated=await h.runtime.reconcileDevice('d-a',{from:new Date(now-5*60*60*1000).toISOString(),to:new Date(now).toISOString(),attempts:2,timeoutMs:10});
 assert.equal(repeated.recoveredPositions,0);assert.equal(h.positions.length,2);
});
test('reconciliation does not run concurrently with an active tracking dispatch',async()=>{
 const h=runtimeHarness();h.runtime.dispatching.add('d-a');
 await assert.rejects(h.runtime.reconcileDevice('d-a',{}),/executando uma consulta/);
});

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

test('zero tracking dispatches continuously without blocking a manual locate',async()=>{
 const timers=[];const h=runtimeHarness({setTimeout(fn,delay){const timer={fn,delay,unref(){}};timers.push(timer);return timer},clearTimeout(){}});
 let release,dispatchCalls=0,manualCalls=0;
 h.runtime.protocol.requestLocation=async()=>{dispatchCalls++;return await new Promise(r=>release=r)};
 h.runtime.protocol.locate=async()=>{manualCalls++;return [{...position,deviceId:'d-a',googleDeviceId:'g-a'}]};
 await h.runtime.startTracking('d-a',0,30000);assert.equal(h.row.trackingIntervalSeconds,0);assert.equal(timers[0].delay,0);
 const running=timers[0].fn();for(let i=0;i<10 && dispatchCalls===0;i++) await Promise.resolve();assert.equal(dispatchCalls,1);
 const manual=await h.runtime.locate('d-a',10);assert.equal(manual.latitude,position.latitude);assert.equal(manualCalls,1);
 release('request');await running;assert.equal(timers.at(-1).delay,0);
 await h.runtime.stopTracking('d-a');const before=dispatchCalls;await timers.at(-1).fn();assert.equal(dispatchCalls,before);
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
function protocolDeadlineHarness(metadataIds=[]){
 const timers=[],calls=[];let finish;
 const overrides={
  '../auth/google-play-auth.client':{GooglePlayAuthClient:class{}},
  '../protocol/fcm.client':{FindHubFcmClient:class{ready=true;registrationToken='fixture';async stop(){this.ready=false}}},
  '../protocol/nova.client':{FindHubNovaClient:class{locate(args,signal){calls.push({args,signal});return new Promise(resolve=>finish=resolve)}}},
  '../protocol/spot.client':{FindHubSpotClient:class{}},
  '../crypto/findhub-crypto':{decryptIdentityKey:()=>Buffer.alloc(32),decryptLocationReport:(_key,report)=>report.location},
  '../protocol/findhub-proto':{
   decodeDeviceMetadata:()=>metadataIds.map(googleDeviceId=>({googleDeviceId})),
   decodeDeviceRegistration:()=>({encryptedIdentityKey:Buffer.alloc(32)}),
   decodeLocationReports:metadata=>JSON.parse(metadata.toString()).map(p=>({encryptedLocation:Buffer.from('fixture'),location:p,timestampSeconds:Date.parse(p.timestamp)/1000,ownReport:true})),
   decodeDeviceUpdate:payload=>{const value=JSON.parse(payload.toString());return {requestUuid:value.id,deviceMetadata:Buffer.from(JSON.stringify(value.positions))}},
  },
 };
 const globals={setTimeout(fn,ms){const timer={fn,ms,unref(){},cleared:false};timers.push(timer);return timer},clearTimeout(t){if(t)t.cleared=true}};
 const {FindHubProtocolClient}=load(dir+'findhub-protocol.client.ts',overrides,globals);
 const client=new FindHubProtocolClient({aas:{},ownerKey:Buffer.alloc(32).toString('base64')},Buffer.alloc(32),'fixture',async()=>{});
 return {client,timers,calls,finish:()=>finish(),push(positions,id=calls[0].args.requestUuid){client.handlePushPayload(Buffer.from(JSON.stringify({id,positions})))}};
}
test('1 ms operator wait starts after command submission and never cancels the command',async()=>{
 const h=protocolDeadlineHarness();h.client.onObservation=async()=>{};const pending=h.client.locate({id:'one',googleDeviceId:'g'},1);
 assert.equal(h.timers.length,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,false);
 h.finish();await Promise.resolve();await Promise.resolve();
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,1);h.timers[0].fn();
 const rows=await pending;assert.equal(rows.length,0);assert.equal(h.calls[0].signal.aborted,false);
 assert.equal(h.client.pending.size,0);assert.equal(h.client.recent.size,1);
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
test('an unrelated request cannot satisfy the lookup and caller wait never falls back to DB position',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g',latestPosition:position},1);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([position],'another-request');
 h.timers[0].fn();assert.equal((await waiting).length,0);assert.equal(h.client.pending.size,0);
 h.push([position]);assert.equal(h.client.pending.size,0);
});
test('invalid report does not prevent a later valid report in the same request',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g'},30);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([{...position,latitude:999}]);
 assert.equal(h.client.pending.size,1);h.push([position]);assert.equal((await waiting)[0].latitude,position.latitude);
});
test('same timestamp with better accuracy is accepted as a refined observation',()=>{
 assert.equal(policy.isNewPositionObservation({...position,accuracy:10},{...position,accuracy:100}),true);
 assert.equal(policy.isNewPositionObservation({...position,source:'RECENT'},{...position,source:'NETWORK'}),false);
});
test('same coordinates with a newer upstream timestamp are a genuine new observation',async()=>{
 const h=protocolDeadlineHarness();const waiting=h.client.locate({id:'one',googleDeviceId:'g',latestPosition:{...position,timestamp:new Date(now-50000).toISOString()}},30);
 h.finish();await Promise.resolve();await Promise.resolve();h.push([position]);assert.equal((await waiting)[0].timestamp,position.timestamp);
});
test('runtime exposes cached versus new observation without changing location response shape',async()=>{
 const h=runtimeHarness(),seen=[];h.runtime.subscribe(event=>seen.push(event));h.row.latestPosition={...position,deviceId:'d-a'};
 h.runtime.protocol.locate=async()=>[{...position,deviceId:'d-a'}];
 const response=await h.runtime.locate('d-a',10);assert.equal(response.latitude,position.latitude);
 assert.equal(seen.at(-1).data.query.status,'known_position');assert.equal((await h.runtime.snapshot()).devices[0].lastQuery.timeoutMs,10);
 assert.equal(h.row.lastLocationAt.getTime(),Date.parse(position.timestamp));
});
test('command timeout is distinct from realtime observation wait and preserves previous position',async()=>{
 const h=runtimeHarness();h.row.latestPosition=position;h.runtime.protocol.locate=async()=>{throw Error('Google Find Hub command timed out')};
 await assert.rejects(h.runtime.locate('d-a',1));const snap=await h.runtime.snapshot();
 assert.equal(h.row.latestPosition,position);assert.equal(snap.devices[0].lastQuery.status,'command_timeout');
 assert.equal(h.row.lastErrorCode,'LOCATION_COMMAND_TIMEOUT');assert.equal(h.positions.length,0);
});


// Live receiver regressions: a caller deadline is not the lifetime of an issued observation.
test('late correlated push is delivered after the caller wait expires without canceling the issued command',async()=>{
 const h=protocolDeadlineHarness(),received=[];h.client.onObservation=async(d,p)=>received.push({d,p});
 const waiting=h.client.locate({id:'one',googleDeviceId:'g'},1);
 h.finish();await Promise.resolve();await Promise.resolve();h.timers[0].fn();assert.equal((await waiting).length,0);
 assert.equal(h.calls[0].signal.aborted,false);assert.equal(h.client.pending.size,0);
 h.push([position]);assert.equal(received.length,1);assert.equal(received[0].p[0].timestamp,position.timestamp);
 h.push([position]);h.push([position],'never-issued');assert.equal(received.length,1);
});
test('subsequent fixes for the same issued command continue after its first successful result',async()=>{
 const h=protocolDeadlineHarness(),received=[];h.client.onObservation=async(d,p)=>received.push({d,p});
 const waiting=h.client.locate({id:'one',googleDeviceId:'g'},30000);h.finish();await Promise.resolve();await Promise.resolve();
 h.push([position]);await waiting;h.push([position]);assert.equal(received.length,0);
 const newer={...position,timestamp:new Date(now).toISOString()};h.push([newer]);assert.equal(received.length,1);
 assert.equal(received[0].p[0].timestamp,newer.timestamp);
});
test('expiry removes old correlations and stopping tracking revokes only tracking requests',async()=>{
 const h=protocolDeadlineHarness(),received=[];h.client.onObservation=async(d,p)=>received.push(p);
 const waiting=h.client.locate({id:'one',googleDeviceId:'g'},1);h.finish();await Promise.resolve();await Promise.resolve();
 h.timers[0].fn();await waiting;h.client.recent.values().next().value.expiresAt=0;
 h.push([position]);assert.equal(received.length,0);assert.equal(h.client.recent.size,0);
 const manual=h.client.locate({id:'one',googleDeviceId:'g'},1);h.finish();await Promise.resolve();await Promise.resolve();h.timers[1].fn();await manual;
 h.client.nova.locate=async(args)=>{h.calls.push({args,signal:new AbortController().signal})};
 await h.client.requestLocation({id:'one',googleDeviceId:'g'});assert.equal([...h.client.recent.values()].filter(x=>x.source==='tracking').length,1);
 h.client.stopObserving('one');assert.equal([...h.client.recent.values()].filter(x=>x.source==='tracking').length,0);
 assert.equal([...h.client.recent.values()].filter(x=>x.source==='manual').length,1);
});
test('closing the receiver discards pending and recent device contexts',async()=>{
 const h=protocolDeadlineHarness(),received=[];h.client.onObservation=async(d,p)=>received.push(p);
 const first=h.client.locate({id:'one',googleDeviceId:'g'},30000);h.finish();await Promise.resolve();await Promise.resolve();h.push([position]);await first;
 const second=h.client.locate({id:'two',googleDeviceId:'g2'},30000);const rejected=assert.rejects(second,/closed/);
 await h.client.close();await rejected;h.push([{...position,timestamp:new Date(now).toISOString()}]);
 assert.equal(received.length,0);assert.equal(h.client.pending.size,0);assert.equal(h.client.recent.size,0);
 assert.ok(h.timers.every(t=>t.cleared));
});
test('recent request correlation has a fixed memory bound',async()=>{
 const h=protocolDeadlineHarness();h.client.onObservation=async()=>{};
 for(let n=0;n<260;n++){
  const waiting=h.client.locate({id:'one',googleDeviceId:'g'},1);h.finish();await Promise.resolve();await Promise.resolve();
  h.timers.at(-1).fn();await waiting;
 }
 assert.equal(h.client.pending.size,0);assert.equal(h.client.recent.size,256);
 assert.equal(h.client.recent.has(h.calls[0].args.requestUuid),false);
});
test('late real observation after manual wait persists history and reaches SSE and Traccar',async()=>{
 const h=runtimeHarness(),seen=[],forwarded=[];h.runtime.subscribe(e=>seen.push(e));
 h.runtime.forwardTraccar=async(d,p)=>forwarded.push(p);h.runtime.protocol.locate=async()=>[];
 assert.equal(await h.runtime.locate('d-a',1),null);
 assert.equal((await h.runtime.snapshot()).devices[0].lastQuery.status,'awaiting_realtime');
 const incoming={...position,deviceId:'d-a',googleDeviceId:'g-a'};
 await h.runtime.receiveObservation('d-a',[incoming],0);
 assert.equal(h.row.latestPosition.timestamp,incoming.timestamp);assert.equal(h.row.lastErrorCode,null);
 assert.equal(h.positions.length,1);assert.equal(forwarded.length,1);assert.equal(seen.at(-1).data.query.status,'new_report');
 assert.equal(seen.at(-1).data.location.latitude,incoming.latitude);assert.equal(seen.at(-1).instanceId,'a');
 assert.equal((await h.runtime.snapshot()).devices[0].lastQuery.status,'new_report');
});
test('late observations are monotonic, deduplicated and scoped to the owning account/device',async()=>{
 const h=runtimeHarness(),seen=[];h.runtime.subscribe(e=>seen.push(e));const incoming={...position,deviceId:'d-a',googleDeviceId:'g-a'};
 await h.runtime.receiveObservation('d-a',[incoming],0);const count=seen.length;
 await h.runtime.receiveObservation('d-a',[incoming,{...incoming,timestamp:new Date(now-90000).toISOString()}],0);
 await h.runtime.receiveObservation('d-a',[{...incoming,googleDeviceId:'g-b',timestamp:new Date(now).toISOString()}],0);
 await assert.rejects(h.runtime.receiveObservation('d-b',[{...incoming,deviceId:'d-b',googleDeviceId:'g-b'}],0));
 await h.runtime.receiveObservation('d-a',[{...incoming,timestamp:new Date(now).toISOString()}],-1);
 assert.equal(seen.length,count);assert.equal(h.positions.length,1);assert.equal(h.other.latestPosition,null);
 assert.equal(h.row.latestPosition.timestamp,incoming.timestamp);
});
test('concurrent delivery is serialized and emits a new observation only once',async()=>{
 const h=runtimeHarness(),seen=[];h.runtime.subscribe(e=>seen.push(e));const incoming={...position,deviceId:'d-a',googleDeviceId:'g-a'};
 await Promise.all([h.runtime.receiveObservation('d-a',[incoming],0),h.runtime.receiveObservation('d-a',[incoming],0)]);
 assert.equal(h.positions.length,1);assert.equal(seen.filter(e=>e.data.location).length,1);
 await Promise.resolve();assert.equal(h.runtime.observationQueues.size,0);assert.equal(h.runtime.observationQueueSizes.size,0);
});

// Independent encrypted fixtures and transport liveness run in the normal tracking suite.
require('./findhub-live-parity.test.cjs');

test('correlated metadata belonging to another Google device is ignored without fabricating a timeout error',async()=>{
 const h=protocolDeadlineHarness(['another-device']),received=[];h.client.onObservation=async(d,p)=>received.push(p);
 const waiting=h.client.locate({id:'one',googleDeviceId:'g'},1);h.finish();await Promise.resolve();await Promise.resolve();h.push([position]);
 h.timers[0].fn();assert.equal((await waiting).length,0);h.push([position]);assert.equal(received.length,0);
});
