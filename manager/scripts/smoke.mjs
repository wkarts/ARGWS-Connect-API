import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
for (const asset of ['/assets/app/main.js', '/assets/app/styles/app.css']) if (!index.includes(asset)) throw new Error(`index.html sem ${asset}`);
const api = fs.readFileSync(path.join(root, 'dist', 'assets', 'app', 'api', 'manager.js'), 'utf8');
for (const endpoint of ['/manager-api/v1/auth/login', '/manager-api/v1/dashboard', '/manager-api/v1/instances', '/manager-api/v1/users', '/manager-api/v1/license', '/manager-api/v1/updates']) if (!api.includes(endpoint)) throw new Error(`Contrato BFF ausente: ${endpoint}`);
console.log('Manager Web SMOKE OK');
