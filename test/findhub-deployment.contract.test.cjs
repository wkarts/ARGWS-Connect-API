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
  // Monitoring adds five paths and six operations; settings and Traccar share method paths.
  assert.equal(implemented.length, 22);
  assert.equal(implemented.reduce((count, route) => count + Object.keys(general.paths[route]).length, 0), 25);
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
  for (const [route, methods] of [
    ['/findhub/settings/{instanceName}', ['get', 'put']],
    ['/findhub/device/{deviceId}/settings/{instanceName}', ['put']],
    ['/findhub/location/{deviceId}/{instanceName}', ['get']],
    ['/findhub/history/{deviceId}/{instanceName}', ['get']],
    ['/findhub/events/stream/{instanceName}', ['get']],
  ]) {
    assert.deepEqual(Object.keys(dedicated.paths[route]).sort(), methods, route);
    for (const method of methods) assert.deepEqual(dedicated.paths[route][method], general.paths[route][method], route);
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


test('invalid optional Find Hub configuration does not abort other channels deployment', () => {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'findhub-optional-'));
  try {
    const envFile = path.join(directory, '.env');
    const before = 'AUTHENTICATION_API_KEY=keep-fixture-key\nFINDHUB_CREDENTIALS_KEY=invalid-fixture-key\n';
    fs.writeFileSync(envFile, before, { mode: 0o600 });
    const strict = spawnSync(python, [path.join(root, 'scripts/prepare-findhub-env.py'), '--env-file', envFile, '--check', '--require-key'], { encoding: 'utf8' });
    assert.notEqual(strict.status, 0, 'Explicit Find Hub activation must still reject an invalid key');
    assert.equal(fs.readFileSync(envFile, 'utf8'), before, 'Invalid credentials are never rotated');
    const coverage = json('docs/operations/findhub-deployment-coverage.json');
    const candidates = ['prepare-env.sh', 'preflight.sh', ...['canonical','cloudpanel','develop','dockge','homologation','production'].flatMap(name => [`deploy/${name}/prepare-env.sh`, `deploy/${name}/preflight.sh`])];
    for (const file of candidates) {
      const script = read(file);
      const block = script.match(/if ! python3 \.\/prepare-findhub-env\.py[^\n]*\n[\s\S]*?\nfi/);
      assert.ok(block, `Channel-only warning boundary missing in ${file}`);
      assert.ok(script.includes('set -euo pipefail'), 'Global validation must remain strict');
      fs.copyFileSync(path.join(root, 'scripts/prepare-findhub-env.py'), path.join(directory, 'prepare-findhub-env.py'));
      const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' + block[0] + '\necho OTHER_CHANNELS_CONTINUE'], { cwd: directory, encoding: 'utf8' });
      assert.equal(result.status, 0, file + ': ' + result.stderr);
      assert.match(result.stdout, /OTHER_CHANNELS_CONTINUE/);
      assert.match(result.stderr, /AVISO/);
      assert.equal(fs.readFileSync(envFile, 'utf8'), before);
    }
    assert.ok(coverage.apiServices.length >= 8);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
