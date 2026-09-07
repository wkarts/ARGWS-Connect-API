import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const authGuard = fs.readFileSync(path.join(root, 'src/api/guards/auth.guard.ts'), 'utf8');
const envConfig = fs.readFileSync(path.join(root, 'src/config/env.config.ts'), 'utf8');
const engineClient = fs.readFileSync(path.join(root, 'manager/api/src/engine.mjs'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yaml'), 'utf8');

const checks = [
  [envConfig.includes('AUTHENTICATION_API_KEY'), 'AUTHENTICATION_API_KEY continua configurável no Engine'],
  [authGuard.includes('if (env.KEY === key)'), 'Global API Key continua autorizando todas as rotas protegidas pelo guard'],
  [authGuard.includes('if (instance.token === key)'), 'Token individual da instância continua autorizado'],
  [engineClient.includes("apikey: token || this.apiKey"), 'Manager API continua usando token individual ou Global API Key ao falar com o Engine'],
  [compose.includes('MANAGER_ENGINE_API_KEY: ${AUTHENTICATION_API_KEY'), 'Manager API recebe a Global API Key sem expô-la ao navegador'],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(`Compatibilidade de token quebrada: ${message}`);
}
console.log('TOKEN COMPAT OK: Global API Key + tokens de instância preservados');
