#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');

const FLAVORS = Object.freeze({
  develop: {
    compose: 'deploy/develop/compose.yaml',
    env: 'deploy/develop/env.example',
    channel: 'develop',
  },
  homologation: {
    compose: 'deploy/homologation/compose.yaml',
    env: 'deploy/homologation/env.example',
    channel: 'develop',
  },
  production: {
    compose: 'deploy/production/compose.yaml',
    env: 'deploy/production/env.example',
    channel: 'latest',
  },
  canonical: {
    compose: 'deploy/canonical/compose.yaml',
    env: 'deploy/canonical/env.example',
    channel: '1.3.0',
  },
  dockge: {
    compose: 'deploy/dockge/compose.yaml',
    env: 'deploy/dockge/env.example',
    channel: 'latest',
  },
  cloudpanel: {
    compose: 'deploy/cloudpanel/docker-compose.yml',
    env: 'deploy/cloudpanel/env.example',
    channel: 'latest',
  },
});

const MODULE_ORDER = ['operations', 'nats', 'kafka', 'extended', 'mysql', 'traccar', 'transcription'];
const MODULES = new Set(MODULE_ORDER);

const SECRET_KEYS = [
  'METRICS_PASSWORD',
  'POSTGRES_PASSWORD',
  'MYSQL_PASSWORD',
  'MYSQL_ROOT_PASSWORD',
  'REDIS_PASSWORD',
  'RABBITMQ_DEFAULT_PASS',
  'S3_SECRET_KEY',
  'MINIO_ROOT_PASSWORD',
  'AUTHENTICATION_API_KEY',
  'OPERATIONS_INTERNAL_TOKEN',
  'FINDHUB_CREDENTIALS_KEY',
  'TRACCAR_ADMIN_PASSWORD',
  'TRACCAR_DATABASE_PASSWORD',
];

const COMMANDS = new Set(['list', 'plan', 'generate', 'validate', 'help', '--help', '-h']);

function usage() {
  return `Connect|API Deployer

Uso:
  argws-connect-deployer list
  argws-connect-deployer plan --flavor develop --modules operations,traccar,transcription
  argws-connect-deployer generate --flavor develop --modules operations,traccar,transcription --output ./stack
  argws-connect-deployer validate --directory ./stack

Opcoes:
  --flavor <nome>              develop, homologation, production, canonical, dockge ou cloudpanel
  --modules <lista>            operations,nats,kafka,extended,mysql,traccar,transcription
  --output <diretorio>         destino do compose.yaml e .env
  --directory <diretorio>      stack existente para validar
  --from-env <arquivo>         importa um .env existente sem reordenar variaveis
  --traccar-auth <modo>        credentials (padrao) ou token
  --traccar-token <token>      token Traccar existente; nunca a chave da API
  --traccar-admin-email <email> email administrativo do Traccar
  --server-url <url>           sobrescreve SERVER_URL
  --docs-url <url>             sobrescreve ARGWS_CONNECT_DOCS_PUBLIC_URL
  --project-name <nome>        sobrescreve COMPOSE_PROJECT_NAME
  --set KEY=VALUE              sobrescreve uma variavel; pode ser repetido
  --force                      permite substituir compose.yaml e .env existentes
  --json                       imprime o plano em JSON
  --help                       mostra esta ajuda

O gerador cria somente compose.yaml e .env. O stack nao depende de scripts auxiliares.
No modo credentials, TRACCAR_TOKEN fica vazio e a API usa a sessao administrativa interna.
`;
}

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`nao foi possivel ler ${file}: ${error.message}`);
  }
}

function loadTemplate(relativeFile) {
  let templates;
  try { templates = require('./templates.cjs'); } catch {}
  if (templates && templates[relativeFile]) return templates[relativeFile];
  return readText(path.join(ROOT, relativeFile));
}

function parseArgs(argv) {
  const command = argv[0] || 'help';
  const options = { command, sets: [] };
  if (!COMMANDS.has(command)) fail(`comando desconhecido: ${command}\n\n${usage()}`);

  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') options.command = 'help';
    else if (item === '--json') options.json = true;
    else if (item === '--force') options.force = true;
    else if (item === '--flavor') options.flavor = nextValue(argv, ++index, item);
    else if (item === '--modules') options.modules = nextValue(argv, ++index, item);
    else if (item === '--output') options.output = nextValue(argv, ++index, item);
    else if (item === '--directory') options.directory = nextValue(argv, ++index, item);
    else if (item === '--from-env') options.fromEnv = nextValue(argv, ++index, item);
    else if (item === '--traccar-auth') options.traccarAuth = nextValue(argv, ++index, item);
    else if (item === '--traccar-token') options.traccarToken = nextValue(argv, ++index, item);
    else if (item === '--traccar-admin-email') options.traccarAdminEmail = nextValue(argv, ++index, item);
    else if (item === '--server-url') options.serverUrl = nextValue(argv, ++index, item);
    else if (item === '--docs-url') options.docsUrl = nextValue(argv, ++index, item);
    else if (item === '--project-name') options.projectName = nextValue(argv, ++index, item);
    else if (item === '--set') options.sets.push(nextValue(argv, ++index, item));
    else fail(`opcao desconhecida: ${item}\n\n${usage()}`);
  }
  return options;
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) fail(`${flag} exige um valor`);
  return value;
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function setEnv(text, updates) {
  const pending = new Map(Object.entries(updates));
  const hadTrailingNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();
  const replaced = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(=).*$/);
    if (!match || !pending.has(match[2])) return line;
    const value = pending.get(match[2]);
    pending.delete(match[2]);
    return `${match[1]}${match[2]}${match[3]}${value}`;
  });
  for (const [key, value] of pending) replaced.push(`${key}=${value}`);
  return `${replaced.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
}

function envValue(values, key) {
  return values.get(key) || '';
}

function isPlaceholder(value) {
  const normalized = String(value || '').trim();
  return !normalized || normalized.startsWith('CHANGE_ME');
}

function secret() {
  return crypto.randomBytes(32).toString('base64url');
}

function sharedSecret(values, keys, generated) {
  const existing = keys.map((key) => envValue(values, key)).find((value) => !isPlaceholder(value));
  const value = existing || secret();
  for (const key of keys) {
    if (isPlaceholder(envValue(values, key))) {
      values.set(key, value);
      generated.add(key);
    }
  }
  return value;
}

function updateUriPassword(values, key, placeholder, password) {
  const current = envValue(values, key);
  if (!current || current.includes(placeholder)) {
    values.set(key, current.replace(placeholder, password));
    return;
  }
  if (current.includes('CHANGE_ME')) values.set(key, current.replace(/CHANGE_ME_[A-Z0-9_]+/g, password));
}

function parseModules(raw) {
  const requested = (raw === undefined ? 'operations' : raw)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 1 && requested[0] === 'none') return [];
  const modules = new Set(requested);
  for (const module of modules) {
    if (!MODULES.has(module)) fail(`modulo desconhecido: ${module}. Opcoes: ${MODULE_ORDER.join(', ')}`);
  }
  if (modules.has('extended')) {
    modules.add('nats');
    modules.add('kafka');
  }
  return MODULE_ORDER.filter((module) => modules.has(module));
}

function composeProfiles(modules) {
  const profiles = new Set(modules.filter((module) => module !== 'extended'));
  if (modules.includes('extended')) profiles.add('extended');
  return MODULE_ORDER.filter((module) => profiles.has(module)).join(',');
}

function loadBase(options) {
  const flavor = options.flavor || 'develop';
  const selected = FLAVORS[flavor];
  if (!selected) fail(`flavor desconhecido: ${flavor}. Opcoes: ${Object.keys(FLAVORS).join(', ')}`);

  const compose = loadTemplate(selected.compose);
  const env = options.fromEnv ? readText(path.resolve(options.fromEnv)) : loadTemplate(selected.env);
  return { flavor, selected, compose, env };
}

function build(options) {
  const base = loadBase(options);
  const values = parseEnv(base.env);
  const modules = parseModules(options.modules === undefined ? values.get('COMPOSE_PROFILES') : options.modules);
  const generated = new Set();
  const updates = {};

  updates.COMPOSE_PROFILES = composeProfiles(modules);
  updates.OPERATIONS_ENABLED = modules.includes('operations') ? 'true' : 'false';
  updates.NATS_ENABLED = modules.includes('nats') ? 'true' : 'false';
  updates.KAFKA_ENABLED = modules.includes('kafka') ? 'true' : 'false';
  updates.MYSQL_SERVICE_ENABLED = modules.includes('mysql') ? 'true' : 'false';
  updates.TRACCAR_ENABLED = modules.includes('traccar') ? 'true' : 'false';
  updates.TRACCAR_MODE = modules.includes('traccar') ? 'internal' : 'disabled';
  for (const key of ['TRANSCRIPTION_ENABLED', 'SPEECH_ENABLED', 'MANAGER_FEATURE_TRANSCRIPTION', 'DICTATION_ENABLED']) {
    updates[key] = modules.includes('transcription')
      ? (options.fromEnv && values.has(key) ? values.get(key) : 'true')
      : 'false';
  }
  // A single native service owns both modes; remove obsolete executor settings.
  for (const key of ["SPEECH_WORKER_MODE", "SPEECH_WORKER_CONCURRENCY", "TRANSCRIPTION_WORKER_CONCURRENCY", "SPEECH_TRANSCRIPTION_REPLICAS", "SPEECH_DICTATION_REPLICAS", "DICTATION_WORKER_CONCURRENCY", "ARGWS_CONNECT_TRANSCRIPTION_WORKER_IMAGE", "SPEECH_WORKER_MEMORY", "SPEECH_WORKER_CPUS", "TRANSCRIPTION_WORKER_MEMORY", "TRANSCRIPTION_WORKER_CPUS", "TRANSCRIPTION_WORKER_TMPFS_SIZE", "SPEECH_SYNC_MODEL_CACHE", "TRANSCRIPTION_MODEL_STORAGE_PREFIX", "TRANSCRIPTION_MODEL_CACHE_DIR"]) values.delete(key);
  // The runtime derives a private bucket from this installation's media bucket.
  updates.SPEECH_S3_BUCKET_NAME = values.get('SPEECH_S3_BUCKET_NAME') || '';

  if (options.serverUrl) updates.SERVER_URL = options.serverUrl;
  if (options.docsUrl) updates.ARGWS_CONNECT_DOCS_PUBLIC_URL = options.docsUrl;
  if (options.projectName) updates.COMPOSE_PROJECT_NAME = options.projectName;
  if (options.traccarAdminEmail) updates.TRACCAR_ADMIN_EMAIL = options.traccarAdminEmail;

  sharedSecret(values, ['S3_SECRET_KEY', 'MINIO_ROOT_PASSWORD'], generated);
  sharedSecret(values, ['POSTGRES_PASSWORD'], generated);
  sharedSecret(values, ['REDIS_PASSWORD'], generated);
  sharedSecret(values, ['RABBITMQ_DEFAULT_PASS'], generated);

  for (const key of SECRET_KEYS) {
    if (key === 'OPERATIONS_INTERNAL_TOKEN' && !modules.includes('operations')) continue;
    if (isPlaceholder(envValue(values, key)) && (key !== 'TRACCAR_ADMIN_PASSWORD' && key !== 'TRACCAR_DATABASE_PASSWORD')) {
      values.set(key, secret());
      generated.add(key);
    }
  }

  if (modules.includes('operations')) {
    if (isPlaceholder(envValue(values, 'OPERATIONS_INTERNAL_TOKEN'))) {
      values.set('OPERATIONS_INTERNAL_TOKEN', secret());
      generated.add('OPERATIONS_INTERNAL_TOKEN');
    }
  }

  const traccarAuth = options.traccarAuth || 'credentials';
  if (!['credentials', 'token'].includes(traccarAuth)) fail('--traccar-auth deve ser credentials ou token');
  if (modules.includes('traccar')) {
    if (isPlaceholder(envValue(values, 'TRACCAR_ADMIN_PASSWORD'))) {
      values.set('TRACCAR_ADMIN_PASSWORD', secret());
      generated.add('TRACCAR_ADMIN_PASSWORD');
    }
    if (isPlaceholder(envValue(values, 'TRACCAR_DATABASE_PASSWORD'))) {
      values.set('TRACCAR_DATABASE_PASSWORD', secret());
      generated.add('TRACCAR_DATABASE_PASSWORD');
    }
    if (traccarAuth === 'credentials') {
      updates.TRACCAR_TOKEN = '';
    } else {
      const token = options.traccarToken || envValue(values, 'TRACCAR_TOKEN');
      if (!token) fail('modo token exige --traccar-token ou TRACCAR_TOKEN no .env importado');
      if (token === envValue(values, 'AUTHENTICATION_API_KEY')) {
        fail('TRACCAR_TOKEN nao pode ser igual a AUTHENTICATION_API_KEY; sao credenciais diferentes');
      }
      updates.TRACCAR_TOKEN = token;
    }
  } else {
    updates.TRACCAR_TOKEN = '';
  }

  updateUriPassword(values, 'DATABASE_CONNECTION_URI', 'CHANGE_ME_POSTGRES_PASSWORD', envValue(values, 'POSTGRES_PASSWORD'));
  updateUriPassword(values, 'CACHE_REDIS_URI', 'CHANGE_ME_REDIS_PASSWORD', envValue(values, 'REDIS_PASSWORD'));
  updateUriPassword(values, 'RABBITMQ_URI', 'CHANGE_ME_RABBITMQ_PASSWORD', envValue(values, 'RABBITMQ_DEFAULT_PASS'));

  for (const assignment of options.sets || []) {
    const separator = assignment.indexOf('=');
    if (separator <= 0) fail(`--set exige KEY=VALUE: ${assignment}`);
    const key = assignment.slice(0, separator);
    const value = assignment.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(`nome de variavel invalido em --set: ${key}`);
    updates[key] = value;
  }

  for (const [key, value] of Object.entries(updates)) values.set(key, value);
  if (modules.includes('traccar') && traccarAuth === 'credentials' && envValue(values, 'TRACCAR_TOKEN')) {
    fail('TRACCAR_TOKEN esta preenchido, mas o modo credentials foi escolhido; use --traccar-auth token para importar um token existente');
  }
  if (modules.includes('traccar') && traccarAuth === 'token' && !envValue(values, 'TRACCAR_TOKEN')) {
    fail('modo token exige um TRACCAR_TOKEN valido');
  }
  const retiredSpeechKeys = new Set(["SPEECH_WORKER_MODE", "SPEECH_WORKER_CONCURRENCY", "TRANSCRIPTION_WORKER_CONCURRENCY", "SPEECH_TRANSCRIPTION_REPLICAS", "SPEECH_DICTATION_REPLICAS", "DICTATION_WORKER_CONCURRENCY", "ARGWS_CONNECT_TRANSCRIPTION_WORKER_IMAGE", "SPEECH_WORKER_MEMORY", "SPEECH_WORKER_CPUS", "TRANSCRIPTION_WORKER_MEMORY", "TRANSCRIPTION_WORKER_CPUS", "TRANSCRIPTION_WORKER_TMPFS_SIZE", "SPEECH_SYNC_MODEL_CACHE", "TRANSCRIPTION_MODEL_STORAGE_PREFIX", "TRANSCRIPTION_MODEL_CACHE_DIR"]);
  for (const key of retiredSpeechKeys) values.delete(key);
  const cleanBaseEnv = base.env.split('\n').filter((line) => !retiredSpeechKeys.has(line.trim().split('=', 1)[0])).join('\n');
  const finalEnv = setEnv(cleanBaseEnv, Object.fromEntries(values));
  const report = validate({ compose: base.compose, env: finalEnv, modules, flavor: base.flavor });
  return {
    ...base,
    modules,
    profiles: composeProfiles(modules),
    env: finalEnv,
    report,
    generatedSecrets: [...generated].sort(),
  };
}

function validate({ compose, env, modules = [], flavor = 'unknown' }) {
  const values = parseEnv(env);
  const errors = [];
  const required = ['AUTHENTICATION_API_KEY', 'METRICS_PASSWORD', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_DEFAULT_PASS', 'S3_SECRET_KEY', 'MINIO_ROOT_PASSWORD', 'FINDHUB_CREDENTIALS_KEY'];
  if (modules.includes('mysql')) required.push('MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD');
  if (modules.includes('operations')) required.push('OPERATIONS_INTERNAL_TOKEN');
  if (modules.includes('traccar')) required.push('TRACCAR_ADMIN_PASSWORD', 'TRACCAR_DATABASE_PASSWORD');
  for (const key of required) {
    if (isPlaceholder(envValue(values, key))) errors.push(`${key} esta vazio ou usa CHANGE_ME`);
  }

  const traccarEnabled = envValue(values, 'TRACCAR_ENABLED') === 'true';
  const traccarToken = envValue(values, 'TRACCAR_TOKEN');
  const apiKey = envValue(values, 'AUTHENTICATION_API_KEY');
  if (traccarEnabled && envValue(values, 'TRACCAR_MODE') === 'internal' && traccarToken === apiKey && traccarToken) {
    errors.push('TRACCAR_TOKEN nao pode reutilizar AUTHENTICATION_API_KEY');
  }
  if (modules.includes('traccar') && !/traccar[-:]|traccar\b/i.test(compose)) errors.push('compose nao contem o servico Traccar');
  if (!hasComposeServices(compose)) errors.push('compose.yaml nao contem services');
  if (!hasComposeEnvFile(compose)) errors.push('compose.yaml nao referencia .env');
  if (errors.length) fail(`validacao falhou para ${flavor}:\n- ${errors.join('\n- ')}`);
  return { valid: true, requiredSecrets: required };
}

function hasComposeServices(compose) {
  return compose.split(/\r?\n/).some((line) => line.trim() === 'services:');
}

function hasComposeEnvFile(compose) {
  const lines = compose.split(/\r?\n/);
  return lines.some((line, index) => {
    const value = line.trim();
    if (value === 'env_file: [.env]' || value.startsWith('env_file: [.env,')) return true;
    return value === 'env_file:' && lines[index + 1]?.trim() === '- .env';
  });
}

function plan(result) {
  return {
    flavor: result.flavor,
    channel: result.selected.channel,
    modules: result.modules,
    composeProfiles: result.profiles,
    generatedFiles: ['compose.yaml', '.env'],
    traccarAuthentication: result.modules.includes('traccar') ? (parseEnv(result.env).get('TRACCAR_TOKEN') ? 'token' : 'credentials') : 'disabled',
    generatedSecrets: result.generatedSecrets,
  };
}

function printPlan(result, json) {
  const value = plan(result);
  if (json) return console.log(JSON.stringify(value, null, 2));
  console.log(`Flavor: ${value.flavor}`);
  console.log(`Imagem: ${value.channel}`);
  console.log(`Modulos: ${value.modules.join(', ') || '(somente base)'}`);
  console.log(`Perfis Compose: ${value.composeProfiles || '(nenhum)'}`);
  console.log(`Arquivos: ${value.generatedFiles.join(', ')}`);
  console.log(`Autenticacao Traccar: ${value.traccarAuthentication}`);
  console.log(`Segredos gerados: ${value.generatedSecrets.length ? value.generatedSecrets.join(', ') : '(nenhum; valores importados preservados)'}`);
}

function ensureSafeOutput(directory, force) {
  const compose = path.join(directory, 'compose.yaml');
  const env = path.join(directory, '.env');
  if (!force && (fs.existsSync(compose) || fs.existsSync(env))) {
    fail(`o destino ja possui compose.yaml ou .env: ${directory}. Use --from-env para importar e --force somente se deseja substituir`);
  }
}

function generate(result, options) {
  if (!options.output) fail('generate exige --output <diretorio>');
  const directory = path.resolve(options.output);
  ensureSafeOutput(directory, Boolean(options.force));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'compose.yaml'), result.compose, 'utf8');
  fs.writeFileSync(path.join(directory, '.env'), result.env, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(path.join(directory, '.env'), 0o600); } catch {}
  console.log(`Deploy preparado em ${directory}`);
  console.log('Arquivos gerados: compose.yaml, .env');
}

function validateDirectory(options) {
  if (!options.directory) fail('validate exige --directory <diretorio>');
  const directory = path.resolve(options.directory);
  const compose = readText(path.join(directory, 'compose.yaml'));
  const env = readText(path.join(directory, '.env'));
  const modules = parseModules(parseEnv(env).get('COMPOSE_PROFILES') || '');
  validate({ compose, env, modules, flavor: directory });
  console.log(`OK: ${directory}`);
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.command === 'help') return console.log(usage());
  if (options.command === 'list') {
    console.log(Object.keys(FLAVORS).join('\n'));
    console.log(`modulos: ${MODULE_ORDER.join(', ')}`);
    return;
  }
  if (options.command === 'validate') return validateDirectory(options);
  const result = build(options);
  if (options.command === 'plan') return printPlan(result, options.json);
  if (options.command === 'generate') {
    generate(result, options);
    return printPlan(result, options.json);
  }
  fail(`comando nao implementado: ${options.command}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Erro: ${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = {
  FLAVORS,
  build,
  parseEnv,
  parseModules,
  setEnv,
  hasComposeEnvFile,
  hasComposeServices,
  validate,
};
