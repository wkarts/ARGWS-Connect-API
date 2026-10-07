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
  assert.equal(env.get('SPEECH_ENABLED'), 'false');
  assert.equal(env.get('MANAGER_FEATURE_TRANSCRIPTION'), 'false');
  assert.equal(env.get('TRACCAR_ENABLED'), 'true');
  assert.equal(env.get('TRACCAR_MODE'), 'internal');
  assert.equal(env.get('TRACCAR_TOKEN'), '');
  assert.notEqual(env.get('TRACCAR_ADMIN_PASSWORD'), '');
  assert.notEqual(env.get('TRACCAR_DATABASE_PASSWORD'), '');
  assert.notEqual(env.get('AUTHENTICATION_API_KEY'), '');
});

test('speech is opt-in in production and enabled when explicitly selected', () => {
  const standard = parseEnv(build({ flavor: 'production', sets: [] }).env);
  assert.equal(standard.get('COMPOSE_PROFILES'), 'operations');
  assert.equal(standard.get('SPEECH_ENABLED'), 'false');
  assert.equal(standard.get('TRANSCRIPTION_ENABLED'), 'false');
  assert.equal(standard.get('DICTATION_ENABLED'), 'false');
  assert.equal(standard.get('SPEECH_WORKER_MODE'), 'pool');
  assert.equal(standard.get('SPEECH_TRANSCRIPTION_REPLICAS'), '1');
  const selected = parseEnv(build({ flavor: 'canonical', modules: 'transcription', sets: [] }).env);
  assert.equal(selected.get('COMPOSE_PROFILES'), 'transcription');
  assert.equal(selected.get('SPEECH_ENABLED'), 'true');
  assert.equal(selected.get('TRANSCRIPTION_ENABLED'), 'true');
  assert.equal(selected.get('DICTATION_ENABLED'), 'true');
  assert.equal(selected.get('ARGWS_CONNECT_TRANSCRIPTION_WORKER_IMAGE'), 'ghcr.io/wkarts/argws-connect-transcription-worker:1.3.0');
});

test('all flavors share one pool and respect an explicit dictation preference', () => {
  for (const flavor of ['develop', 'homologation', 'production', 'canonical', 'dockge', 'cloudpanel']) {
    const result = build({ flavor, modules: 'transcription', sets: ['DICTATION_ENABLED=false'] });
    const env = parseEnv(result.env);
    assert.equal(env.get('DICTATION_ENABLED'), 'false');
    assert.equal(env.get('SPEECH_WORKER_MODE'), 'pool');
    assert.equal(env.get('SPEECH_TRANSCRIPTION_REPLICAS'), '1');
    assert.equal(env.get('SPEECH_S3_BUCKET_NAME'), '');
    assert.doesNotMatch(result.compose, /^  speech-dictation-worker/m);
    assert.match(result.compose, /^    scale: 1$/m);
  }
});

test('imported speech flags remain unchanged while old replica counts are reconciled', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-deployer-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const initial = build({ flavor: 'develop', modules: 'transcription', sets: [
    'SPEECH_ENABLED=false', 'DICTATION_ENABLED=false', 'SPEECH_TRANSCRIPTION_REPLICAS=3',
    'SPEECH_S3_BUCKET_NAME=installed-private-speech',
  ] });
  const file = path.join(directory, 'installed.env');
  fs.writeFileSync(file, initial.env);
  const imported = parseEnv(build({ flavor: 'develop', fromEnv: file, sets: [] }).env);
  assert.equal(imported.get('SPEECH_ENABLED'), 'false');
  assert.equal(imported.get('DICTATION_ENABLED'), 'false');
  assert.equal(imported.get('SPEECH_TRANSCRIPTION_REPLICAS'), '1');
  assert.equal(imported.get('SPEECH_S3_BUCKET_NAME'), 'installed-private-speech');
  fs.writeFileSync(file, initial.env.replace(/^SPEECH_S3_BUCKET_NAME=.*\n/m, ''));
  const withoutBucket = parseEnv(build({ flavor: 'develop', fromEnv: file, sets: [] }).env);
  assert.equal(withoutBucket.get('SPEECH_S3_BUCKET_NAME'), '', 'old installs derive the private bucket at runtime');
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
