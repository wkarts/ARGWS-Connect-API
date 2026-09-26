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

test('Find Hub sound follows advertised action capabilities instead of catalogue identifier type', () => {
  const protocol = read('src/api/integrations/channel/findhub/services/findhub-protocol.client.ts');
  const view = read('manager/src/views/FindHubView.vue');

  assert.match(protocol, /findHubSupportsSoundAction/);
  assert.match(protocol, /operation === 'start' \? 31 : 32/);
  assert.match(protocol, /capability\.actionField === actionField/);
  assert.match(protocol, /capability\.state === 1/);
  assert.match(protocol, /device\.locateSupported === false/);
  assert.match(protocol, /device\.identifierType === 'SPOT'/);
  assert.doesNotMatch(protocol, /disponível somente para dispositivos SPOT/);

  assert.match(view, /soundOperationSupported/);
  assert.match(view, /actionField\) === actionField/);
  assert.match(view, /soundComponentSelectionSupported/);
  assert.doesNotMatch(view, /v-if="device\.identifierType==='SPOT'"/);
});

test('Nova treats SPOT, Android, Auto, Fast Pair and supervised selectors as resilient discovery paths', () => {
  const nova = read('src/api/integrations/channel/findhub/protocol/nova.client.ts');
  assert.match(nova, /\['spot', 'android', 'auto', 'fastpair', 'supervised'\]/);
  assert.match(nova, /Promise\.all/);
  assert.match(nova, /result\.catalog !== 'spot'/);
  assert.match(nova, /result\.catalog === 'spot'/);
  assert.match(nova, /never make it a hard dependency/);
  assert.match(nova, /did not return any readable device catalogue/);
});
