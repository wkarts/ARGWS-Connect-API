const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const json = (name) => JSON.parse(read(name));
const python = process.platform === 'win32' ? 'python' : 'python3';

test('all Find Hub deployment mirrors remain synchronized and include a dedicated key', () => {
  const check = spawnSync(python, ['scripts/sync-findhub-deployments.py', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const coverage = json('docs/operations/findhub-deployment-coverage.json');
  assert.ok(coverage.apiServices.length >= 8, 'Root, profiles and Swarm must be covered');
  assert.ok(coverage.apiServices.some((item) => item.path === 'Docker/swarm/argws_connect_api_v2.yaml'));
  assert.ok(coverage.apiServices.some((item) => item.path === 'deploy/develop/compose.yaml'));
  assert.ok(coverage.apiServices.some((item) => item.path === 'deploy/canonical/compose.yaml'));
  assert.ok(coverage.scalarComposeFiles.some((item) => item.startsWith('deploy/docs')));
  assert.equal(coverage.environmentVariables.FINDHUB_CREDENTIALS_KEY, '', 'No shared production encryption key in templates');
  for (const file of coverage.apiEnvironmentTemplates) {
    for (const name of Object.keys(coverage.environmentVariables)) {
      assert.equal((read(file).match(new RegExp(`^${name}=`, 'gm')) || []).length, 1, `${file}: ${name}`);
    }
  }
  for (const file of coverage.scalarComposeFiles) {
    assert.ok(read(file).includes('openapi/findhub.openapi.json'), file);
  }
});

test('Scalar ships a dedicated Find Hub document with every implemented route and real schemas', () => {
  const general = json('docs/openapi/connect-api.openapi.json');
  const dedicated = json('docs/openapi/findhub.openapi.json');
  const implemented = Object.keys(general.paths).filter((item) => item.startsWith('/findhub/')).sort();
  // PUT and DELETE share the Traccar path: 11 distinct paths, 12 HTTP operations.
  assert.equal(implemented.length, 11);
  assert.equal(implemented.reduce((count, route) => count + Object.keys(general.paths[route]).length, 0), 12);
  assert.deepEqual(Object.keys(dedicated.paths).sort(), implemented);
  assert.match(dedicated.info.description, /CredentialProvider/);
  assert.match(dedicated.info.description, /FINDHUB_CREDENTIALS_KEY/);
  assert.match(dedicated.info.description, /não implementa um login Google OAuth/);
  assert.ok(read('docs/Dockerfile').includes('COPY docs/openapi/findhub.openapi.json /docs/findhub.openapi.json'));
  assert.ok(read('docs/pwa/index.html').includes('openapi/findhub.openapi.json'));
  for (const route of implemented) {
    for (const operation of Object.values(dedicated.paths[route])) {
      assert.deepEqual(operation.tags, ['Google Find Hub']);
      assert.ok(operation.description.length > 60);
      assert.ok(!JSON.stringify(operation.responses).includes('GenericResponse'), route);
      assert.deepEqual(operation.security, [{ apiKey: [] }]);
    }
  }
  const start = dedicated.paths['/findhub/auth/start/{instanceName}'].post;
  assert.ok(start.responses['201']);
  assert.equal(start.responses['200'], undefined);
  const remove = dedicated.paths['/findhub/traccar/{deviceId}/{instanceName}'].delete;
  assert.deepEqual(remove.responses['204'], { description: 'Vínculo removido; resposta sem corpo.' });
  assert.equal(remove.requestBody, undefined);
  const bundle = dedicated.components.schemas.FindHubCredentialBundleRequest;
  assert.deepEqual(bundle.required, ['sessionId', 'bridgeToken', 'email', 'androidId', 'accountToken', 'sharedKey']);
  assert.equal(bundle.properties.accountToken.writeOnly, true);
  assert.equal(bundle.properties.sharedKey.writeOnly, true);
  assert.equal(bundle.properties.FINDHUB_CREDENTIALS_KEY, undefined);
  function references(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref && value.$ref.startsWith('#/')) {
      let found = dedicated;
      for (const part of value.$ref.slice(2).split('/')) found = found?.[part];
      assert.ok(found, `Unresolved reference: ${value.$ref}`);
    }
    for (const item of Object.values(value)) references(item);
  }
  references(dedicated);
});

test('Find Hub events describe actual data and do not claim an unimplemented auth notification', () => {
  const events = json('docs/asyncapi/connect-api-events.asyncapi.json');
  for (const name of ['findhub.auth.update', 'findhub.devices.updated', 'findhub.location.updated', 'findhub.tracking.update', 'findhub.error']) {
    const channel = events.channels[name];
    assert.ok(channel, name);
    const id = channel.subscribe.message.$ref.split('/').pop();
    assert.ok(events.components.messages[id]?.payload?.properties?.data, name);
  }
  assert.match(events.channels['findhub.auth.update'].description, /não emite/);
});
