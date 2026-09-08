import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const src = path.join(root, 'src');
const pub = path.join(root, 'public');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets', 'app'), { recursive: true });
fs.mkdirSync(path.join(dist, 'assets', 'vendor'), { recursive: true });
fs.cpSync(pub, dist, { recursive: true });
fs.cpSync(src, path.join(dist, 'assets', 'app'), { recursive: true });

const qrBundle = path.join(root, 'node_modules', 'qrcode', 'build', 'qrcode.min.js');
if (!fs.existsSync(qrBundle)) throw new Error('Dependência local qrcode não encontrada. Execute npm install antes do build.');
fs.copyFileSync(qrBundle, path.join(dist, 'assets', 'vendor', 'qrcode.min.js'));

// Functional legacy modules are intentionally preserved in src/ until the new
// Manager reaches verified feature parity. They are not part of the active
// application graph and must not be shipped in the production web bundle.
const preservedLegacyModules = [
  'api/calls.js',
  'api/chat.js',
  'api/client.js',
  'api/configuration.js',
  'api/instances.js',
  'api/integrations.js',
  'core/chat-preferences.js',
  'core/runtime-config.js',
  'pages/calls.js',
  'pages/chat.js',
  'pages/config.js',
  'pages/integration.js',
  'pages/status.js',
  'pages/voip.js',
];
for (const relative of preservedLegacyModules) {
  fs.rmSync(path.join(dist, 'assets', 'app', relative), { force: true });
}
fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));

for (const required of [
  'index.html',
  'assets/app/main.js',
  'assets/app/styles/app.css',
  'assets/app/api/manager.js',
  'assets/runtime-config.js',
  'assets/vendor/qrcode.min.js',
]) {
  if (!fs.existsSync(path.join(dist, required))) throw new Error(`Build incompleto: ${required}`);
}
console.log('Manager deterministic ES-module build generated at dist/');
