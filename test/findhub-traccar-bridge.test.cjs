'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadClient(env) {
  const source = fs.readFileSync(
    path.join(root, 'src/api/integrations/channel/findhub/services/traccar-client.ts'),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const moduleResult = { exports: {} };
  vm.runInNewContext(compiled, {
    module: moduleResult,
    exports: moduleResult.exports,
    require,
    process: { env },
    Buffer,
    URL,
    URLSearchParams,
    AbortSignal,
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

test('Find Hub bridge sends battery metadata and deletes only its owned Traccar device', async (t) => {
  const calls = [];
  const devices = new Map();
  let nextId = 7;
  const upstream = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const finish = (status, body, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    const read = () => new Promise((resolve) => {
      let payload = '';
      request.on('data', (chunk) => { payload += chunk; });
      request.on('end', () => resolve(payload));
    });

    if (url.pathname === '/api/session') {
      calls.push({ method: request.method, path: url.pathname });
      finish(204, undefined, { 'set-cookie': 'JSESSIONID=test-session; Path=/; HttpOnly' });
      return;
    }
    if (url.pathname === '/' && request.method === 'POST') {
      void read().then((payload) => {
        calls.push({ method: request.method, path: '/receiver', form: new URLSearchParams(payload) });
        finish(200, { accepted: true });
      });
      return;
    }
    if (url.pathname === '/api/devices' && request.method === 'GET') {
      const uniqueId = url.searchParams.get('uniqueId');
      finish(200, uniqueId ? [...devices.values()].filter((device) => device.uniqueId === uniqueId) : [...devices.values()]);
      return;
    }
    const deviceMatch = url.pathname.match(/^\/api\/devices\/(\d+)$/);
    if (url.pathname === '/api/devices' && request.method === 'POST') {
      void read().then((payload) => {
        const data = JSON.parse(payload);
        const device = { id: nextId++, ...data };
        devices.set(device.id, device);
        calls.push({ method: request.method, path: url.pathname, json: data });
        finish(200, device);
      });
      return;
    }
    if (deviceMatch && request.method === 'GET') {
      const device = devices.get(Number(deviceMatch[1]));
      if (!device) finish(404, { error: 'missing' });
      else finish(200, device);
      return;
    }
    if (deviceMatch && request.method === 'PUT') {
      void read().then((payload) => {
        const data = JSON.parse(payload);
        const device = devices.get(Number(deviceMatch[1]));
        if (!device) finish(404, { error: 'missing' });
        else {
          devices.set(device.id, { ...device, ...data });
          calls.push({ method: request.method, path: url.pathname, json: data });
          finish(200, devices.get(device.id));
        }
      });
      return;
    }
    if (deviceMatch && request.method === 'DELETE') {
      const id = Number(deviceMatch[1]);
      if (!devices.has(id)) finish(404, { error: 'missing' });
      else {
        devices.delete(id);
        calls.push({ method: request.method, path: url.pathname });
        response.writeHead(204);
        response.end();
      }
      return;
    }
    finish(404, { error: 'unknown route' });
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
      TRACCAR_INTERNAL_RECEIVER_URL: `http://127.0.0.1:${port}`,
      TRACCAR_ADMIN_EMAIL: 'admin@example.invalid',
      TRACCAR_ADMIN_PASSWORD: 'server-only-password',
    };
    const { TraccarClient, traccarUniqueId } = loadClient(env);
    const client = new TraccarClient({ mode: 'internal' });
    const uniqueId = traccarUniqueId('instance-1', 'device-1');
    const provisioned = await client.provision('instance-1', 'device-1', 'Veículo 01', {
      findhubBatteryTier: 'HIGH',
      findhubImei: '123456789012345',
    });
    assert.equal(provisioned.id, 7);
    assert.deepEqual(calls.find((call) => call.method === 'POST' && call.path === '/api/devices').json.attributes, {
      connectInstanceId: 'instance-1',
      connectDeviceId: 'device-1',
      findhubBatteryTier: 'HIGH',
      findhubImei: '123456789012345',
    });

    await client.send(uniqueId, {
      latitude: -12.97,
      longitude: -38.51,
      timestamp: '2026-09-29T12:00:00.000Z',
      accuracy: 8,
      altitude: 20,
      batteryLevel: 77,
      batteryTier: 'HIGH',
      batteryTierSource: 'registration.2.11',
      charging: true,
      attributes: { findhubBridgeStatus: 'online' },
    });
    const sent = calls.find((call) => call.method === 'POST' && call.path === '/receiver').form;
    assert.equal(sent.get('id'), uniqueId);
    assert.equal(sent.get('batt'), '77');
    assert.equal(sent.get('charge'), 'true');
    assert.equal(sent.get('findhubBatteryTier'), 'HIGH');
    assert.equal(sent.get('findhubBatteryTierSource'), 'registration.2.11');
    assert.equal(sent.get('findhubBridgeStatus'), 'online');

    await client.removeProvisioned('instance-1', 'device-1', provisioned.id, uniqueId);
    assert.equal(devices.has(provisioned.id), false);
    await client.removeProvisioned('instance-1', 'device-1', provisioned.id, uniqueId);
    assert.equal(calls.some((call) => call.method === 'DELETE'), true);

    devices.set(8, {
      id: 8,
      name: 'Outro',
      uniqueId,
      attributes: { connectInstanceId: 'other-instance', connectDeviceId: 'other-device' },
    });
    await assert.rejects(
      client.removeProvisioned('instance-1', 'device-1', 8, uniqueId),
      /não pertence a esta vinculação/,
    );
    assert.equal(devices.has(8), true);
  } finally {
    await close(upstream);
  }
});
