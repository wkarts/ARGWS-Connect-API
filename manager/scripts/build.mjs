import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const src = path.join(root, 'src');
const pub = path.join(root, 'public');
const template = path.join(root, 'index.html');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets', 'app'), { recursive: true });
fs.cpSync(src, path.join(dist, 'assets', 'app'), { recursive: true });
fs.cpSync(pub, dist, { recursive: true });
fs.copyFileSync(template, path.join(dist, 'index.html'));

for (const required of [
  'index.html',
  'assets/app/main.js',
  'assets/app/styles/app.css',
  'assets/runtime-config.js',
]) {
  if (!fs.existsSync(path.join(dist, required))) throw new Error(`Build incompleto: ${required}`);
}

console.log('Manager build generated at', dist);
