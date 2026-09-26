const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Find Hub raw protocol capture returns binary artifacts and never persists raw protobufs', () => {
  const router = read('src/api/integrations/channel/findhub/findhub.router.ts');
  const runtime = read('src/api/integrations/channel/findhub/services/findhub-runtime.service.ts');
  const protocol = read('src/api/integrations/channel/findhub/services/findhub-protocol.client.ts');
  const nova = read('src/api/integrations/channel/findhub/protocol/nova.client.ts');

  assert.match(router, /protocol\/capture\/catalog\/:catalog\/:instanceName/);
  assert.match(router, /protocol\/capture\/device-update\/:deviceId\/:instanceName/);
  assert.match(router, /application\/x-protobuf/);
  assert.match(router, /Content-Disposition/);

  assert.match(nova, /captureDevicesListRaw/);
  assert.match(protocol, /rawCaptures/);
  assert.match(protocol, /captureDeviceUpdateRaw/);
  assert.match(protocol, /capture\.resolve\(\{[\s\S]*payload: Buffer\.from\(payload\)/);
  assert.match(runtime, /captureProtocolCatalog/);
  assert.match(runtime, /captureProtocolDeviceUpdate/);

  for (const source of [router, runtime, protocol]) {
    assert.doesNotMatch(source, /findHubProtocolCapture\.create|protocolCapture\.create|rawProtobuf.*prisma/i);
  }
});

test('Find Hub manager offers direct .pb capture without disconnecting or relinking the account', () => {
  const view = read('manager/src/views/FindHubView.vue');
  const current = read('manager/src/services/current.ts');
  assert.match(view, /Capturar SPOT \.pb/);
  assert.match(view, /Capturar Android \.pb/);
  assert.match(view, /Capturar DeviceUpdate \.pb/);
  assert.match(view, /dados sensíveis/);
  assert.match(current, /findHubCaptureCatalog/);
  assert.match(current, /findHubCaptureDeviceUpdate/);
  assert.match(current, /response\.blob\(\)/);
  assert.doesNotMatch(current, /findHubDisconnect.*findHubCapture/i);
});

test('Nova probes optional Android, Auto, Fast Pair and supervised catalogues without replacing SPOT', () => {
  const nova = read('src/api/integrations/channel/findhub/protocol/nova.client.ts');
  assert.match(nova, /captureDevicesListRaw\('spot'\)/);
  assert.match(nova, /\['android', 'auto', 'fastpair', 'supervised'\]/);
  assert.match(nova, /catch \{/);
  assert.match(nova, /\[\.\.\.complementary, \.\.\.primary\]/);
});
