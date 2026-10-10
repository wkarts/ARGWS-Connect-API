const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const aws = require('@aws-sdk/client-sqs');

const root = path.resolve(__dirname, '..');
const drain = () => new Promise((resolve) => setImmediate(resolve));

function load(file, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    Buffer,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return module.exports;
}

function harness({ enabled = true, region = '' } = {}) {
  const errors = [], system = [], constructors = [], initialized = [], emitted = [];
  const configuration = {
    SQS: {
      ENABLED: enabled, REGION: region, ACCESS_KEY_ID: 'fixture-access-key', SECRET_ACCESS_KEY: 'fixture-secret-key',
      ACCOUNT_ID: '000000000000', GLOBAL_ENABLED: false, GLOBAL_PREFIX_NAME: 'fixture',
      GLOBAL_FORCE_SINGLE_QUEUE: false, MAX_PAYLOAD_SIZE: 262144, EVENTS: { MESSAGES_UPSERT: true },
    },
    SERVER: { NAME: 'fixture' },
    LOG: { LEVEL: [] },
  };
  class Logger {
    constructor(component) { this.component = component; }
    error(error) { errors.push({ component: this.component, error }); }
    system(message) { system.push({ component: this.component, message }); }
    info() {}
    warn() {}
    log() {}
  }
  const eventController = load('src/api/integrations/event/event.controller.ts', {});
  const sqs = load('src/api/integrations/event/sqs/sqs.controller.ts', {
    '../event.controller': eventController,
    '@api/integrations/storage/s3/libs/minio.server': {},
    '@config/env.config': { configService: { get: (key) => configuration[key] } },
    '@config/logger.config': { Logger },
    '@aws-sdk/client-sqs': {
      ...aws,
      SQS: new Proxy(aws.SQS, {
        construct(target, args, newTarget) {
          constructors.push(args[0]);
          return Reflect.construct(target, args, newTarget);
        },
      }),
    },
  });
  const dependencies = {
    '@config/logger.config': { Logger },
    '@api/integrations/event/sqs/sqs.controller': sqs,
  };
  for (const [folder, name] of [
    ['websocket', 'WebsocketController'], ['webhook', 'WebhookController'], ['rabbitmq', 'RabbitmqController'],
    ['nats', 'NatsController'], ['pusher', 'PusherController'], ['kafka', 'KafkaController'],
  ]) dependencies[`@api/integrations/event/${folder}/${folder}.controller`] = {
    [name]: class {
      init() { initialized.push(folder); return Promise.resolve(); }
      async emit() { emitted.push(folder); }
    },
  };
  const { EventManager } = load('src/api/integrations/event/event.manager.ts', dependencies);
  return { manager: new EventManager({}, { waInstances: {} }), errors, system, constructors, initialized, emitted, configuration };
}

async function startupFixture(enabled) {
  const unhandled = [];
  process.on('unhandledRejection', (error) => unhandled.push(error.message));
  const h = harness({ enabled });
  const server = http.createServer((_req, res) => res.end('ready'));
  try {
    h.manager.init(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { headers: { connection: 'close' } });
    const body = await response.text();
    await drain();
    return {
      status: response.status, body, unhandled, initialized: h.initialized,
      constructorCount: h.constructors.length, channelReady: Boolean(h.manager.sqs.channel),
      errors: h.errors.map(({ component, error }) => ({ component, name: error.name, message: error.message, stack: error.stack })),
      system: h.system,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    h.manager.sqs.channel?.destroy();
  }
}

if (process.argv[2] === '--startup-fixture') {
  startupFixture(process.argv[3] !== 'disabled')
    .then((result) => process.stdout.write(JSON.stringify(result)))
    .catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  test('missing SQS region is reported without an unhandled rejection or blocking HTTP startup', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [__filename, '--startup-fixture', 'enabled'], { timeout: 15000 });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 200);
    assert.equal(result.body, 'ready');
    assert.equal(result.constructorCount, 1);
    assert.equal(result.channelReady, false);
    assert.deepEqual(result.unhandled, []);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].component, 'SqsController');
    assert.equal(result.errors[0].message, 'Region is missing');
    assert.match(result.errors[0].stack, /resolveRegionConfig/);
    assert.match(result.errors[0].stack, /new SQS/);
    assert.match(result.system[0].message, /SQS indisponível.*inicialização/);
    assert.equal(JSON.stringify(result).includes('fixture-secret-key'), false);
    assert.ok(result.initialized.includes('kafka'));
    assert.ok(result.initialized.includes('pusher'));
  });

  test('disabled SQS never constructs an AWS client even with an empty region', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [__filename, '--startup-fixture', 'disabled'], { timeout: 15000 });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 200);
    assert.equal(result.constructorCount, 0);
    assert.equal(result.channelReady, false);
    assert.deepEqual(result.unhandled, []);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.system, []);
  });

  test('valid SQS configuration keeps the existing FIFO dispatch through the real SDK', async () => {
    const h = harness({ region: 'us-east-1' });
    h.manager.init(http.createServer());
    await drain();
    const client = h.manager.sqs.channel;
    assert.ok(client instanceof aws.SQS);
    assert.equal(h.constructors[0].region, 'us-east-1');
    assert.equal(h.constructors[0].credentials.accessKeyId, 'fixture-access-key');
    assert.equal(h.constructors[0].credentials.secretAccessKey, 'fixture-secret-key');
    const captured = [];
    let received;
    const request = new Promise((resolve) => { received = resolve; });
    client.config.requestHandler = {
      async handle(input) {
        const body = JSON.parse(input.body);
        captured.push(body);
        received();
        return { response: {
          statusCode: 200, headers: { 'content-type': 'application/x-amz-json-1.0' },
          body: Buffer.from(JSON.stringify({ MessageId: 'fixture-message', MD5OfMessageBody: require('node:crypto').createHash('md5').update(body.MessageBody).digest('hex') })),
        } };
      },
      destroy() {},
    };
    h.configuration.SQS.GLOBAL_ENABLED = true;
    const event = {
      instanceName: 'fixture-instance', origin: 'fixture', event: 'messages.upsert',
      data: { fixture: true }, serverUrl: 'https://fixture.invalid', dateTime: '2026-10-08T00:00:00.000Z', sender: 'fixture',
    };
    try {
      await h.manager.emit(event);
      await request;
      await drain();
      assert.equal(captured.length, 1);
      assert.equal(captured[0].QueueUrl, 'https://sqs.us-east-1.amazonaws.com/000000000000/fixture_messages_upsert.fifo');
      assert.equal(captured[0].MessageGroupId, 'fixture-messages_upsert-fixture-instance');
      assert.deepEqual(JSON.parse(captured[0].MessageBody), {
        event: event.event, instance: event.instanceName, dataType: 'json', data: event.data, server: 'fixture',
        server_url: event.serverUrl, date_time: event.dateTime, sender: event.sender,
      });
      assert.equal(h.errors.length, 0);
      assert.equal(h.system.length, 0);
      assert.deepEqual(h.emitted, ['websocket', 'rabbitmq', 'nats', 'webhook', 'pusher', 'kafka']);
    } finally { client.destroy(); }
  });
}
