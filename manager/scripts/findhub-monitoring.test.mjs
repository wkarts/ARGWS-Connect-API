import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root,'src/services/findhub-monitoring.ts'),'utf8')
const module = {exports:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,Date,TextDecoder,JSON,console})
const {mergeFindHubDevices,applyFindHubEvent,findHubReportAge,defaultFindHubPolicy,readFindHubEvents}=module.exports
const plain=value=>JSON.parse(JSON.stringify(value))
const stamp='2026-09-23T01:00:00.000Z'
const report={latitude:-12,longitude:-39,timestamp:stamp}
test('a server snapshot preserves device object identity and local action state',()=>{
  const current=[{id:'a',name:'Before',saving:true}]
  const next=mergeFindHubDevices(current,[{id:'a',name:'After'},{id:'b',name:'New'}])
  assert.equal(next[0],current[0]);assert.equal(next[0].saving,true);assert.equal(next[0].name,'After');assert.equal(next.length,2)
})
test('a late snapshot cannot erase a position already delivered by the live stream',()=>{
  const current=[{id:'a',position:report,lastLocationAt:stamp}]
  const next=mergeFindHubDevices(current,[{id:'a',position:null,lastLocationAt:'2026-09-22T23:00:00Z',name:'Updated'}])
  assert.equal(next[0].position,report);assert.equal(next[0].lastLocationAt,stamp);assert.equal(next[0].name,'Updated')
})
test('live position updates are monotonic and apply only to known devices',()=>{
  const devices=[{id:'a'}]
  assert.equal(applyFindHubEvent(devices,{event:'findhub.location.updated',data:{deviceId:'a',location:report},receivedAt:stamp}),true)
  assert.equal(devices[0].position,report)
  assert.equal(applyFindHubEvent(devices,{event:'findhub.location.updated',data:{deviceId:'a',location:{...report,timestamp:'2020-01-01'}}}),false)
  assert.equal(applyFindHubEvent(devices,{event:'findhub.location.updated',data:{deviceId:'other',location:report}}),false)
})
test('tracking recovery clears a prior failure and stop removes the next scheduled attempt',()=>{
  const devices=[{id:'a',trackingStatus:{lastError:'old',nextAttemptAt:stamp}}]
  applyFindHubEvent(devices,{event:'findhub.tracking.update',data:{deviceId:'a',enabled:true,failures:0}})
  assert.equal(devices[0].trackingStatus.lastError,undefined)
  applyFindHubEvent(devices,{event:'findhub.tracking.update',data:{deviceId:'a',enabled:false}})
  assert.equal(devices[0].trackingEnabled,false);assert.equal(devices[0].trackingStatus.nextAttemptAt,undefined)
})
test('report age never presents an old cached location as a fresh GPS fix',()=>{
  assert.equal(findHubReportAge(stamp,Date.parse(stamp)+120000),'Há 2 min')
  assert.equal(findHubReportAge(null),'Sem posição recebida');assert.equal(findHubReportAge('invalid'),'Sem posição recebida')
})
test('default history policy does not erase preexisting records or silently enable collection',()=>{
  assert.equal(defaultFindHubPolicy().historyRetentionDays,0);assert.equal(defaultFindHubPolicy().historyEnabled,false)
})
test('SSE reader handles split UTF8 frames and ignores heartbeats',async()=>{
  const text=': heartbeat\r\n\r\ndata: {"event":"findhub.stream.ready","data":{}}\r\n\r\ndata: {"event":"findhub.location.updated","data":{"name":"Posição"}}\n\n'
  const bytes=new TextEncoder().encode(text), received=[]
  const body=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close()}})
  await readFindHubEvents(body,message=>received.push(message),new AbortController().signal)
  assert.equal(received.length,2);assert.equal(received[1].data.name,'Posição')
})
test('SSE abort cancels the reader and does not leave a page lifecycle subscription alive',async()=>{
  let cancelled=false;const controller=new AbortController()
  const body=new ReadableStream({cancel(){cancelled=true}})
  const reading=readFindHubEvents(body,()=>{},controller.signal);controller.abort();await reading;assert.equal(cancelled,true)
})
test('SSE refuses oversized messages and never puts an API token into the URL',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(1048577)));controller.close()}})
  await assert.rejects(readFindHubEvents(body,()=>{},new AbortController().signal),/limite/)
  const adapter=fs.readFileSync(path.join(root,'src/services/current.ts'),'utf8')
  const stream=adapter.slice(adapter.indexOf('async findHubStream'),adapter.indexOf('async findHubRefreshDevices'))
  assert.match(stream,/headers: \{ apikey:/);assert.doesNotMatch(stream,/\?[^\n]*(token|apikey)/)
})
test('monitoring view uses the global shell, shared settings classes and separate timeout/history controls',()=>{
  const view=fs.readFileSync(path.join(root,'src/views/FindHubView.vue'),'utf8')
  for(const token of ['config-layout','config-nav','historyRetentionDays','locationTimeoutMs','timeoutSeconds','findHubHistory','findHubStream','onBeforeUnmount','visibilitychange'])assert.ok(view.includes(token),token)
  assert.doesNotMatch(view,/rejectCall|readMessages|alwaysOnline/)
  const card=fs.readFileSync(path.join(root,'src/components/FindHubInstanceCard.vue'),'utf8');assert.match(card,/card-link instance-card-action/);assert.doesNotMatch(card,/btn primary/)
  const css=fs.readFileSync(path.join(root,'src/styles/base.css'),'utf8');assert.match(css,/scrollbar-width: thin/);assert.match(css,/forced-colors/)
})
