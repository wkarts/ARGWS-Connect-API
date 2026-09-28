/* Build the optional self-hosted helper without npm downloads or private signing keys. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'browser-extensions/findhub-auth');
const names = ['manifest.json', 'policy.js', 'background.js', 'vault-page.js', 'vault-relay.js', 'approve.html', 'approve.js', 'approve.css', 'README.md', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'];
const crc32 = (buffer) => { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; };
const parts = [], central = []; let offset = 0;
for (const name of names) {
  const filename = Buffer.from(name); const body = fs.readFileSync(path.join(folder,name));
  const compressed = zlib.deflateRawSync(body, { level: 9 });
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt16LE(8,8);
  local.writeUInt16LE(33,12); local.writeUInt32LE(crc32(body),14); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(body.length,22); local.writeUInt16LE(filename.length,26);
  const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20,4); local.copy(index,6,4,30); index.writeUInt32LE(offset,42);
  parts.push(local,filename,compressed); central.push(index,filename); offset += local.length + filename.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length,8); end.writeUInt16LE(names.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
const archive = Buffer.concat([...parts,directory,end]); const destination=path.join(root,'public/findhub-auth.zip');
if (process.argv.includes('--check')) { if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(archive)) throw new Error('Pacote da extensão desatualizado. Execute node scripts/build-findhub-extension.cjs.'); }
else { fs.writeFileSync(destination,archive); }
console.log('Find Hub helper ZIP SHA256 '+crypto.createHash('sha256').update(archive).digest('hex'));
