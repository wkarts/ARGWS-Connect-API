import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
function evaluate(text, deps = {}, globals = {}) {
  const code=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,Error,URL,Date,console,require:name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},...globals});
  return module.exports;
}
const state = evaluate(read('src/services/findhub-auth-state.ts'));
class Hook { listeners=[]; addListener(fn){this.listeners.push(fn);} fire(value){for(const fn of this.listeners) fn(value);} }
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function harness({ version='0.1.1', exchangeFailure, exchangeWait }={}) {
  const calls=[], sent=[]; let beforeUnmount;
  const port={onMessage:new Hook(),onDisconnect:new Hook(),disconnect(){this.disconnected=true;this.onDisconnect.fire();},
    postMessage(message){sent.push(message);if(message.type==='PING')queueMicrotask(()=>this.onMessage.fire({type:'PONG',version}));}};
  const api={findHubBrowserAuth:async(id,operation,body)=>{
    calls.push({id,operation,body});
    if(operation==='start')return {sessionId:'synthetic-session',bridgeToken:'synthetic-proof',expiresAt:new Date(Date.now()+600000).toISOString()};
    if(operation==='exchange'){if(exchangeWait)await exchangeWait;if(exchangeFailure)throw new Error(exchangeFailure);return {unlockUrl:'https://accounts.google.com/encryption/unlock/android?kdi=synthetic'};}
    if(operation==='complete')return {connected:true};
    return {state:'CANCELLED'};
  }};
  const descriptor=parse(read('src/components/FindHubBrowserAuth.vue'),{filename:'FindHubBrowserAuth.vue'}).descriptor;
  const script=compileScript(descriptor,{id:'findhub-auth-test'});
  const component=evaluate(script.content,{
    vue:{...Vue,onBeforeUnmount:fn=>{beforeUnmount=fn;}},
    '@/components/PanelCard.vue':{},'@/services/connect':{connect:api},
    '@/config/runtime':{runtime:{apiBaseUrl:'https://api.example.invalid'}},
    '@/services/findhub-extension-id':{FINDHUB_EXTENSION_ID:'synthetic-extension'},
    '@/services/findhub-auth-state':state,'@/services/errors':{friendlyError:e=>e.message},
  }, {chrome:{runtime:{connect:()=>port}}, setTimeout:()=>1, clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}}).default;
  const emitted=[];
  const ui=component.setup({instanceId:'findhub-only',initialEmail:'operator@example.com'},{expose(){},emit:name=>emitted.push(name)});
  return {ui,port,calls,sent,emitted,beforeUnmount:()=>beforeUnmount()};
}
test('helper version validation rejects old/missing/malformed versions before any Google session',async()=>{
  for(const value of ['0.1.0',undefined,'invalid']){
    assert.equal(state.compatibleFindHubHelper(value),false);
    const h=harness({version:value===undefined?'invalid':value});await h.ui.start();
    assert.equal(h.calls.length,0);assert.equal(h.ui.busy.value,false);assert.equal(h.ui.stage.value,'');assert.match(h.ui.error.value,/Atualize a extensão/);
  }
  assert.equal(state.compatibleFindHubHelper('0.1.1'),true);assert.equal(state.compatibleFindHubHelper('0.2.0'),true);
});
test('handled backend failure clears Validando and does not send a second failing cancellation',async()=>{
  const h=harness({exchangeFailure:'[FH-AUTH-9102] O Google recusou o artefato.'});await h.ui.start();
  h.port.onMessage.fire({type:'OAUTH_TOKEN',sessionId:'synthetic-session',oauthToken:'synthetic-only'});await flush();
  assert.equal(h.ui.busy.value,false);assert.equal(h.ui.stage.value,'');assert.match(h.ui.error.value,/FH-AUTH-9102/);
  assert.equal(h.calls.filter(x=>x.operation==='cancel').length,0);assert.equal(h.port.disconnected,true);assert.equal(h.emitted.length,0);
});
test('unconfirmed network failure still cancels the attempt and clears progress',async()=>{
  const h=harness({exchangeFailure:'Network unavailable'});await h.ui.start();h.port.onMessage.fire({type:'OAUTH_TOKEN',oauthToken:'synthetic-only'});await flush();
  assert.equal(h.calls.filter(x=>x.operation==='cancel').length,1);assert.equal(h.ui.busy.value,false);assert.equal(h.ui.stage.value,'');
});
test('duplicate artifact notifications cannot redeem the same one-use token twice',async()=>{
  let release;const exchangeWait=new Promise(resolve=>{release=resolve;});const h=harness({exchangeWait});await h.ui.start();
  h.port.onMessage.fire({type:'OAUTH_TOKEN',oauthToken:'synthetic-only'});h.port.onMessage.fire({type:'OAUTH_TOKEN',oauthToken:'synthetic-only'});await flush();
  assert.equal(h.calls.filter(x=>x.operation==='exchange').length,1);release();await flush();await h.ui.cancel();
});
test('successful completion must be confirmed by the server before showing connected',async()=>{
  const h=harness();await h.ui.start();h.port.onMessage.fire({type:'OAUTH_TOKEN',oauthToken:'synthetic-only'});await flush();
  assert.equal(h.emitted.length,0);h.port.onMessage.fire({type:'VAULT_KEYS',vaultKeys:'synthetic-keys'});await flush();
  assert.deepEqual(h.emitted,['connected']);assert.equal(h.ui.busy.value,false);assert.equal(h.port.disconnected,true);
  assert.equal(h.calls.filter(x=>x.operation==='complete').length,1);assert.equal(h.calls.filter(x=>x.operation==='cancel').length,0);
});
test('wrong session notifications are ignored and explicit cancellation leaves no stale status',async()=>{
  const h=harness();await h.ui.start();h.port.onMessage.fire({type:'OAUTH_TOKEN',sessionId:'foreign',oauthToken:'synthetic-only'});await flush();
  assert.equal(h.calls.filter(x=>x.operation==='exchange').length,0);await h.ui.cancel();
  assert.equal(h.ui.busy.value,false);assert.equal(h.ui.stage.value,'');assert.equal(h.port.disconnected,true);
});
