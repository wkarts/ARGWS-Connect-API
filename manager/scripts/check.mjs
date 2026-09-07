import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const files = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') && files.push(path.join(dir, entry.name)));
walk(src);
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
const forbidden = ['github.com/wkarts', 'Postman', 'Discord', 'Suporte Premium', 'Tenant', 'Partner', 'Control Plane', 'Connect|API Platform', 'Connect|API self-hosted'];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of forbidden) if (text.includes(token)) throw new Error(`Termo público proibido em ${path.relative(root, file)}: ${token}`);
}
const main = fs.readFileSync(path.join(src, 'main.js'), 'utf8');
for (const route of ['/manager/instances', '/manager/channels', '/manager/conversations', '/manager/voice', '/manager/studio', '/manager/integrations', '/manager/users', '/manager/security', '/manager/audit', '/manager/system', '/manager/license', '/manager/updates']) {
  if (!main.includes(route)) throw new Error(`Rota obrigatória ausente: ${route}`);
}
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
  if (!fs.existsSync(path.join(src, relative))) throw new Error(`Módulo legado funcional ausente: ${relative}`);
  if (main.includes(`./${relative}`)) throw new Error(`Módulo legado não deve ser importado pelo main ativo: ${relative}`);
}

const login = fs.readFileSync(path.join(src, 'pages', 'login.js'), 'utf8');
if (login.includes('API Key') || login.includes('Server URL')) throw new Error('Login humano não pode solicitar URL do Engine nem API Key.');
console.log(`OK: ${files.length} módulos JS da Manager validados.`);
