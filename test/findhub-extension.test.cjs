'use strict';
const assert=require('node:assert/strict');const {test}=require('node:test');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const crypto=require('node:crypto');const ts=require('typescript');
const folder=path.resolve(__dirname,'../browser-extensions/findhub-auth');
const read=(name)=>fs.readFileSync(path.join(folder,name),'utf8');
function evaluate(name,dependencies={},globals={}) { const module={exports:{}}; const code=ts.transpileModule(read(name),{fileName:name,compilerOptions:{allowJs:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,URL,console,crypto:{randomUUID:crypto.randomUUID},setTimeout,clearTimeout,require(key){if(!(key in dependencies))throw Error('Unexpected dependency '+key);return dependencies[key];},...globals});return module.exports; }
const policy=evaluate('policy.js');
class Hook {listeners=[];addListener=(fn)=>this.listeners.push(fn);removeListener=(fn)=>{this.listeners=this.listeners.filter(v=>v!==fn);};fire(...args){return this.listeners.map(fn=>fn(...args));}}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness(permission=true, fastCookie=false) {
 let nextId=20,cookieReads=0; let cookie={value:'previous-session'}; const tabs=new Map(),removed=[],scripts=[],registrations=[],ports=[];
 const chrome={runtime:{id:'dcnejnlafhanlldafkijledmonimkgng',getURL:name=>'chrome-extension://dcnejnlafhanlldafkijledmonimkgng/'+name,onConnectExternal:new Hook(),onMessage:new Hook()},
  permissions:{contains:async()=>permission},windows:{get:async()=>({focused:true}),onFocusChanged:new Hook()},
  cookies:{onChanged:new Hook(),get:async()=>{cookieReads++;return cookie;}},
  scripting:{executeScript:async data=>scripts.push(data),getRegisteredContentScripts:async()=>registrations,
   registerContentScripts:async entries=>registrations.push(...entries),unregisterContentScripts:async({ids})=>{for(let i=registrations.length-1;i>=0;i--)if(ids.includes(registrations[i].id))registrations.splice(i,1);}},
  tabs:{onUpdated:new Hook(),onActivated:new Hook(),onRemoved:new Hook(),create:async({url})=>{const row={id:nextId++,url,active:true,windowId:1};tabs.set(row.id,row);if(fastCookie && url.includes('EmbeddedSetup')){cookie={name:'oauth_token',domain:'accounts.google.com',value:'fast-new'};chrome.cookies.onChanged.fire({removed:false,cookie});}return row;},get:async id=>tabs.get(id),update:async(id,data)=>Object.assign(tabs.get(id),data),remove:async id=>{removed.push(id);tabs.delete(id);}},
 };
 evaluate('background.js',{'./policy.js':policy},{chrome});
 function connect(url='https://manager.example.com/manager/findhub/unit/conta',frameId=0){const messages=[];const port={name:'connect-findhub-auth-v1',sender:{url,frameId,tab:{id:10}},onMessage:new Hook(),onDisconnect:new Hook(),postMessage:m=>messages.push(m),disconnect(){this.disconnected=true;this.onDisconnect.fire();}};chrome.runtime.onConnectExternal.fire(port);ports.push(port);return {port,messages,send:m=>port.onMessage.fire(m)};}
 function approvalSender(){const tab=[...tabs.values()].find(t=>t.url.endsWith('/approve.html'));return {id:chrome.runtime.id,url:chrome.runtime.getURL('approve.html'),frameId:0,tab:{id:tab?.id}};}
 async function command(message,sender=approvalSender()) {let answer;chrome.runtime.onMessage.fire(message,sender,data=>answer=data);await flush();return answer;}
 return {chrome,tabs,removed,scripts,registrations,connect,command,approvalSender,reads:()=>cookieReads,setCookie:value=>{cookie=value;}};
}
const request={type:'BEGIN',sessionId:'11111111-1111-4111-8111-111111111111',email:'operator@example.com',apiOrigin:'https://api.example.com'};
test('manifest is self-hosted, has no remote code/storage and optional Google-only host access',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 assert.equal(manifest.manifest_version,3);assert.equal(manifest.minimum_chrome_version,'120');
 assert.deepEqual(manifest.optional_host_permissions,['https://accounts.google.com/*']);
 assert.deepEqual(manifest.optional_permissions,['cookies']);assert.equal(manifest.host_permissions,undefined);
 assert.ok(!manifest.permissions.includes('debugger'));assert.ok(!manifest.permissions.includes('storage'));
 const hash=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32);
 const id=[...hash].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');assert.equal(id,'dcnejnlafhanlldafkijledmonimkgng');
});
test('origin and unlock URLs reject unsafe destinations and extra parameters',()=>{
 for(const value of ['http://example.com','file:///tmp/test','javascript:alert(1)','https://user:pass@example.com'])assert.throws(()=>policy.safeOrigin(value));
 assert.equal(policy.safeOrigin('http://localhost:8080/page'),'http://localhost:8080');
 for(const value of ['https://evil.example/unlock','https://accounts.google.com.evil.test/encryption/unlock/android?kdi=a','https://accounts.google.com/encryption/unlock/android?kdi=a&continue=https://evil.test'])assert.throws(()=>policy.unlockUrl(value));
 assert.ok(policy.unlockUrl('https://accounts.google.com/encryption/unlock/android?kdi=a'));
});
test('PING and unauthenticated attempts never read cookies',async()=>{
 const h=harness();const c=h.connect();c.send({type:'PING'});await flush();assert.equal(c.messages[0].type,'PONG');assert.equal(h.reads(),0);
 c.send(request);await flush();assert.equal(h.reads(),0);assert.equal(h.chrome.cookies.onChanged.listeners.length,0);
 assert.equal(h.tabs.size,1);const info=await h.command({type:'INFO'});assert.equal(info.origin,'https://manager.example.com');assert.equal(info.apiOrigin,'https://api.example.com');
 await h.command({type:'DENY'});assert.equal(h.reads(),0);assert.equal(c.port.disconnected,true);
});
test('approval and artifacts are bound to the owned tab; only finder_hw leaves the helper',async()=>{
 const h=harness();const c=h.connect();c.send(request);await flush();
 const unauthorized=await h.command({type:'APPROVE'},{...h.approvalSender(),tab:{id:666}});assert.ok(unauthorized.error);assert.equal(h.reads(),0);
 assert.equal((await h.command({type:'APPROVE'})).ok,true);const google=[...h.tabs.values()].find(t=>t.url.includes('EmbeddedSetup'));assert.ok(google);
 h.chrome.cookies.onChanged.fire({removed:false,cookie:{name:'other',domain:'accounts.google.com',value:'never-send'}});await flush();assert.equal(c.messages.some(m=>m.oauthToken==='never-send'),false);
 h.chrome.cookies.onChanged.fire({removed:false,cookie:{name:'oauth_token',domain:'accounts.google.com',value:'synthetic-new'}});await flush();assert.equal(c.messages.filter(m=>m.type==='OAUTH_TOKEN').length,1);
 c.send({type:'UNLOCK',sessionId:request.sessionId,unlockUrl:'https://accounts.google.com/encryption/unlock/android?kdi=a'});await flush();
 h.chrome.tabs.onUpdated.fire(google.id,{status:'complete'});await flush();assert.deepEqual(h.registrations.map(s=>s.world),['MAIN','ISOLATED']);assert.ok(h.registrations.every(s=>s.runAt==='document_start' && s.persistAcrossSessions===false));
 const sender={id:h.chrome.runtime.id,url:google.url,frameId:0,tab:{id:google.id},documentId:'vault-doc'};
 const {nonce}=await h.command({type:'VAULT_BIND'},sender);const vaultKeys=JSON.stringify({finder_hw:[{key:Array(32).fill(1)}],other_vault:'never-send'});
 const wrong=await h.command({type:'VAULT_KEYS',nonce,vaultKeys},{...sender,tab:{id:666}});assert.ok(wrong.error);
 await h.command({type:'VAULT_KEYS',nonce,vaultKeys},sender);
 const output=c.messages.find(m=>m.type==='VAULT_KEYS');assert.ok(output);assert.equal(output.vaultKeys.includes('other_vault'),false);
 c.send({type:'DONE',sessionId:request.sessionId});await flush();assert.equal(h.chrome.cookies.onChanged.listeners.length,0);assert.ok(!h.removed.includes(10));assert.equal(h.tabs.size,0);
});
test('a frame or another extension cannot silently start linking',async()=>{
 const h=harness();const c=h.connect(undefined,1);c.send(request);await flush();assert.equal(h.tabs.size,0);assert.equal(h.reads(),0);
});
test('denied optional permission does not open Google or read cookies',async()=>{
 const h=harness(false);const c=h.connect();c.send(request);await flush();assert.equal((await h.command({type:'APPROVE'})).accepted,true);assert.equal(c.messages.at(-1).type,'ERROR');assert.equal(h.reads(),0);assert.equal(h.tabs.size,0);
});


test('fast Google cookie arriving before tabs.create resolves is not lost', async () => {
  const h = harness(true, true); const c = h.connect(); c.send(request); await flush();
  await h.command({type:'APPROVE'}); await flush();
  assert.equal(c.messages.filter(message => message.type === 'OAUTH_TOKEN').length, 1);
  assert.equal(c.messages.find(message => message.type === 'OAUTH_TOKEN').oauthToken, 'fast-new');
  c.send({type:'CANCEL',sessionId:request.sessionId}); await flush();
});

test('rechecking the owned tab never replays the baseline or duplicates an emitted artifact', async () => {
  const h = harness(); const c = h.connect(); c.send(request); await flush(); await h.command({type:'APPROVE'});
  const google = [...h.tabs.values()].find(tab => tab.url.includes('EmbeddedSetup'));
  h.chrome.tabs.onUpdated.fire(google.id,{status:'complete'}); await flush();
  assert.equal(c.messages.filter(message=>message.type==='OAUTH_TOKEN').length,0);
  h.setCookie({value:'one-new'}); h.chrome.tabs.onActivated.fire({tabId:google.id}); await flush();
  h.chrome.tabs.onUpdated.fire(google.id,{status:'complete'}); await flush();
  assert.equal(c.messages.filter(message=>message.type==='OAUTH_TOKEN').length,1);
  c.send({type:'CANCEL',sessionId:request.sessionId}); await flush();
});

test('0.1.5 preserves the public extension ID and packages the official raster icons for toolbar and management', () => {
  const manifest = JSON.parse(read('manifest.json')); assert.equal(manifest.version, '0.1.5');
  assert.equal(policy.VERSION, manifest.version);
  for (const size of [16,32,48,128]) {
    const icon = fs.readFileSync(path.join(folder,manifest.icons[size]));
    assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(icon.readUInt32BE(16),size);assert.equal(icon.readUInt32BE(20),size);
    assert.equal(manifest.action.default_icon[size],manifest.icons[size]);
  }
  assert.match(read('approve.html'), /icons\/icon-128\.png/);
});

test('approval acknowledges synchronously before permission checks or tab creation', async () => {
  let permissionResolve;
  const h=harness(new Promise(resolve=>{permissionResolve=resolve;}));
  const c=h.connect();c.send(request);await flush();
  let reply;const returns=h.chrome.runtime.onMessage.fire({type:'APPROVE'},h.approvalSender(),r=>reply=r);
  assert.equal(reply.accepted,true);assert.equal(returns[0],false);
  assert.equal(h.tabs.size,1);assert.equal(h.reads(),0);
  const second=await h.command({type:'APPROVE'});assert.ok(second.error);
  c.send({type:'CANCEL',sessionId:request.sessionId});await flush();permissionResolve(true);await flush();
  assert.equal(h.tabs.size,0);assert.equal(h.reads(),0);
  assert.equal(h.chrome.cookies.onChanged.listeners.length,0);
  assert.equal(c.messages.some(m=>m.type==='OAUTH_TOKEN'),false);
});

test('denial replies before closing the sender tab; no async response promise is left open', async () => {
  const h=harness();const c=h.connect();c.send(request);await flush();
  let acknowledged=false;
  const remove=h.chrome.tabs.remove;
  h.chrome.tabs.remove=async id=>{assert.equal(acknowledged,true);return remove(id);};
  const returns=h.chrome.runtime.onMessage.fire({type:'DENY'},h.approvalSender(),r=>{acknowledged=r.ok;});
  assert.equal(returns[0],false);assert.equal(acknowledged,true);
  await flush();await flush();assert.equal(h.tabs.size,0);assert.equal(c.port.disconnected,true);
});

test('fast backend rejection cannot close the approval tab before its response', async () => {
  const h=harness(true,true);const c=h.connect();c.send(request);await flush();
  let acknowledged=false;const post=c.port.postMessage;
  c.port.postMessage=message=> {
    post(message);
    if (message.type==='OAUTH_TOKEN') {
      assert.equal(acknowledged,true);
      c.send({type:'CANCEL',sessionId:request.sessionId});
    }
  };
  const returns=h.chrome.runtime.onMessage.fire({type:'APPROVE'},h.approvalSender(),r=>{acknowledged=r.accepted;});
  assert.equal(acknowledged,true);assert.equal(returns[0],false);
  await flush();await flush();assert.equal(h.tabs.size,0);assert.equal(c.port.disconnected,true);
});

const kls = 'https://accounts.google.com/v3/signin/challenge/kls?flowName=EncryptionUnlockAndroid&kdi=a';
test('vault policy accepts exact-session Google KLS redirects and rejects other flows/origins',()=>{
 assert.equal(policy.vaultPageUrl(kls,'a'),true);
 assert.equal(policy.vaultPageUrl(kls+'#close','a'),true);
 for(const value of [kls.replace('kdi=a','kdi=b'),kls+'&kdi=a',kls.replace('EncryptionUnlockAndroid','EmbeddedSetupAndroid'),kls.replace('accounts.google.com','accounts.google.com.evil.test'),kls.replace('/challenge/kls','/../other')]) assert.equal(policy.vaultPageUrl(value,'a'),false);
 assert.equal(policy.vaultPageUrl('https://accounts.google.com/v3/signin/challenge/kls','a'),false);
 assert.throws(()=>policy.vaultScriptMatches('https://accounts.google.com/encryption/unlock/android?kdi=*'));
 const matches=policy.vaultScriptMatches('https://accounts.google.com/encryption/unlock/android?kdi=YQ%3D%3D');
 assert.ok(matches.every(m=>m.startsWith('https://accounts.google.com/') && m.includes('kdi=')));
});
async function vaultAttempt(h) {
 const c=h.connect();c.send(request);await flush();await h.command({type:'APPROVE'});
 const google=[...h.tabs.values()].find(t=>t.url.includes('EmbeddedSetup'));
 h.setCookie({value:'new-unlock-fixture'});h.chrome.tabs.onActivated.fire({tabId:google.id});await flush();
 c.send({type:'UNLOCK',sessionId:request.sessionId,unlockUrl:'https://accounts.google.com/encryption/unlock/android?kdi=a'});await flush();
 google.url=kls;return {c,google,sender:{id:h.chrome.runtime.id,url:kls,frameId:0,tab:{id:google.id},documentId:'kls-document'}};
}
test('KLS callback completes once and ignores unrelated tabs, documents, frames and sessions',async()=>{
 const h=harness();const {c,sender}=await vaultAttempt(h);
 const bind=await h.command({type:'VAULT_BIND'},sender);assert.equal(bind.ok,true);
 const data={type:'VAULT_KEYS',nonce:bind.nonce,vaultKeys:JSON.stringify({finder_hw:[{key:Array(32).fill(2)}]})};
 for(const altered of [{...sender,tab:{id:666}},{...sender,frameId:1},{...sender,documentId:'old-doc'},{...sender,url:kls.replace('kdi=a','kdi=b')},{...sender,id:'other-extension'}]) assert.ok((await h.command(data,altered)).error);
 assert.equal(c.messages.some(m=>m.type==='VAULT_KEYS'),false);
 assert.equal((await h.command(data,sender)).ok,true);await h.command(data,sender);
 assert.equal(c.messages.filter(m=>m.type==='VAULT_KEYS').length,1);
 c.send({type:'DONE',sessionId:request.sessionId});await flush();assert.equal(h.registrations.length,0);
});
test('native close without keys fails explicitly; #close never means authenticated',async()=>{
 const h=harness();const {c,sender}=await vaultAttempt(h);
 const bind=await h.command({type:'VAULT_BIND'},sender);
 await h.command({type:'VAULT_CLOSED',nonce:bind.nonce},sender);
 await new Promise(resolve=>setTimeout(resolve,2100));await flush();
 assert.ok(c.messages.some(m=>m.type==='ERROR' && m.message.includes('FH-EXT-VAULT-NOKEY')));
 assert.equal(c.messages.some(m=>m.type==='VAULT_KEYS'),false);assert.equal(h.registrations.length,0);
});
test('keys delivered immediately after close win the grace window without a false failure',async()=>{
 const h=harness();const {c,sender}=await vaultAttempt(h);const bind=await h.command({type:'VAULT_BIND'},sender);
 await h.command({type:'VAULT_CLOSED',nonce:bind.nonce},sender);
 await h.command({type:'VAULT_KEYS',nonce:bind.nonce,vaultKeys:JSON.stringify({finder_hw:[{key:Array(32).fill(3)}]})},sender);
 await new Promise(resolve=>setTimeout(resolve,2100));assert.equal(c.messages.some(m=>m.type==='ERROR'),false);
 c.send({type:'DONE',sessionId:request.sessionId});await flush();
});
test('cancellation during script registration removes late registrations and never navigates',async()=>{
 const h=harness();let finish;const original=h.chrome.scripting.registerContentScripts;
 h.chrome.scripting.registerContentScripts=async rows=>{await new Promise(resolve=>{finish=resolve;});await original(rows);};
 const c=h.connect();c.send(request);await flush();await h.command({type:'APPROVE'});
 const google=[...h.tabs.values()].find(t=>t.url.includes('EmbeddedSetup'));
 h.setCookie({value:'late-register'});h.chrome.tabs.onActivated.fire({tabId:google.id});await flush();
 c.send({type:'UNLOCK',sessionId:request.sessionId,unlockUrl:'https://accounts.google.com/encryption/unlock/android?kdi=a'});await flush();
 c.send({type:'CANCEL',sessionId:request.sessionId});await flush();finish();await flush();
 assert.equal(h.registrations.length,0);assert.equal(h.tabs.size,0);
 assert.equal(c.messages.some(m=>m.type==='WAITING_VAULT_KEY'),false);
});

function vaultWorld(href=kls, authorize=true) {
 const listeners=new Map(), outgoing=[], posted=[];
 const location=new URL(href);const window={location,addEventListener(type,fn,options){const list=listeners.get(type)||[];list.push({fn,once:options?.once});listeners.set(type,list);},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(row=>row.fn!==fn));}};
 window.top=window;
 function fire(type,event={}){for(const row of [...(listeners.get(type)||[])]){row.fn(event);if(row.once)window.removeEventListener(type,row.fn);}}
 window.postMessage=(data,origin)=>{posted.push(data);queueMicrotask(()=>fire('message',{data,origin,source:window}));};
 const nonce='22222222-2222-4222-8222-222222222222';
 const chrome={runtime:{sendMessage:async data=>{outgoing.push(data);if(data.type==='VAULT_BIND')return authorize?{ok:true,nonce,kdi:location.searchParams.get('kdi')}:{error:'not-owned'};return {ok:true};}}};
 function load(name){vm.runInNewContext(read(name),{window,location,URL,chrome});}
 return {window,location,load,fire,outgoing,posted,nonce};
}
test('document_start native callback can precede relay binding without losing finder_hw',async()=>{
 const w=vaultWorld();w.load('vault-page.js');assert.equal(typeof w.window.mm?.setVaultSharedKeys,'function');
 // This simulates the Google callback during initial page scripts, before the async worker handshake.
 w.window.mm.setVaultSharedKeys('synthetic-account',JSON.stringify({finder_hw:[{key:[1,2,3]}],other_vault:[{key:'DO-NOT-EXPORT'}]}));
 w.window.mm.closeView();assert.equal(w.posted.length,0);
 w.load('vault-relay.js');await flush();await flush();
 assert.equal(w.outgoing.filter(m=>m.type==='VAULT_KEYS').length,1);
 assert.equal(w.outgoing.find(m=>m.type==='VAULT_KEYS').vaultKeys.includes('other_vault'),false);
 assert.equal(JSON.stringify(w.posted).includes('DO-NOT-EXPORT'),false);
 assert.ok(w.outgoing.some(m=>m.type==='VAULT_CLOSED'));
 w.fire('pagehide');assert.equal(w.window.mm,undefined);
});
test('denied binding, wrong origin, wrong nonce and unrelated flow cannot export vault keys',async()=>{
 const denied=vaultWorld(kls,false);denied.load('vault-page.js');denied.load('vault-relay.js');await flush();
 denied.window.mm.setVaultSharedKeys('unused',{finder_hw:[{key:[1]}]});await flush();assert.equal(denied.outgoing.some(m=>m.type==='VAULT_KEYS'),false);
 denied.fire('pagehide');
 const w=vaultWorld();w.load('vault-page.js');w.load('vault-relay.js');await flush();
 for(const data of [{source:'CONNECT_FINDHUB_VAULT',nonce:'wrong',kdi:'a',type:'KEYS',vaultKeys:'{}'},{source:'CONNECT_FINDHUB_VAULT',nonce:w.nonce,kdi:'wrong',type:'KEYS',vaultKeys:'{}'}])w.fire('message',{source:w.window,origin:'https://accounts.google.com',data});
 w.fire('message',{source:w.window,origin:'https://evil.example',data:{source:'CONNECT_FINDHUB_VAULT',nonce:w.nonce,kdi:'a',type:'KEYS',vaultKeys:'{}'}});
 assert.equal(w.outgoing.some(m=>m.type==='VAULT_KEYS'),false);w.fire('pagehide');
 const other=vaultWorld(kls.replace('EncryptionUnlockAndroid','EmbeddedSetupAndroid'));other.load('vault-page.js');other.load('vault-relay.js');await flush();assert.equal(other.window.mm,undefined);assert.equal(other.outgoing.length,0);
});
test('bridge preserves a real existing native interface and never accesses DOM inputs/network/storage',()=>{
 const w=vaultWorld();const previous={native:true};w.window.mm=previous;w.load('vault-page.js');assert.equal(w.window.mm,previous);
 for(const name of ['vault-page.js','vault-relay.js'])assert.doesNotMatch(read(name),/querySelector|\.value\b|document\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage|\.cookies\./);
});
test('both bridge worlds are embedded in ZIP, Rust payload and native installer sources',()=>{
 for(const file of ['scripts/build-findhub-extension.cjs','browser-extensions/findhub-auth/windows-assistant/build.rs','browser-extensions/findhub-auth/installer/setup.nsi']) {
  const source=fs.readFileSync(path.join(folder,'../..',file),'utf8');
  assert.ok(source.includes('vault-page.js'));assert.ok(source.includes('vault-relay.js'));
 }
});
