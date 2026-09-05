import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const variant = process.argv[2] || process.platform;
const root = process.cwd();
const target = join(root, 'target', 'release');
const out = join(root, 'dist', 'release');
mkdirSync(out, { recursive: true });

const copied = [];
function copy(source, name) {
  if (!existsSync(source) || !statSync(source).isFile()) return;
  const destination = join(out, name);
  cpSync(source, destination);
  copied.push(destination);
}

if (process.platform === 'win32') {
  copy(join(target, 'argws-connect-deployer.exe'), `ARGWS-Connect-Deployer-${variant}.exe`);
} else {
  copy(join(target, 'argws-connect-deployer'), `argws-connect-deployer-${variant}`);
}

const bundle = join(target, 'bundle');
if (existsSync(bundle)) {
  const queue = [bundle];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile() && ['.exe', '.msi', '.deb', '.rpm', '.AppImage', '.dmg'].includes(extname(entry.name))) {
        copy(absolute, `ARGWS-Connect-Deployer-${variant}-${basename(entry.name)}`);
      }
    }
  }
}

if (!copied.length) throw new Error('Nenhum artefato Tauri encontrado.');
for (const file of copied) {
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(`${file}.sha256`, `${digest}  ${basename(file)}\n`);
}
