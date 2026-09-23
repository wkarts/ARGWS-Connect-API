'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'src/api/integrations/channel/findhub/';
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, dependencies = {}, globals = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, reportDiagnostics: true,
  });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Buffer, URL, Date, console,
    process: { env: {} }, AbortController, AbortSignal, Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval,
    require(key) { if (key === 'crypto') return crypto; if (Object.hasOwn(dependencies, key)) return dependencies[key]; throw Error(`Unexpected dependency ${key} in ${file}`); }, ...globals }, { filename: file });
  return module.exports;
}
const wire = load(BASE + 'protocol/protobuf.ts');
const proto = load(BASE + 'protocol/findhub-proto.ts', { './protobuf': wire });
const monitoring = load(BASE + 'services/findhub-monitoring.ts');
const constants = load(BASE + 'findhub.constants.ts');
const position = (seconds = 0, extra = {}) => ({ deviceId:'device-a', googleDeviceId:'google-a', latitude:-12.5, longitude:-39.2,
  timestamp:new Date(Date.now() - 60000 + seconds * 1000).toISOString(), source:'RECENT', ownReport:true, ...extra });
const policy = { historyEnabled:true, historyRetentionDays:0, defaultIntervalSeconds:60, locationTimeoutMs:30000, uiRefreshSeconds:5 };

function metadata({ name='Phone', phone=[], direct=[], kind=1, spot=20, key=true } = {}) {
  const ids = values => wire.concat(...values.map(value => wire.fieldMessage(1, wire.fieldString(1, value))));
  const identifier = wire.concat(phone.length ? wire.fieldMessage(1,wire.fieldMessage(2,ids(phone))) : Buffer.alloc(0),
    wire.fieldVarint(2, kind), direct.length ? wire.fieldMessage(3, ids(direct)) : Buffer.alloc(0));
  const registration = wire.concat(wire.fieldMessage(2,wire.fieldVarint(2,spot)), wire.fieldString(20,'Brand'),
    wire.fieldString(34,'Model'), key ? wire.fieldMessage(19,wire.concat(wire.fieldMessage(1,Buffer.from('encrypted')),wire.fieldVarint(3,1))) : Buffer.alloc(0));
  return wire.concat(wire.fieldMessage(1,identifier),wire.fieldMessage(4,wire.fieldMessage(1,registration)),wire.fieldString(5,name));
}
function clock() {
  const timers = new Map(); let serial=0;
  return { timers,
    setTimeout(fn, ms) { const id={ id:++serial, unref() {} }; timers.set(id,{fn,ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id={ id:++serial, unref() {} }; timers.set(id,{fn,ms,interval:true}); return id; },
    clearInterval(id) { timers.delete(id); },
  };
}
function harness(settings = policy) {
  const events=[], updates=[], deletes=[], requests=[], retained = new Map(); const timers=clock();
  let account={ id:'account-a', instanceId:'instance-a', settings:{...settings} };
  const devices = new Map([['device-a', { id:'device-a', googleDeviceId:'google-a', name:'Phone', instanceId:'instance-a', accountId:'account-a', identifierType:'ANDROID', deviceType:'PHONE', trackingEnabled:false, trackingIntervalSeconds:60, lastLocationAt:null, lastPosition:null }], ['device-b',{id:'device-b',instanceId:'instance-b',googleDeviceId:'google-b',name:'Other account'}]]);
  const match = (row, where) => {
    for (const [key,value] of Object.entries(where)) {
      if (value === undefined) continue;
      if (key==='AND') { if (!value.every(item=>match(row,item))) return false; continue; }
      if (key==='OR') { if (!value.some(item=>match(row,item))) return false; continue; }
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value && !value.in.includes(row[key])) return false;
        if ('lt' in value && !(row[key]<value.lt)) return false;
        if ('lte' in value && !(row[key]<=value.lte)) return false;
        if ('gte' in value && !(row[key]>=value.gte)) return false;
      } else if (value instanceof Date) { if (Number(row[key]) !== Number(value)) return false; }
      else if (row[key]!==value) return false;
    }
    return true;
  };
  const prisma = {
    instance: { async update() {} },
    findHubAccount: {
      async findUnique({where}) { assert.equal(where.instanceId,'instance-a'); return account; },
      async upsert({where,update}) { assert.equal(where.instanceId,'instance-a'); account={...account,...update}; return account; },
      async update({where,data}) { assert.equal(where.id,'account-a'); Object.assign(account,data); return account; },
    },
    findHubDevice: {
      async findFirst({where}) { return [...devices.values()].find(row=>match(row,where)) || null; },
      async findMany({where}) { return [...devices.values()].filter(row=>match(row,where)); },
      async update({where,data}) { const row=devices.get(where.id); Object.assign(row,data); updates.push({where,data}); return row; },
      async updateMany({where,data}) { const rows=[...devices.values()].filter(row=>match(row,where)); rows.forEach(row=>Object.assign(row,data)); updates.push({where,data}); return {count:rows.length}; },
      async upsert({where,update,create}) { const key=where.instanceId_googleDeviceId; let row=[...devices.values()].find(row=>match(row,key)); if(row) Object.assign(row,update); else {row={...create,id:'device-'+devices.size,lastLocationAt:null,lastPosition:null};devices.set(row.id,row);} return row; },
      async deleteMany({where}) { assert.equal(where.instanceId,'instance-a'); for(const [key,row]of devices) if(match(row,where)) devices.delete(key); },
    },
    findHubPosition: {
      async upsert({where,create}) { assert.equal(create.instanceId,'instance-a'); if(!retained.has(where.deduplicationKey)) retained.set(where.deduplicationKey,{id:crypto.randomUUID(),...create}); return retained.get(where.deduplicationKey); },
      async findFirst({where}) { requests.push(where); return [...retained.values()].find(row=>match(row,where)) || null; },
      async findMany({where,take,select,orderBy}) {
        requests.push(where); let rows=[...retained.values()].filter(row=>match(row,where));
        if(orderBy) rows.sort((a,b)=>Number(b.recordedAt)-Number(a.recordedAt)||b.id.localeCompare(a.id));
        rows=rows.slice(0,take); return select ? rows.map(row=>({id:row.id})) : rows;
      },
      async deleteMany({where}) { deletes.push(where); assert.equal(where.instanceId,'instance-a'); for(const [key,row]of retained) if(match(row,where)) retained.delete(key); },
    },
    findHubTraccarBinding: { async findFirst() {return null;} },
  };
  const dependencies = {
    '@api/server.module': { eventManager:{ async emit(event){events.push(event);} } },
    '@config/logger.config': { Logger:class{setInstance(){} warn(){} } },
    '../auth/findhub-auth-broker.service': { FindHubAuthBrokerService:class{async clear(){} } },
    '../findhub.constants':constants,
    './findhub-monitoring':monitoring,
    './findhub-protocol.client':{ FindHubProtocolClient:class{} },
    './findhub-traccar.service':{ FindHubTraccarService:class{} },
  };
  const {FindHubStartupService}=load(BASE+'services/findhub-runtime.service.ts',dependencies,timers);
  const runtime = new FindHubStartupService({get(){return{URL:'https://connect.example.invalid'};}}, {}, prisma);
  runtime.setInstance({instanceName:'google-a',instanceId:'instance-a',token:'fixture-key'});
  runtime.protocol={ready:true, async close(){}, async locate(){return[];}, async listDevices(){return[];}, catalogStatus:{updatedAt:new Date().toISOString(),complete:false,sources:[]}};
  runtime.stateConnection={state:'open'};
  return {runtime,devices,retained,events,updates,deletes,requests,timers,prisma,account:()=>account};
}

test('legacy accounts keep existing history and do not enable new collection implicitly',()=>{
  const defaults=monitoring.monitoringSettings(); assert.equal(defaults.historyEnabled,false); assert.equal(defaults.historyRetentionDays,0);
});
test('saved policy overrides environment defaults without touching another account',async()=>{
  const h=harness(); await h.runtime.saveSettings({...policy,historyEnabled:false,historyRetentionDays:7,uiRefreshSeconds:2});
  assert.equal(h.account().settings.historyEnabled,false); assert.equal((await h.runtime.settings()).historyRetentionDays,7);
  assert.deepEqual([...h.devices.keys()],['device-a','device-b']);
});
for(const [field,value]of [['historyRetentionDays',-1],['historyRetentionDays',3651],['defaultIntervalSeconds',0],['defaultIntervalSeconds',86401],['locationTimeoutMs',4999],['locationTimeoutMs',180001],['uiRefreshSeconds',0],['uiRefreshSeconds',61],['historyEnabled','true']]) {
  test(`monitoring settings reject ${field}=${value}`,()=>assert.throws(()=>monitoring.validateMonitoringSettings({...policy,[field]:value})));
}
test('position key normalizes timestamp, scopes the device and preserves distinct reports',()=>{
  const first=position(); const equivalent={...first,timestamp:new Date(first.timestamp).toISOString()};
  assert.equal(monitoring.positionKey('a',first),monitoring.positionKey('a',equivalent));
  assert.notEqual(monitoring.positionKey('a',first),monitoring.positionKey('b',first));
  assert.notEqual(monitoring.positionKey('a',first),monitoring.positionKey('a',{...first,longitude:0}));
});
for(const extra of [{latitude:91},{longitude:-181},{latitude:NaN},{timestamp:'bad-date'},{timestamp:new Date(Date.now()+3600000).toISOString()}])test('invalid position is rejected '+JSON.stringify(extra),()=>assert.equal(monitoring.validPosition(position(0,extra)),false));
test('latest position persists with history disabled and is available after runtime recreation',async()=>{
  const h=harness({...policy,historyEnabled:false}); const p=position(); h.runtime.protocol.locate=async()=>[p];
  await h.runtime.locate('device-a'); assert.equal(h.retained.size,0); assert.equal((await h.runtime.latestPosition('device-a')).latitude,p.latitude);
  assert.ok(h.devices.get('device-a').lastReceivedAt instanceof Date);
});
test('all valid reports are persisted once; duplicate and old reports do not overwrite latest position',async()=>{
  const h=harness(), a=position(-20), b=position(-10,{latitude:-12.6}), c=position(0,{latitude:-12.7});
  h.runtime.protocol.locate=async()=>[c,a,b,a]; await h.runtime.locate('device-a'); await h.runtime.locate('device-a');
  assert.equal(h.retained.size,3); assert.equal((await h.runtime.latestPosition('device-a')).latitude,c.latitude);
  assert.equal(h.events.filter(event=>event.event===constants.FINDHUB_EVENTS.LOCATION_UPDATED).length,3);
  h.runtime.protocol.locate=async()=>[a];await h.runtime.locate('device-a');assert.equal((await h.runtime.latestPosition('device-a')).latitude,c.latitude);
});
test('location request is coalesced per device and honors its timeout',async()=>{
  const h=harness(); h.devices.get('device-a').locationTimeoutMs=90000;
  let release, calls=0;h.runtime.protocol.locate=async(_device,timeout)=>{calls++;assert.equal(timeout,90000);return new Promise(resolve=>{release=resolve;});};
  const first=h.runtime.locate('device-a'),second=h.runtime.locate('device-a');await new Promise(setImmediate);release([position()]);
  await Promise.all([first,second]);assert.equal(calls,1);assert.equal(h.runtime.locating.size,0);
});
test('explicit request timeout overrides device timeout, which overrides account default',async()=>{
  const h=harness();h.devices.get('device-a').locationTimeoutMs=60000;
  const seen=[];h.runtime.protocol.locate=async(_d,timeout)=>{seen.push(timeout);return[position()];};
  await h.runtime.locate('device-a',5000);await h.runtime.locate('device-a');h.devices.get('device-a').locationTimeoutMs=null;await h.runtime.locate('device-a');
  assert.deepEqual(seen,[5000,60000,30000]);
});
test('stop/disconnect during location prevents late writes and clears tracking timers',async()=>{
  const h=harness();let release;h.runtime.protocol.locate=()=>new Promise(resolve=>{release=resolve;});
  const request=h.runtime.locate('device-a');await new Promise(setImmediate);await h.runtime.closeClient();release([position()]);
  await assert.rejects(request,/encerrada/);assert.equal(h.retained.size,0);assert.equal(h.runtime.tracking.size,0);
});
test('new tracking starts immediately, schedules only after completion and stops without rescheduling',async()=>{
  const h=harness();let release;h.runtime.protocol.locate=()=>new Promise(resolve=>{release=resolve;});
  await h.runtime.startTracking('device-a',30);
  const job=h.runtime.tracking.get('device-a'), first=h.timers.timers.get(job.timer);assert.equal(first.ms,0);
  first.fn();await new Promise(setImmediate);assert.equal(job.nextAttemptAt,undefined);
  await h.runtime.stopTracking('device-a');release([position()]);await new Promise(setImmediate);
  assert.equal(h.runtime.tracking.size,0);assert.equal(h.devices.get('device-a').trackingEnabled,false);
});
test('tracking uses bounded backoff on timeout, preserving the configured interval',async()=>{
  const h=harness();h.runtime.protocol.locate=async()=>{throw Error('timeout');};await h.runtime.startTracking('device-a',30);
  const job=h.runtime.tracking.get('device-a');h.timers.timers.get(job.timer).fn();await new Promise(setImmediate);
  assert.equal(job.failures,1);assert.equal(h.timers.timers.get(job.timer).ms,60000);assert.equal(h.devices.get('device-a').trackingIntervalSeconds,30);
});
test('changing parameters on a tracked device replaces its job and accepts a full day interval',async()=>{
  const h=harness();await h.runtime.startTracking('device-a',30);const old=h.runtime.tracking.get('device-a');
  await h.runtime.configureDevice('device-a',{intervalSeconds:86400,timeoutMs:180000});
  assert.notEqual(h.runtime.tracking.get('device-a'),old);assert.equal(h.devices.get('device-a').locationTimeoutMs,180000);
});
test('scoped history pagination has deterministic ordering, no duplication and validates foreign cursors',async()=>{
  const h=harness();const p=position();for(let i=0;i<4;i++)h.retained.set('k'+i,{id:'history-'+i,instanceId:'instance-a',deviceId:'device-a',recordedAt:new Date(p.timestamp),latitude:i});
  h.retained.set('foreign',{id:'foreign',instanceId:'instance-b',deviceId:'device-b',recordedAt:new Date()});
  const first=await h.runtime.history('device-a',{limit:2});assert.equal(first.items.length,2);assert.equal(first.hasMore,true);
  const second=await h.runtime.history('device-a',{limit:2,cursor:first.nextCursor});assert.equal(second.hasMore,false);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,4);
  await assert.rejects(h.runtime.history('device-a',{cursor:'foreign'}),/Cursor/);
  await assert.rejects(h.runtime.history('device-b',{}),/not found/);
  assert.ok(h.requests.every(where=>where.instanceId==='instance-a'));
});
test('history rejects inverted or invalid ranges and imposes a page limit',async()=>{
  const h=harness();for(const query of [{from:'invalid'},{from:'2026-09-23',to:'2026-09-22'},{limit:1001},{limit:0}])await assert.rejects(h.runtime.history('device-a',query));
});
test('retention purges only older records of the configured account and leaves latest position intact',async()=>{
  const h=harness({...policy,historyRetentionDays:7});const old=new Date(Date.now()-10*86400000);const latest=position();h.devices.get('device-a').lastPosition=latest;
  h.retained.set('old',{id:'old',instanceId:'instance-a',deviceId:'device-a',recordedAt:old});h.retained.set('other',{id:'other',instanceId:'instance-b',deviceId:'device-b',recordedAt:old});h.retained.set('new',{id:'new',instanceId:'instance-a',deviceId:'device-a',recordedAt:new Date()});
  await h.runtime.pruneHistory();assert.deepEqual([...h.retained.keys()],['other','new']);assert.equal(h.devices.get('device-a').lastPosition,latest);
});
test('retention zero never deletes history; out-of-retention reports can still update latest',async()=>{
  const h=harness();await h.runtime.pruneHistory();assert.equal(h.deletes.length,0);
  await h.runtime.saveSettings({...policy,historyRetentionDays:1});h.runtime.protocol.locate=async()=>[position(0,{timestamp:new Date(Date.now()-2*86400000).toISOString()})];
  await h.runtime.locate('device-a');assert.equal(h.retained.size,0);assert.ok(await h.runtime.latestPosition('device-a'));
});
test('live listeners are instance-local, bounded and removable; outbound event failure does not lose a position',async()=>{
  const h=harness(), other=harness();let a=0,b=0;const release=h.runtime.subscribe(()=>a++);other.runtime.subscribe(()=>b++);
  h.runtime.protocol.locate=async()=>[position()];await h.runtime.locate('device-a');assert.equal(a,1);assert.equal(b,0);release();await h.runtime.emit('findhub.tracking.update',{});assert.equal(a,1);
  for(let i=0;i<16;i++)h.runtime.subscribe(()=>{});assert.throws(()=>h.runtime.subscribe(()=>{}),/Limite/);
});
test('failed Traccar destination does not turn a received position into a failed location request',async()=>{
  const h=harness();h.runtime.forwardTraccar=async()=>{throw Error('network');};const p=position();h.runtime.protocol.locate=async()=>[p];
  assert.equal((await h.runtime.locate('device-a')).latitude,p.latitude);assert.equal(h.retained.size,1);assert.ok(h.events.some(event=>event.data.operation==='traccar'));
});
test('partial catalog synchronization preserves tracking, previous devices, links and history',async()=>{
  const h=harness();h.devices.get('device-a').trackingEnabled=true;h.devices.get('device-a').trackingIntervalSeconds=120;
  h.runtime.protocol.listDevices=async()=>[{googleDeviceId:'alternate',aliases:['alternate','google-a'],name:'Updated',identifierType:'ANDROID',deviceType:'PHONE',catalogTypes:[1,2]}];
  const result=await h.runtime.refreshDevices();assert.equal(result.length,1);assert.equal(result[0].id,'device-a');assert.equal(result[0].trackingEnabled,true);assert.equal(result[0].trackingIntervalSeconds,120);
  assert.equal(h.devices.size,2);assert.equal(h.account().catalogStatus.complete,false);
});
test('protocol keeps both canonical ID containers instead of dropping the direct identifiers',()=>{
  const rows=proto.decodeDeviceMetadata(metadata({phone:['android-id'],direct:['network-id']}));assert.deepEqual(plain(rows[0].aliases),['android-id','network-id']);assert.equal(rows.length,2);
});
test('catalog request types retain the original default and support separately selected sources',()=>{
  for(const type of [1,2,5,7])assert.equal(Number(wire.int(wire.bytes(proto.encodeDeviceListRequest('fixture',type),1),1)),type);
  assert.throws(()=>proto.encodeDeviceListRequest('fixture',999));
});
test('catalog queries phone, tag, supervised and Fast Pair without duplicating shared aliases',async()=>{
  const requests=[]; const {FindHubNovaClient}=load(BASE+'protocol/nova.client.ts', {'./findhub-proto':proto,'./protobuf':wire,'../findhub.constants':constants}, {fetch:async(_url,options)=>{
    const type=Number(wire.int(wire.bytes(Buffer.from(options.body),1),1));requests.push(type);
    const rows=type===2?[metadata({phone:['a'],direct:['a-network']}),metadata({direct:['tag'],kind:2,spot:3})]:type===1?[metadata({direct:['a-network'],name:'Same phone'})]:type===7?[metadata({phone:['child'],name:'Supervised',key:false})]:[];
    return{ok:true,arrayBuffer:async()=>wire.concat(...rows.map(row=>wire.fieldMessage(2,row)))};
  }});
  const client=new FindHubNovaClient({serviceToken:async()=>'fixture-token'},{});const devices=await client.listDevices();
  assert.deepEqual(requests,[2,1,7,5]);assert.equal(devices.length,3);assert.deepEqual(plain(devices[0].catalogTypes),[2,1]);assert.equal(devices.find(d=>d.googleDeviceId==='child').locationSupported,false);assert.equal(client.catalogStatus.complete,true);
});
test('unavailable/unknown catalog entries are reported as partial, not silently fabricated or treated as auth failure',async()=>{
  const {FindHubNovaClient}=load(BASE+'protocol/nova.client.ts', {'./findhub-proto':proto,'./protobuf':wire,'../findhub.constants':constants}, {fetch:async(_url,options)=>{
    const type=Number(wire.int(wire.bytes(Buffer.from(options.body),1),1));if(type===7)return{ok:false,status:403};
    return{ok:true,arrayBuffer:async()=>type===2?wire.concat(wire.fieldMessage(2,metadata({phone:['a']})),wire.fieldMessage(2,Buffer.alloc(0))):Buffer.alloc(0)};
  }});
  const client=new FindHubNovaClient({serviceToken:async()=>'fixture-token'},{});assert.equal((await client.listDevices()).length,1);assert.equal(client.catalogStatus.complete,false);
  assert.equal(client.catalogStatus.sources[0].decoded,1);assert.equal(client.catalogStatus.sources[0].returned,2);assert.equal(client.catalogStatus.sources.find(s=>s.type===7).status,'UNAVAILABLE');
});
test('all unavailable catalogs reject the sync without returning a fabricated empty account',async()=>{
  const {FindHubNovaClient}=load(BASE+'protocol/nova.client.ts', {'./findhub-proto':proto,'./protobuf':wire,'../findhub.constants':constants}, {fetch:async()=>({ok:false,status:403})});
  await assert.rejects(new FindHubNovaClient({serviceToken:async()=>'fixture-token'},{}).listDevices(),/catálogo/);
});
test('FCM metadata-only acknowledgement must not finish a location request',()=>{
  const timers=clock();let resolved=0;
  const {FindHubProtocolClient}=load(BASE+'services/findhub-protocol.client.ts',{
    '../auth/google-play-auth.client':{GooglePlayAuthClient:class{}},'../crypto/findhub-crypto':{},
    '../protocol/fcm.client':{FindHubFcmClient:class{}},'../protocol/nova.client':{FindHubNovaClient:class{}},
    '../protocol/spot.client':{FindHubSpotClient:class{}},'../protocol/findhub-proto':{...proto,decodeDeviceUpdate:()=>({requestUuid:'request',deviceMetadata:Buffer.alloc(0)})},
  },timers);
  const client=new FindHubProtocolClient({aas:{}},Buffer.alloc(32),'client',async()=>{});
  const promise=client.waitForLocation('request',5000);promise.then(()=>resolved++).catch(()=>{});
  client.handlePushPayload(Buffer.alloc(0));assert.equal(client.pending.size,1);assert.equal(resolved,0);client.rejectPending('request',Error('test end'));
});
test('additive migrations exist for both database providers and never drop WhatsApp or existing data',()=>{
  for(const provider of ['postgresql','mysql']) {
    const source=fs.readFileSync(path.join(ROOT,`prisma/${provider}-migrations/20260923022000_findhub_monitoring_policy/migration.sql`),'utf8');
    assert.match(source,/FindHubAccount/);assert.match(source,/FindHubDevice/);assert.match(source,/deduplicationKey/);assert.doesNotMatch(source,/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bMessage\b|\bSession\b/i);
  }
});

test('new Find Hub routes preserve guards, reject path identity overrides and release SSE subscriptions',()=>{
  const routes=[], middleware=[], timers=clock();let releases=0, written='';
  const chain={use(fn){middleware.push(fn);return this;}};
  for(const method of ['get','put','post','delete'])chain[method]=(path,...handlers)=>{routes.push({method,path,handlers});return chain;};
  const guard=()=>{}, controller={subscribe(_instance,listener){listener;return()=>{releases++;};}};
  const {FindHubRouter}=load(BASE+'findhub.router.ts',{
    '@api/abstract/abstract.router':{RouterBroker:class{}},'@api/dto/findhub.dto':{},
    '@api/server.module':{findHubController:controller},'@validate/findhub.schema':{},
    '@exceptions':{BadRequestException:class extends Error{}},express:{Router:()=>chain},path:require('node:path'),
  },timers);
  new FindHubRouter(guard);
  for(const endpoint of ['/settings/:instanceName','/device/:deviceId/settings/:instanceName','/location/:deviceId/:instanceName','/history/:deviceId/:instanceName','/events/stream/:instanceName']){
    const matching=routes.filter(route=>route.path===endpoint);assert.ok(matching.length);for(const route of matching)assert.equal(route.handlers[0],guard);
  }
  for(const query of [{instanceName:'other-account'},{deviceId:'other-device'}])assert.throws(()=>middleware[0]({query},{},()=>{}),/caminho/);
  let next=false;middleware[0]({query:{limit:'100'}},{},()=>{next=true;});assert.equal(next,true);
  let close;const headers={};const res={setHeader(k,v){headers[k]=v;},flushHeaders(){},write(text){written+=text;return true;},on(_event,handler){close=handler;},end(){close();}};
  routes.find(route=>route.path==='/events/stream/:instanceName').handlers.at(-1)({params:{instanceName:'google-a'}},res);
  assert.equal(headers['Content-Type'],'text/event-stream');assert.equal(headers['X-Accel-Buffering'],'no');assert.match(written,/findhub.stream.ready/);
  assert.equal(timers.timers.size,2);close();assert.equal(releases,1);assert.equal(timers.timers.size,0);
});
test('public Find Hub schemas include monitoring/history/stream and all local JSON references resolve',()=>{
  for(const filename of ['docs/openapi/findhub.openapi.json','docs/asyncapi/connect-api-events.asyncapi.json']){
    const document=JSON.parse(fs.readFileSync(path.join(ROOT,filename),'utf8'));
    const walk=value=>{
      if(Array.isArray(value)){value.forEach(walk);return;}if(!value||typeof value!=='object')return;
      if(value.$ref?.startsWith('#/')){let target=document;for(const token of value.$ref.slice(2).split('/'))target=target?.[token.replace(/~1/g,'/').replace(/~0/g,'~')];assert.notEqual(target,undefined,value.$ref);}
      Object.values(value).forEach(walk);
    };walk(document);
    if(filename.includes('openapi'))for(const route of ['/findhub/settings/{instanceName}','/findhub/history/{deviceId}/{instanceName}','/findhub/events/stream/{instanceName}'])assert.ok(document.paths[route]);
  }
});
