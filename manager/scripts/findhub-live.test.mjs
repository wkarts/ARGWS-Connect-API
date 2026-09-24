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

test('zero interval from realtime is not discarded',()=>{const s=snapshot();s.devices[0].trackingIntervalSeconds=60;applyFindHubUpdate(s,{instanceId:'a',data:{deviceId:'one',intervalSeconds:0}},'a');assert.equal(s.devices[0].trackingIntervalSeconds,0)});
test('mouse wheel zoom preserves the point beneath the cursor',()=>{
 const {zoomAt}=load('findhub-map.ts');const center={latitude:-13,longitude:-39},z=12,x=127,y=214,w=800,h=430;
 const c=project(center.latitude,center.longitude,z),anchor=unproject(c.x+x-w/2,c.y+y-h/2,z);
 const after=zoomAt(center,z,z+1,x,y,w,h),ca=project(after.center.latitude,after.center.longitude,after.zoom),p=project(anchor.latitude,anchor.longitude,after.zoom);
 assert.ok(Math.abs(p.x-ca.x-(x-w/2))<1e-7);assert.ok(Math.abs(p.y-ca.y-(y-h/2))<1e-7);
 assert.equal(zoomAt(center,19,20,x,y,w,h).zoom,19);
});
test('popup stays account scoped and closing releases stream without stopping tracking',()=>{
 const source=readFileSync(new URL('../src/components/FindHubTrackingModal.vue',import.meta.url),'utf8');
 assert.match(source,/applyFindHubUpdate\(snapshot.value, event, id\)/);assert.match(source,/abort\?\.abort/);
 assert.match(source,/onBeforeUnmount/);assert.doesNotMatch(source,/findHubStopTracking|window.open|localStorage/);
 const map=readFileSync(new URL('../src/components/FindHubMap.vue',import.meta.url),'utf8');
 assert.match(map,/addEventListener\('wheel', wheel, \{ passive: false \}/);assert.match(map,/removeEventListener\('wheel'/);assert.match(map,/map-device-avatar/);
});

test('delayed snapshot cannot replace a newer SSE position or another account',()=>{
 const s=snapshot();s.devices[0].latestPosition={latitude:1,longitude:2,timestamp:'2026-09-23T10:00:00Z'};
 s.devices[0].lastQuery={status:'new_report',completedAt:'2026-09-23T10:01:00Z'};
 const next=snapshot();next.devices[0].latestPosition={latitude:3,longitude:4,timestamp:'2026-09-23T09:00:00Z'};
 const result=applyFindHubUpdate(s,{event:'snapshot',data:next},'a');assert.equal(result.devices[0].latestPosition.latitude,1);assert.equal(result.devices[0].lastQuery.status,'new_report');
 const wrong=applyFindHubUpdate(s,{event:'snapshot',data:{...next,instanceId:'b'}},'a');assert.equal(wrong,s);
});
test('known report event preserves original position time and records the real query outcome',()=>{
 const s=snapshot();const position={latitude:0,longitude:0,timestamp:'2026-09-23T09:00:00Z'};
 applyFindHubUpdate(s,{instanceId:'a',at:'2026-09-23T10:00:00Z',data:{deviceId:'one',location:position,query:{status:'known_position',completedAt:'2026-09-23T10:00:00Z'}}},'a');
 assert.equal(s.devices[0].lastLocationAt,position.timestamp);assert.equal(s.devices[0].lastQuery.status,'known_position');
 assert.equal(s.devices[0].latestPosition.latitude,0);
});
test('coordinates and timeout messages are factual, including latitude/longitude zero',()=>{
 const {coordinate,locateResultMessage,locateErrorMessage,queryMessage}=load('findhub-position.ts');
 assert.equal(coordinate(0),'0.0000000');assert.equal(coordinate(undefined),'—');
 const p={latitude:1,longitude:2,timestamp:'2026-09-23T09:00:00Z'};
 assert.match(locateResultMessage(p,p),/não uma nova posição/);assert.match(locateResultMessage(null,p),/preservado/);
 assert.match(locateErrorMessage('Google Find Hub location request timed out',1),/1 ms/);
 assert.match(queryMessage({status:'known_position'}),/Sem novo relatório/);
});
test('integration device button navigates to map and only overview/card tracking keeps modal',()=>{
 const view=readFileSync(new URL('../src/views/FindHubView.vue',import.meta.url),'utf8');
 assert.match(view,/@click="openDeviceMap\(device.id\)"/);assert.match(view,/query: \{ device: deviceId \}/);
 assert.doesNotMatch(view,/@click="showTracking\(device.id\)"/);assert.match(view,/class="device-actions"><button class="btn ghost"/);
 const card=readFileSync(new URL('../src/components/FindHubInstanceCard.vue',import.meta.url),'utf8');
 assert.match(card,/FindHubTrackingModal/);assert.match(card,/connect.findHubStream/);assert.match(card,/onBeforeUnmount\(stopStream\)/);
});
test('map/modal, instance card and overview render labeled real coordinates',()=>{
 for(const file of ['components/FindHubLiveTracking.vue','components/FindHubInstanceCard.vue','views/FindHubView.vue']){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');assert.match(source,/<FindHubPositionDetails/);
 }
 const details=readFileSync(new URL('../src/components/FindHubPositionDetails.vue',import.meta.url),'utf8');
 assert.match(details,/<dt>Latitude<\/dt>/);assert.match(details,/<dt>Longitude<\/dt>/);assert.match(details,/position\?\.timestamp/);
 assert.doesNotMatch(details,/Math.random|setInterval/);
});


test('late push updates coordinates but never relabels the expired request as successful',()=>{
 const s=snapshot();s.devices[0].lastQuery={status:'timeout',completedAt:'2026-09-24T12:00:00Z',timeoutMs:1};
 s.devices[0].lastErrorCode='LOCATION_TIMEOUT';s.devices[0].latestPosition={latitude:1,longitude:2,timestamp:'2026-09-24T11:59:00Z'};
 applyFindHubUpdate(s,{event:'findhub.location.updated',instanceId:'a',at:'2026-09-24T12:00:05Z',data:{deviceId:'one',location:{latitude:3,longitude:4,timestamp:'2026-09-24T12:00:03Z'}}},'a');
 assert.equal(s.devices[0].latestPosition.latitude,3);assert.equal(s.devices[0].lastErrorCode,null);assert.equal(s.devices[0].lastQuery.status,'timeout');
 const {queryMessage}=load('findhub-position.ts');assert.match(queryMessage(s.devices[0].lastQuery,s.devices[0].lastReceivedAt),/recebimento continuou ativo/);
 assert.match(queryMessage(s.devices[0].lastQuery,'2026-09-24T11:59:00Z'),/timeout de 1 ms/);
});
test('channel icon changes only the Find Hub branch and reuses the location glyph',()=>{
 const s=readFileSync(new URL('../src/views/ChannelsView.vue',import.meta.url),'utf8');
 assert.match(s,/item.name === 'WhatsApp' \? 'whatsapp' : item.name === 'Google Find Hub' \? 'location' : 'channels'/);
});
