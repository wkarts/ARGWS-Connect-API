'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadService(env) {
  const source = fs.readFileSync(path.join(root, 'src/api/services/traccar-manager.service.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const moduleResult = { exports: {} };
  class Logger { warn() {} }
  vm.runInNewContext(compiled, {
    module: moduleResult,
    exports: moduleResult.exports,
    require(id) {
      if (id === '@config/logger.config') return { Logger };
      return require(id);
    },
    process: { env },
    URL,
    URLSearchParams,
    AbortController,
    fetch,
    setTimeout,
    clearTimeout,
    console,
  });
  return moduleResult.exports;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('Manager reads the internal Traccar API without exposing its session', async (t) => {
  let loginCount = 0;
  const cookies = [];
  const upstream = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/session') {
      loginCount += 1;
      let payload = '';
      request.on('data', (chunk) => { payload += chunk; });
      request.on('end', () => {
        assert.match(payload, /email=admin%40example\.invalid/);
        assert.match(payload, /password=server-only-password/);
        response.writeHead(204, { 'set-cookie': 'JSESSIONID=internal-session; Path=/; HttpOnly' });
        response.end();
      });
      return;
    }
    cookies.push(String(request.headers.cookie || ''));
    const payloads = {
      '/api/server': { version: '6.15.3' },
      '/api/devices': [{ id: 7, name: 'Frota 01', status: 'online', positionId: 70 }],
      '/api/positions': [{ id: 70, deviceId: 7, latitude: -12.97, longitude: -38.51, speed: 0, fixTime: '2026-09-29T00:00:00.000Z' }],
    };
    if (!payloads[request.url]) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payloads[request.url]));
  });
  let port;
  try {
    port = await listen(upstream);
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('O sandbox local não permite abrir sockets de teste; a CI executa este fluxo.');
      return;
    }
    throw error;
  }
  try {
    const env = {
      TRACCAR_ENABLED: 'true',
      TRACCAR_MODE: 'internal',
      TRACCAR_INTERNAL_URL: `http://127.0.0.1:${port}`,
      TRACCAR_ADMIN_EMAIL: 'admin@example.invalid',
      TRACCAR_ADMIN_PASSWORD: 'server-only-password',
      FINDHUB_MAP_TILE_URL: 'https://tiles.example.invalid/{z}/{x}/{y}.png',
    };
    const { TraccarManagerService, traccarManagerPortalEnabled } = loadService(env);
    assert.equal(traccarManagerPortalEnabled(env), true);
    assert.equal(traccarManagerPortalEnabled({ ...env, TRACCAR_ADMIN_PASSWORD: '' }), false);

    const service = new TraccarManagerService();
    const overview = await service.overview();
    assert.equal(loginCount, 1);
    assert.deepEqual(overview.devices, [{ id: 7, name: 'Frota 01', status: 'online', positionId: 70 }]);
    assert.deepEqual(overview.positions, [{ id: 70, deviceId: 7, latitude: -12.97, longitude: -38.51, speed: 0, fixTime: '2026-09-29T00:00:00.000Z' }]);
    assert.equal(overview.map.tileUrl, env.FINDHUB_MAP_TILE_URL);
    assert.equal(JSON.stringify(overview).includes(env.TRACCAR_ADMIN_PASSWORD), false);
    assert.deepEqual(cookies, ['JSESSIONID=internal-session', 'JSESSIONID=internal-session', 'JSESSIONID=internal-session']);

    await service.overview();
    assert.equal(loginCount, 1);
  } finally {
    await close(upstream);
  }
});

test('Manager frontend has a gated native Traccar screen and never embeds administrative credentials', () => {
  const icons = fs.readFileSync(path.join(root, 'manager/src/components/AppIcon.vue'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'manager/src/layouts/AppShell.vue'), 'utf8');
  const router = fs.readFileSync(path.join(root, 'manager/src/router/index.ts'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'manager/src/views/TraccarView.vue'), 'utf8');
  const map = fs.readFileSync(path.join(root, 'manager/src/components/FindHubMap.vue'), 'utf8');
  const current = fs.readFileSync(path.join(root, 'manager/src/services/current.ts'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'src/api/routes/view.router.ts'), 'utf8');

  assert.match(shell, /label:'Google Find Hub'.*icon:'location'/);
  assert.match(shell, /label:'Traccar'.*icon:'fleet'.*feature:'traccar'/);
  assert.match(icons, /fleet: \[/);
  assert.match(router, /path: '\/traccar'.*feature: 'traccar'/);
  assert.match(view, /connect\.traccarOverview\(\)/);
  assert.match(view, /FindHubMap/);
  assert.match(view, /Todos os dispositivos/);
  assert.match(view, /:positions="mapDevices"/);
  assert.doesNotMatch(view, /<iframe|TRACCAR_ADMIN_PASSWORD|TRACCAR_ADMIN_EMAIL|TRACCAR_DATABASE_PASSWORD/);
  assert.match(map, /positions\?: MapDevice\[\]/);
  assert.match(map, /<img v-for="tile in tiles"/);
  assert.doesNotMatch(map, /if \(!props\.position \|\| tileError\.value\)/);
  assert.match(current, /\/manager-api\/v1\/traccar\/overview/);
  assert.match(runtime, /features: \{ \.\.\.managerFeatures\(\), traccar: traccarManagerPortalEnabled\(\) \}/);
});
