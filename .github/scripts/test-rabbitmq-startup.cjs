'use strict';

// This integration fixture is restricted to disposable GitHub Actions resources.
// It never discovers, modifies or deletes containers from an installed stack.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const amqp = require('amqplib');

const execute = promisify(execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const identifier = `speech-rabbit-ci-${process.env.DATABASE_PROVIDER}-${process.env.GITHUB_RUN_ID}`;
const directory = path.join(process.env.RUNNER_TEMP || '', identifier);
const composeFile = path.join(directory, 'compose.json');
const reportFile = path.join(directory, 'report.json');
const report = { checks: [], samples: [] };
let preservedComposeFile;
const brokerUri = 'amqp://speech:speech_test_password@127.0.0.1:5673/';
const connections = new Set();
const docker = async (...args) => (await execute('docker', args, {
  timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
const compose = (...args) => docker('compose', '-p', identifier, '-f', composeFile,
  ...(preservedComposeFile ? ['-f', preservedComposeFile] : []), ...args);

async function bounded(operation, label, milliseconds = 20_000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function connectAmqp() {
  const connection = await amqp.connect(brokerUri, { timeout: 5000 });
  connections.add(connection);
  connection.on('error', () => {});
  connection.once('close', () => connections.delete(connection));
  return connection;
}

async function closeAmqp(connection) {
  try { await bounded(connection.close(), 'close AMQP connection', 5000); }
  finally { connection.connection.stream.destroy(); connections.delete(connection); }
}

function requireDisposableRunner() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run this fixture only in GitHub Actions.');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'RUNNER_TEMP must be absolute.');
  assert.match(identifier, /^speech-rabbit-ci-(postgresql|mysql)-[0-9]+$/);
}

async function inspect() {
  return JSON.parse(await docker('inspect', identifier))[0];
}

async function waitUntilReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 300_000) {
    const container = await inspect();
    assert.equal(container.State.OOMKilled, false, 'RabbitMQ was OOM-killed.');
    assert.equal(container.State.Running, true, 'RabbitMQ exited before AMQP was ready.');
    if (container.State.Health?.Status === 'healthy') {
      const connection = await connectAmqp();
      report.rabbitmqVersion = connection.connection.serverProperties.version;
      await closeAmqp(connection);
      return Date.now() - startedAt;
    }
    await sleep(2000);
  }
  throw new Error('RabbitMQ did not open an authenticated AMQP connection within 300 seconds.');
}

async function sample(phase) {
  const container = await inspect();
  const memory = await docker('exec', identifier, 'sh', '-c',
    'if [ -r /sys/fs/cgroup/memory.current ]; then cat /sys/fs/cgroup/memory.current; ' +
    'cat /sys/fs/cgroup/memory.peak 2>/dev/null || true; ' +
    'else cat /sys/fs/cgroup/memory/memory.usage_in_bytes; ' +
    'cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes; fi');
  const [currentBytes, peakBytes] = memory.split(/\s+/).map(Number);
  assert.ok(currentBytes > 0 && currentBytes < container.HostConfig.Memory);
  report.samples.push({ phase, currentBytes, peakBytes: peakBytes || null });
}

async function prepare() {
  const image = process.env.SPEECH_TEST_RABBITMQ_IMAGE || '';
  assert.match(image, /^ghcr\.io\/[a-z0-9_.-]+\/argws-connect-rabbitmq@sha256:[a-f0-9]{64}$/);
  const full = JSON.parse(await docker('compose', '-f', 'deploy/develop/compose.yaml', 'config', '--format', 'json'));
  const deployed = full.services['rabbitmq-argws-connect-develop'];
  assert.ok(deployed, 'The fixture must use the real develop RabbitMQ service.');
  const environment = Object.fromEntries(Object.entries(deployed.environment || {}).filter(([key]) =>
    ['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS', 'RABBITMQ_CTL_ERL_ARGS'].includes(key)));
  const service = {
    image, pull_policy: 'never', container_name: identifier, hostname: identifier,
    restart: 'no',
    environment: { ...environment, RABBITMQ_DEFAULT_USER: 'speech',
      RABBITMQ_DEFAULT_PASS: 'speech_test_password', RABBITMQ_DEFAULT_VHOST: '/' },
    mem_limit: deployed.mem_limit, memswap_limit: deployed.memswap_limit,
    cpus: deployed.cpus, pids_limit: deployed.pids_limit, healthcheck: deployed.healthcheck,
    volumes: [`${identifier}-data:/var/lib/rabbitmq`],
    ports: ['127.0.0.1:5673:5672'],
  };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(composeFile, JSON.stringify({ services: { rabbitmq: service },
    volumes: { [`${identifier}-data`]: { name: `${identifier}-data` } } }, null, 2));
  report.image = image;
  await compose('up', '--detach', '--no-deps', '--pull', 'never', 'rabbitmq');
  report.initialReadyMs = await waitUntilReady();
  const container = await inspect();
  assert.equal(container.HostConfig.Memory, 2 * 1024 ** 3);
  assert.equal(container.HostConfig.MemorySwap, container.HostConfig.Memory);
  assert.equal(container.HostConfig.NanoCpus, 2 * 10 ** 9);
  assert.equal(container.HostConfig.PidsLimit, 256);
  assert.equal(container.Config.Healthcheck.Test[0], 'CMD');
  assert.ok(container.Config.Healthcheck.Test.includes('bash'));
  assert.ok(!container.Config.Healthcheck.Test.join(' ').includes('rabbitmq-diagnostics'));
  const runtime = await docker('exec', identifier, 'rabbitmqctl', '-q', 'eval',
    '{erlang:system_info(schedulers_online),erlang:system_info(dirty_cpu_schedulers_online),' +
    'erlang:system_info(dirty_io_schedulers),application:get_env(rabbit,vm_memory_high_watermark)}.');
  assert.match(runtime.replace(/\s/g, ''), /\{2,1,1,\{ok,\{absolute,1073741824\}\}\}/);
  report.limits = { memoryBytes: container.HostConfig.Memory, memorySwapBytes: container.HostConfig.MemorySwap,
    nanoCpus: container.HostConfig.NanoCpus, pids: container.HostConfig.PidsLimit, runtime };
  report.checks.push('real deployment probe, cgroup limits and Erlang settings');
  await sample('ready');
}

async function exercisePersistence() {
  const queue = `${identifier}.durable`;
  const expected = Array.from({ length: 100 }, (_, index) => JSON.stringify({ index, payload: 'x'.repeat(1024) }));
  const connection = await connectAmqp();
  const channel = await bounded(connection.createConfirmChannel(), 'create confirm channel');
  channel.on('error', () => {});
  await bounded(channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } }), 'declare quorum queue');
  for (const content of expected) channel.sendToQueue(queue, Buffer.from(content), { persistent: true });
  await bounded(channel.waitForConfirms(), 'confirm persistent publications');
  await bounded(channel.close(), 'close publisher channel');
  await closeAmqp(connection);
  await sample('confirmed_backlog');

  // Demonstrate the previous false-positive: the Erlang runtime still responds
  // while the AMQP application is stopped. The new TCP probe must fail.
  const before = await inspect();
  await docker('exec', identifier, 'rabbitmqctl', '-q', 'stop_app');
  await docker('exec', identifier, 'rabbitmq-diagnostics', '-q', 'ping');
  let probeFailed = false;
  try { await docker('exec', identifier, ...before.Config.Healthcheck.Test.slice(1)); }
  catch (error) { probeFailed = Number.isInteger(error.code) && error.code > 0; }
  assert.equal(probeFailed, true, 'The AMQP readiness probe passed while the application was stopped.');
  report.checks.push('AMQP probe fails with Erlang alive and RabbitMQ application stopped');

  // Recreate only this disposable container, deliberately retaining its exact
  // hostname, image digest and volume. Never test a downgrade or rename.
  await docker('stop', '--time', '30', identifier);
  await docker('rm', identifier);
  await compose('up', '--detach', '--no-deps', '--pull', 'never', 'rabbitmq');
  report.recreatedReadyMs = await waitUntilReady();
  const after = await inspect();
  assert.equal(after.Config.Hostname, before.Config.Hostname);
  assert.equal(after.Image, before.Image);
  assert.equal(after.Mounts.find((mount) => mount.Destination === '/var/lib/rabbitmq').Source,
    before.Mounts.find((mount) => mount.Destination === '/var/lib/rabbitmq').Source);
  const recovered = await connectAmqp();
  const reader = await bounded(recovered.createChannel(), 'create recovered channel');
  reader.on('error', () => {});
  for (const content of expected) {
    const message = await bounded(reader.get(queue, { noAck: false }), 'read recovered message');
    assert.ok(message, 'A confirmed persistent message disappeared after recreation.');
    assert.equal(message.content.toString(), content);
    reader.ack(message);
  }
  assert.equal(await bounded(reader.get(queue, { noAck: false }), 'check drained queue'), false);
  await bounded(reader.deleteQueue(queue), 'delete fixture queue');
  await bounded(reader.close(), 'close reader channel');
  await closeAmqp(recovered);
  report.checks.push('100 confirmed quorum messages preserved across container recreation');
  await sample('recreated_and_drained');
}

async function validateDiagnosis() {
  const outputDirectory = path.join(directory, 'diagnosis');
  try {
    await execute('python3', ['scripts/connect-startup-diagnose.py', '--project', identifier,
      '--prepare-rabbitmq-override', '--output-dir', outputDirectory, '--max-seconds', '45'], {
      timeout: 55_000, maxBuffer: 256 * 1024,
    });
  } catch (error) {
    // An unprivileged runner may not read the daemon's volume directory. All
    // other projections and the generated preservation override are mandatory.
    if (error.code !== 2) throw error;
  }
  const diagnosis = JSON.parse(await fs.readFile(path.join(outputDirectory, 'diagnostico.json'), 'utf8'));
  assert.deepEqual(diagnosis.actions, []);
  assert.equal(diagnosis.before.containers.length, 1);
  assert.ok(diagnosis.issues.every((issue) => issue.operation === 'mnesia_names'));
  const observed = diagnosis.before.containers[0];
  const container = await inspect();
  assert.equal(observed.id, container.Id);
  assert.equal(observed.health.status, 'healthy');
  assert.equal(observed.quotas.Memory, container.HostConfig.Memory);
  assert.equal(observed.image_id, container.Image);
  assert.equal(diagnosis.rabbitmq_override.ok, true);
  assert.equal(diagnosis.rabbitmq_override.filename, 'compose.rabbitmq-preserve.json');
  const override = diagnosis.rabbitmq_override.compose.services.rabbitmq;
  assert.equal(override.hostname, container.Config.Hostname);
  assert.equal(override.image, container.Image);
  assert.equal(override.pull_policy, 'never');
  preservedComposeFile = path.join(outputDirectory, diagnosis.rabbitmq_override.filename);
  report.checks.push('real Docker diagnostic projection and identity-preserving override');
}

async function main() {
  requireDisposableRunner();
  if (process.argv[2] === '--cleanup') {
    // A fixed, CI-only project and generated volume; installed stack resources
    // and all Docker resources outside this fixture remain untouched.
    if (await fs.access(composeFile).then(() => true, () => false)) await compose('down', '--volumes');
    return;
  }
  try {
    await prepare();
    await validateDiagnosis();
    await exercisePersistence();
    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error.message;
    try { await fs.writeFile(path.join(directory, 'rabbitmq.log'), await docker('logs', '--tail', '250', identifier)); }
    catch { /* Preserve the original integration failure. */ }
    throw error;
  } finally {
    for (const connection of connections) connection.connection.stream.destroy();
    connections.clear();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
