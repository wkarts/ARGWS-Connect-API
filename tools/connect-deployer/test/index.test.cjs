const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const tool = path.resolve(__dirname, '..', 'index.cjs');
const { build, parseEnv, parseModules, hasComposeEnvFile, hasComposeServices, validate } = require(tool);

test('seleciona modulos sem ativar extended acidentalmente', () => {
  const result = build({
    flavor: 'develop',
    modules: 'operations,traccar',
    sets: [],
  });
  const env = parseEnv(result.env);
  assert.equal(env.get('COMPOSE_PROFILES'), 'operations,traccar');
  assert.equal(env.get('TRACCAR_ENABLED'), 'true');
  assert.equal(env.get('TRACCAR_MODE'), 'internal');
  assert.equal(env.get('TRACCAR_TOKEN'), '');
  assert.notEqual(env.get('TRACCAR_ADMIN_PASSWORD'), '');
  assert.notEqual(env.get('TRACCAR_DATABASE_PASSWORD'), '');
  assert.notEqual(env.get('AUTHENTICATION_API_KEY'), '');
});

test('extended seleciona NATS e Kafka', () => {
  assert.deepEqual(parseModules('extended'), ['nats', 'kafka', 'extended']);
  const result = build({ flavor: 'production', modules: 'extended', sets: [] });
  assert.equal(parseEnv(result.env).get('COMPOSE_PROFILES'), 'nats,kafka,extended');
});

test('bloqueia token Traccar igual a chave da API', () => {
  assert.throws(() => build({
    flavor: 'develop',
    modules: 'traccar',
    traccarAuth: 'token',
    traccarToken: 'same-secret',
    sets: ['AUTHENTICATION_API_KEY=same-secret'],
  }), /nao pode reutilizar/);
});

test('gera somente compose.yaml e .env e valida a saida', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'argws-connect-deployer-'));
  execFileSync(process.execPath, [tool, 'generate', '--flavor', 'develop', '--modules', 'operations,traccar', '--output', directory], { stdio: 'pipe' });
  assert.deepEqual(fs.readdirSync(directory).sort(), ['.env', 'compose.yaml']);
  execFileSync(process.execPath, [tool, 'validate', '--directory', directory], { stdio: 'pipe' });
  const envMode = fs.statSync(path.join(directory, '.env')).mode & 0o777;
  if (process.platform !== 'win32') {
    assert.equal(envMode, 0o600);
  }
});

test('importa env sem reordenar linhas', () => {
  const input = '# cabecalho\nFOO=um\n\nBAR=dois\n';
  const result = require(tool).setEnv(input, { FOO: 'tres', NEW_VALUE: 'quatro' });
  assert.equal(result, '# cabecalho\nFOO=tres\n\nBAR=dois\nNEW_VALUE=quatro\n');
});

test('valida secoes Compose sem regex ambigua', () => {
  assert.equal(hasComposeServices('name: app\nservices:\n  api:\n'), true);
  assert.equal(hasComposeServices('name: app\nvolumes:\n'), false);
  assert.equal(hasComposeEnvFile('services:\n  api:\n    env_file: [.env]\n'), true);
  assert.equal(hasComposeEnvFile('services:\n  api:\n    env_file:\n      - .env\n'), true);
  assert.equal(hasComposeEnvFile('services:\n  api:\n    environment:\n      FOO: bar\n'), false);
});
