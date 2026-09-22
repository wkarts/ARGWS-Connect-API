'use strict';
// Deterministic assets, independent of API dependencies. The Windows compiler runs only in CI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const out = path.resolve(option('--output', path.join(root, 'build/findhub-extension')));
const revision = option('--revision', execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim());
const channel = option('--channel', 'candidate');
if (!/^[a-f0-9]{40}$/.test(revision) || !['candidate','develop','stable'].includes(channel)) throw new Error('Invalid build identity');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'browser-extensions/findhub-auth/manifest.json')));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid extension version');
execFileSync(process.execPath, [path.join(root,'scripts/build-findhub-extension.cjs'),'--check'], {stdio:'inherit'});
fs.mkdirSync(out,{recursive:true});
const zipName = `Connect-FindHub-Auth-${version}.zip`;
const exeName = `Connect-FindHub-Auth-Setup-${version}.exe`;
fs.copyFileSync(path.join(root,'public/findhub-auth.zip'),path.join(out,zipName));
// Windows ICO directory contains the unmodified canonical PNG derivatives; no vector tracing or redesign.
const buffers = [16,32,48,128].map(size => fs.readFileSync(path.join(root,`browser-extensions/findhub-auth/icons/icon-${size}.png`)));
const sizes = [16,32,48,128], header = Buffer.alloc(6+16*buffers.length); header.writeUInt16LE(1,2); header.writeUInt16LE(buffers.length,4);
let offset=header.length;
for (let i=0;i<buffers.length;i++) { const p=6+16*i; header[p]=sizes[i];header[p+1]=sizes[i];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(buffers[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=buffers[i].length; }
fs.writeFileSync(path.join(out,'connect-findhub.ico'),Buffer.concat([header,...buffers]));
const extensionId = sha256(Buffer.from(manifest.key,'base64')).slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const metadata = {schema:1,version,channel,sourceRevision:revision,extensionId,windows:{file:exeName,signed:false,scope:'current-user',browserApprovalRequired:true},zip:{file:zipName,sha256:sha256(fs.readFileSync(path.join(out,zipName)))},iconSource:'public/branding/connect-api/core/connect-api-app-icon-dark.png',iconSha256:sha256(fs.readFileSync(path.join(root,'public/branding/connect-api/core/connect-api-app-icon-dark.png')))};
fs.writeFileSync(path.join(out,'extension-release.json'),JSON.stringify(metadata,null,2)+'\n');
fs.writeFileSync(path.join(out,'build.nsh'),`!define EXT_VERSION "${version}"\n!define EXT_VERSION_NUM "${version}.0"\n!define EXT_REVISION "${revision}"\n!define EXT_ID "${extensionId}"\n!define EXT_EXE "${exeName}"\n`);
if (args.includes('--finalize')) {
 const exe = fs.readFileSync(path.join(out,exeName));
 if(exe.length<1024 || exe[0]!==77 || exe[1]!==90) throw new Error('Windows executable is missing/invalid');
 metadata.windows.sha256=sha256(exe);
 fs.writeFileSync(path.join(out,'extension-release.json'),JSON.stringify(metadata,null,2)+'\n');
 const assets=[zipName,exeName,'extension-release.json'];
 fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),assets.map(name=>`${sha256(fs.readFileSync(path.join(out,name)))}  ${name}`).join('\n')+'\n');
}
console.log(JSON.stringify({version,extensionId,output:out,exe:exeName,zip:zipName,sourceRevision:revision}));
