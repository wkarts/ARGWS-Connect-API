'use strict';
// Opt-in CI integration against disposable official Traccar + PostgreSQL containers. No real account.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const WebSocket=require('ws');
if(process.env.TRACCAR_INTEGRATION_TEST!=='true') throw Error('Disposable Traccar integration test must be explicitly enabled.');
const file='src/api/integrations/channel/findhub/services/traccar-client.ts';const moduleObject={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:moduleObject,exports:moduleObject.exports,require:n=>n==='ws'?WebSocket:require(n),Buffer,URL,URLSearchParams,AbortSignal,fetch,Response,Date,process,console,setTimeout,clearTimeout});
const {TraccarClient}=moduleObject.exports;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const client=new TraccarClient({mode:'internal'});let connected=false;const received=[];
 try {
  await client.session();
  const first=await client.provision('ci-account-a','ci-device','Synthetic A');
  const again=await client.provision('ci-account-a','ci-device','Synthetic A');
  const second=await client.provision('ci-account-b','ci-device','Synthetic B');
  assert.equal(first.id,again.id);assert.notEqual(first.id,second.id);assert.notEqual(first.uniqueId,second.uniqueId);
  client.start(async data=>{received.push(...(data.positions||[]))},state=>{if(state==='connected')connected=true});
  for(let i=0;i<100&&!connected;i++)await pause(100);
  assert.equal(connected,true,'official session WebSocket must open');
  const time=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
  await client.send(first.uniqueId,{latitude:-12.9,longitude:-39.2,timestamp:time,accuracy:20});
  await client.send(second.uniqueId,{latitude:10.5,longitude:20.25,timestamp:time,accuracy:30});
  for(let i=0;i<150&&new Set(received.map(p=>p.deviceId)).size<2;i++)await pause(100);
  const a=received.find(p=>p.deviceId===first.id);const b=received.find(p=>p.deviceId===second.id);
  assert(a && b,'real OsmAnd positions must return on the official socket');assert.equal(a.latitude,-12.9);assert.equal(b.longitude,20.25);assert.equal(Date.parse(a.fixTime),Date.parse(time));
  const latest=await client.latestPositions(first.id);assert(latest.length);assert(latest.every(p=>p.deviceId===first.id));
  console.log('TRACCAR_LIVE_OK: session, idempotent provisioning, account-derived IDs, OsmAnd ingestion, official socket and latest REST position. Synthetic data only.');
 }finally{client.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
