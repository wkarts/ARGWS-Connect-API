import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(root, 'docker-entrypoint.d', '40-manager-runtime-config.sh');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-manager-runtime-'));
fs.mkdirSync(path.join(temp, 'assets'), { recursive: true });

const run = (extraEnv) => {
  const result = spawnSync('sh', [entrypoint], {
    env: { ...process.env, MANAGER_RUNTIME_ROOT: temp, ...extraEnv },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`runtime config generator failed: ${result.stderr || result.stdout}`);
  }
  return fs.readFileSync(path.join(temp, 'assets', 'runtime-config.js'), 'utf8');
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  const pt = run({
    ARGWS_CONNECT_DOCS_PUBLIC_URL: 'https://docs.example.test',
    MANAGER_DEFAULT_LOCALE: 'en-US',
    MANAGER_ENABLE_EXTRA_LOCALES: 'false',
    MANAGER_EXTRA_LOCALES: 'en-US,es-ES,fr-FR',
  });
  assert(pt.includes("documentationUrl: 'https://docs.example.test'"), 'docs URL was not propagated');
  assert(pt.includes("defaultLocale: 'pt-BR'"), 'pt-BR must be forced when extra locales are disabled');
  assert(pt.includes("enabledLocales: ['pt-BR']"), 'only pt-BR may be enabled by default');

  const extra = run({
    ARGWS_CONNECT_DOCS_PUBLIC_URL: '',
    MANAGER_DEFAULT_LOCALE: 'en-US',
    MANAGER_ENABLE_EXTRA_LOCALES: 'true',
    MANAGER_EXTRA_LOCALES: 'en-US,es-ES,invalid-locale',
  });
  assert(extra.includes("defaultLocale: 'en-US'"), 'enabled default locale was not honored');
  assert(extra.includes("'en-US'"), 'en-US was not enabled');
  assert(extra.includes("'es-ES'"), 'es-ES was not enabled');
  assert(!extra.includes('invalid-locale'), 'invalid locale must be ignored');

  console.log('RUNTIME SMOKE OK: docs URL and pt-BR-first locale policy validated.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
