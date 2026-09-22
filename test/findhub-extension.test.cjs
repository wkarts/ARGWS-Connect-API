'use strict';
const assert=require('node:assert/strict');const {test}=require('node:test');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const crypto=require('node:crypto');const ts=require('typescript');
const folder=path.resolve(__dirname,'../browser-extensions/findhub-auth');
const read=(name)=>fs.readFileSync(path.join(folder,name),'utf8');
function evaluate(name,dependencies={},globals={}) { const module={exports:{}}; const code=ts.transpileModule(read(name),{fileName:name,compilerOptions:{allowJs:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,URL,console,crypto:{randomUUID:crypto.randomUUID},setTimeout,clearTimeout,require(key){if(!(key in dependencies))throw Error('Unexpected dependency '+key);return dependencies[key];},...globals});return module.exports; }
const policy=evaluate('policy.js');
class Hook {listeners=[];addListener=(fn)=>this.listeners.push(fn);removeListener=(fn)=>{this.listeners=this.listeners.filter(v=>v!==fn);};fire(...args){return this.listeners.map(fn=>fn(...args));}}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness(permission=true) {
 let nextId=20,cookieReads=0; const tabs=new Map(),removed=[],scripts=[],ports=[];
 const chrome={runtime:{id:'dcnejnlafhanlldafkijledmonimkgng',getURL:name=>'chrome-extension://dcnejnlafhanlldafkijledmonimkgng/'+name,onConnectExternal:new Hook(),onMessage:new Hook()},
  permissions:{contains:async()=>permission},windows:{get:async()=>({focused:true})},
  cookies:{onChanged:new Hook(),get:async()=>{cookieReads++;return {value:'previous-session'};}},
  scripting:{executeScript:async data=>scripts.push(data)},
  tabs:{onUpdated:new Hook(),onRemoved:new Hook(),create:async({url})=>{const row={id:nextId++,url,active:true,windowId:1};tabs.set(row.id,row);return row;},get:async id=>tabs.get(id),update:async(id,data)=>Object.assign(tabs.get(id),data),remove:async id=>{removed.push(id);tabs.delete(id);}},
 };
 evaluate('background.js',{'./policy.js':policy},{chrome});
 function connect(url='https://manager.example.com/manager/findhub/unit/conta',frameId=0){const messages=[];const port={name:'connect-findhub-auth-v1',sender:{url,frameId,tab:{id:10}},onMessage:new Hook(),onDisconnect:new Hook(),postMessage:m=>messages.push(m),disconnect(){this.disconnected=true;this.onDisconnect.fire();}};chrome.runtime.onConnectExternal.fire(port);ports.push(port);return {port,messages,send:m=>port.onMessage.fire(m)};}
 function approvalSender(){const tab=[...tabs.values()].find(t=>t.url.endsWith('/approve.html'));return {id:chrome.runtime.id,url:chrome.runtime.getURL('approve.html'),frameId:0,tab:{id:tab?.id}};}
 async function command(message,sender=approvalSender()) {let answer;chrome.runtime.onMessage.fire(message,sender,data=>answer=data);await flush();return answer;}
 return {chrome,tabs,removed,scripts,connect,command,approvalSender,reads:()=>cookieReads};
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
 h.chrome.tabs.onUpdated.fire(google.id,{status:'complete'});await flush();assert.deepEqual(h.scripts.map(s=>s.world),['ISOLATED','MAIN']);assert.ok(h.scripts.every(s=>s.target.tabId===google.id));
 const nonce=h.scripts[0].args[0];const vaultKeys=JSON.stringify({finder_hw:[{key:Array(32).fill(1)}],other_vault:'never-send'});
 const wrong=await h.command({type:'VAULT_KEYS',nonce,vaultKeys},{id:h.chrome.runtime.id,url:google.url,frameId:0,tab:{id:666}});assert.ok(wrong.error);
 await h.command({type:'VAULT_KEYS',nonce,vaultKeys},{id:h.chrome.runtime.id,url:google.url,frameId:0,tab:{id:google.id}});
 const output=c.messages.find(m=>m.type==='VAULT_KEYS');assert.ok(output);assert.equal(output.vaultKeys.includes('other_vault'),false);
 c.send({type:'DONE',sessionId:request.sessionId});await flush();assert.equal(h.chrome.cookies.onChanged.listeners.length,0);assert.ok(!h.removed.includes(10));assert.equal(h.tabs.size,0);
});
test('a frame or another extension cannot silently start linking',async()=>{
 const h=harness();const c=h.connect(undefined,1);c.send(request);await flush();assert.equal(h.tabs.size,0);assert.equal(h.reads(),0);
});
test('denied optional permission does not open Google or read cookies',async()=>{
 const h=harness(false);const c=h.connect();c.send(request);await flush();assert.ok((await h.command({type:'APPROVE'})).error);assert.equal(h.reads(),0);assert.equal(h.tabs.size,0);
});
