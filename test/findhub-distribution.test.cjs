'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const os=require('node:os');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('distribution build packages exact ZIP and derives stable ID without dependencies or secrets',t=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'findhub-dist-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
 cp.execFileSync(process.execPath,['scripts/build-findhub-distribution.cjs','--output',out,'--revision','a'.repeat(40)],{cwd:root});
 const meta=JSON.parse(fs.readFileSync(path.join(out,'extension-release.json')));
 assert.equal(meta.version,'0.1.7');assert.equal(meta.extensionId,'dcnejnlafhanlldafkijledmonimkgng');assert.equal(meta.windows.signed,false);assert.equal(meta.windows.browserApprovalRequired,true);
 assert.equal(meta.iconSource,'public/branding/connect-api/core/connect-api-app-icon-dark.png');
 assert.deepEqual(fs.readFileSync(path.join(out,meta.zip.file)),fs.readFileSync(path.join(root,'public/findhub-auth.zip')));
 assert.equal(fs.readFileSync(path.join(out,'connect-findhub.ico')).readUInt16LE(2),1);
 assert.throws(()=>cp.execFileSync(process.execPath,['scripts/build-findhub-distribution.cjs','--output',out,'--revision','invalid'],{cwd:root,stdio:'pipe'}));
});
test('installer is per-user, cannot silently grant browser permissions, and uses staged replacement',()=>{
 const source=read('browser-extensions/findhub-auth/installer/setup.nsi');
 assert.match(source,/RequestExecutionLevel user/);assert.match(source,/CRCCheck force/);assert.match(source,/\.stage/);assert.match(source,/\.previous/);
 assert.doesNotMatch(source,/WriteReg\w+\s+HKLM|ExtensionInstallForcelist|--disable-extensions|--load-extension|Preferences|Secure Preferences/);
 assert.match(source,/Carregar sem compactação/);assert.match(source,/Recarregar/);
});
test('application release explicitly waits for Windows build and attaches binaries despite GITHUB_TOKEN trigger limitations',()=>{
 const release=read('.github/workflows/auto-version-release.yml');
 assert.match(release,/needs: \[plan-version, version-source, publish-manifests, findhub-extension\]/);
 assert.match(release,/extension-dist\/Connect-FindHub-Auth-Setup-\*\.exe/);
 assert.match(release,/source_ref: \$\{\{ needs.version-source.outputs.release_sha \}\}/);
 assert.match(read('.github/workflows/findhub-extension-release.yml'),/--prerelease --latest=false/);
 assert.match(read('.github/workflows/findhub-extension-build.yml'),/smoke-test\.ps1/);
 assert.match(read('.github/workflows/findhub-extension-build.yml'),/c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1/);
});

test('Rust assistant is embedded, offline, per-user and attached to both release channels',()=>{
 const cargo=read('browser-extensions/findhub-auth/windows-assistant/Cargo.toml');
 assert.doesNotMatch(cargo,/\[dependencies/);
 const native=read('browser-extensions/findhub-auth/windows-assistant/src/ui.rs');
 assert.match(native,/Instalar \/ atualizar/);assert.match(native,/Recarregar/);
 assert.doesNotMatch(native,/ExtensionInstallForcelist|Secure Preferences|--load-extension|--disable-extensions/);
 for(const file of ['.github/workflows/auto-version-release.yml','.github/workflows/findhub-extension-release.yml'])assert.match(read(file),/Connect-FindHub-Auth-Assistant-\*\.exe/);
 const workflow=read('.github/workflows/findhub-extension-build.yml');assert.match(workflow,/cargo \+1\.90\.0 test/);assert.match(workflow,/--locked --offline/);
});

test('Windows smoke tests compare embedded version and identity to source manifest, never a stale literal',()=>{
 for(const file of ['browser-extensions/findhub-auth/installer/smoke-test.ps1','browser-extensions/findhub-auth/windows-assistant/smoke-test.ps1']) {
  const smoke=read(file); assert.match(smoke,/\$PSScriptRoot '\.\.\\manifest\.json'/);
  assert.match(smoke,/\$manifest\.version -ne \$sourceManifest\.version/); assert.match(smoke,/\$manifest\.key -ne \$sourceManifest\.key/);
  assert.doesNotMatch(smoke,/\$manifest\.version -ne '[0-9.]+'/);
 }
});
