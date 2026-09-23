import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,Date,Response,TextDecoder,AbortSignal,console});return module.exports}
const {applyFindHubUpdate}=load('findhub-live-state.ts');const {project,unproject}=load('findhub-map.ts');const {readFindHubStream,findHubAvailability}=load('findhub-stream.ts');
const snapshot=()=>({instanceId:'a',connected:true,devices:[{id:'one'}],counts:{devices:1,tracking:0},settings:{},traccar:{}});
test('another tenant snapshot/event is not applied',()=>{const s=snapshot();assert.equal(applyFindHubUpdate(s,{event:'snapshot',data:{instanceId:'b'}},'a'),s);applyFindHubUpdate(s,{event:'connection.update',instanceId:'b',data:{state:'close'}},'a');assert.equal(s.connected,true)});
test('late report cannot move map backwards',()=>{const s=snapshot();s.devices[0].latestPosition={latitude:1,longitude:2,timestamp:'2026-09-23T01:00:00Z'};applyFindHubUpdate(s,{event:'findhub.location.updated',instanceId:'a',data:{deviceId:'one',location:{latitude:5,longitude:6,timestamp:'2026-09-22T01:00:00Z'}}},'a');assert.equal(s.devices[0].latestPosition.latitude,1)});
test('tracking event updates only the selected device and counts',()=>{const s=snapshot();s.devices.push({id:'two'});applyFindHubUpdate(s,{instanceId:'a',data:{deviceId:'one',enabled:true,intervalSeconds:120}},'a');assert.equal(s.devices[0].trackingEnabled,true);assert.equal(s.devices[1].trackingEnabled,undefined);assert.equal(s.counts.tracking,1)});
test('projection preserves actual coordinates and zoom',()=>{for(const z of [2,5,14,19])for(const [lat,lon] of [[-12.9,-39.2],[45,0],[-65,178]]){const p=project(lat,lon,z),r=unproject(p.x,p.y,z);assert.ok(Math.abs(r.latitude-lat)<0.000001);assert.ok(Math.abs(r.longitude-lon)<0.000001)}});
test('SSE frames tolerate chunk boundaries and keepalives',async()=>{const encoder=new TextEncoder(),values=[];const stream=new ReadableStream({start(c){for(const chunk of [': heartbeat\r','\n\r\n','event: update\r\ndata: {"instance','Id":"a"}\r','\n\r\n'])c.enqueue(encoder.encode(chunk));c.close()}});await readFindHubStream(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),new AbortController().signal,e=>values.push(e));assert.equal(values.length,1);assert.equal(values[0].instanceId,'a')});
test('non-SSE response rejected without consuming opaque payload',async()=>{await assert.rejects(readFindHubStream(new Response('{}',{headers:{'Content-Type':'application/json'}}),new AbortController().signal,()=>{}))});
test('Google location freshness is not falsely inferred from Traccar proxy socket status',()=>{const d={providerStatus:'offline',latestPosition:{timestamp:new Date().toISOString(),source:'GOOGLE_DIRECT'}};assert.equal(findHubAvailability(d,300),'Posição recente');d.latestPosition.source='TRACCAR';assert.equal(findHubAvailability(d,300),'Offline')});

test('Find Hub map complies with tile identification without changing platform privacy',()=>{
 const source=readFileSync(new URL('../src/components/FindHubMap.vue',import.meta.url),'utf8');
 assert.match(source,/referrerpolicy="strict-origin"/);
 assert.match(source,/@error="tileError=true"/);
 assert.match(source,/!props.position \|\| tileError.value/);
 assert.doesNotMatch(source,/no-cache|cacheBust|Date.now\(\).*tile/);
 assert.match(source,/OpenStreetMap contributors/);
});
test('Find Hub adopts existing configuration layout and keeps WhatsApp controls absent',()=>{
 const source=readFileSync(new URL('../src/views/FindHubView.vue',import.meta.url),'utf8');
 for(const name of ['config-layout','config-nav','config-nav-item','config-workspace','PageHeader','shortcut-card'])assert.ok(source.includes(name));
 assert.doesNotMatch(source,/findhub-tabs|rejectCall|alwaysOnline|readMessages|chatwoot/);
 assert.match(source,/header-actions/);
});
test('zero input is not converted into sixty seconds by UI fallback',()=>{
 for(const file of ['components/FindHubLiveTracking.vue','views/FindHubView.vue']){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  assert.match(source,/min="0"/);assert.doesNotMatch(source,/trackingIntervalSeconds \|\|/);
 }
});

test('overview hero is unique and outside PageHeader actions',()=>{const source=readFileSync(new URL('../src/views/FindHubView.vue',import.meta.url),'utf8');assert.equal((source.match(/class="provider-hero"/g)||[]).length,1);assert.ok(!source.split('<PageHeader')[1].split('</PageHeader>')[0].includes('provider-hero'));});
