import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
for (const asset of [
  '/manager/assets/app/main.js',
  '/manager/assets/app/styles/app.css',
  '/manager/assets/app/styles/security.css',
  '/manager/assets/vendor/qrcode.min.js',
  '/manager/assets/qrcode-adapter.js',
]) if (!index.includes(asset)) throw new Error(`index.html sem ${asset}`);
for (const file of [
  'assets/app/styles/security.css',
  'assets/vendor/qrcode.min.js',
  'assets/qrcode-adapter.js',
]) if (!fs.existsSync(path.join(root, 'dist', file))) throw new Error(`Build sem ${file}`);
const api = fs.readFileSync(path.join(root, 'dist', 'assets', 'app', 'api', 'manager.js'), 'utf8');
for (const endpoint of [
  '/manager-api/v1/auth/login',
  '/manager-api/v1/auth/2fa/setup',
  '/manager-api/v1/auth/2fa/confirm',
  '/manager-api/v1/dashboard',
  '/manager-api/v1/instances',
  '/manager-api/v1/users',
  '/manager-api/v1/license',
  '/manager-api/v1/updates',
]) if (!api.includes(endpoint)) throw new Error(`Contrato BFF ausente: ${endpoint}`);
const security = fs.readFileSync(path.join(root, 'dist', 'assets', 'app', 'pages', 'security.js'), 'utf8');
if (!security.includes('QRCode.toDataURL')) throw new Error('Fluxo 2FA sem geração local de QR Code');
const qrAdapter = fs.readFileSync(path.join(root, 'dist', 'assets', 'qrcode-adapter.js'), 'utf8');
if (!qrAdapter.includes('createDataURL')) throw new Error('Adapter local de QR Code inválido');
console.log('Manager Web SMOKE OK');
