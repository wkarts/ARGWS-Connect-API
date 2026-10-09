'use strict';
// Only disposable CI resources. No discovery, exec, stop or deletion of live stacks.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { promisify } = require('node:util');
const amqp = require('amqplib');
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const id = `rabbit-probe-ci-${process.env.GITHUB_RUN_ID}-${process.arch}`;
const folder = path.join(process.env.RUNNER_TEMP || '', id);
const composePath = path.join(folder, 'compose.json');
const report = { schema: 1, sourceSha: process.env.GITHUB_SHA, checks: [], benchmarks: [] };
const connections = new Set();
let webhook;
let owned = false;
let image;
let probe;
const password = randomBytes(24).toString('hex');
const docker = async (...args) => (await exec('docker', args, { timeout: 350000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const compose = (...args) => docker('compose', '-p', id, '-f', composePath, ...args);

async function bounded(promise, label, ms = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function connect() {
  const c = await amqp.connect({ protocol: 'amqp', hostname: '127.0.0.1', port: 15673, username: 'probe', password, vhost: '/', heartbeat: 5 }, { timeout: 5000 });
  connections.add(c); c.on('error', () => {}); c.once('close', () => connections.delete(c)); return c;
}
async function close(c) { try { await bounded(c.close(), 'AMQP close', 5000); } finally { c.connection.stream.destroy(); connections.delete(c); } }
const inspect = async () => JSON.parse(await docker('inspect', id))[0];
async function ready() {
  const start = Date.now();
  while (Date.now() - start < 300000) {
    const c = await inspect();
    assert.equal(c.State.Running, true); assert.equal(c.State.OOMKilled, false);
    if (c.State.Health?.Status === 'healthy') { const a = await connect(); report.rabbitmqVersion = a.connection.serverProperties.version; await close(a); return Date.now() - start; }
    await sleep(1000);
  }
  throw new Error('AMQP readiness timed out');
}
async function sample() {
  const raw = await docker('exec', id, 'sh', '-ec',
    'if [ -r /sys/fs/cgroup/memory.current ]; then cat /sys/fs/cgroup/memory.current; cat /sys/fs/cgroup/memory.peak; while read k v; do [ "$k" != usage_usec ] || echo "$v"; done < /sys/fs/cgroup/cpu.stat; else cat /sys/fs/cgroup/memory/memory.usage_in_bytes; cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes; n=$(cat /sys/fs/cgroup/cpuacct/cpuacct.usage); echo "$((n/1000))"; fi');
  const [memoryBytes, cumulativePeakBytes, cpuMicros] = raw.split(/\s+/).map(Number);
  assert.ok([memoryBytes, cumulativePeakBytes, cpuMicros].every(Number.isFinite));
  return { memoryBytes, cumulativePeakBytes, cpuMicros };
}
async function prepare() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  assert.match(id, /^rabbit-probe-ci-[0-9]+-(x64|arm64)$/);
  image = process.env.RABBITMQ_TEST_IMAGE;
  assert.match(image || '', /^ghcr\.io\/[a-z0-9_.-]+\/argws-connect-rabbitmq@sha256:[a-f0-9]{64}$/);
  const metadata = JSON.parse(await docker('image', 'inspect', image))[0];
  report.image = { digest: image, id: metadata.Id, architecture: metadata.Architecture, os: metadata.Os };
  report.capabilities = await docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--entrypoint', 'sh', image, '-ec', 'command -v bash; command -v timeout; timeout 2 bash -ec "exit 0"');
  const full = JSON.parse(await fs.readFile(process.env.RABBITMQ_RENDERED_CONFIG, 'utf8'));
  const deployed = full.services['rabbitmq-argws-connect-production'];
  assert.ok(deployed);
  probe = deployed.healthcheck.test.slice(1);
  assert.deepEqual(probe, ['timeout', '2', 'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/5672']);
  report.healthcheck = deployed.healthcheck;
  // Only the fixture identity, credentials, ports and data are private to this test.
  // Main has no cgroup budget; CI caps its fixture without changing the deployment.
  const environment = Object.fromEntries(Object.entries(deployed.environment || {}).filter(([key]) => ['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS', 'RABBITMQ_CTL_ERL_ARGS'].includes(key)));
  const broker = { image, pull_policy: 'never', container_name: id, hostname: id, restart: 'no',
    environment: { ...environment, RABBITMQ_DEFAULT_USER: 'probe', RABBITMQ_DEFAULT_PASS: password, RABBITMQ_DEFAULT_VHOST: '/' },
    healthcheck: deployed.healthcheck, volumes: [`${id}-data:/var/lib/rabbitmq`], ports: ['127.0.0.1:15673:5672'],
    cpus: deployed.cpus || 2, mem_limit: deployed.mem_limit || '2g', memswap_limit: deployed.memswap_limit || '2g', pids_limit: deployed.pids_limit || 256 };
  await fs.mkdir(folder, { recursive: true });
  const dependent = { image, pull_policy: 'never', container_name: `${id}-gate`, restart: 'no',
    depends_on: { broker: { condition: 'service_healthy' } }, entrypoint: ['sh', '-ec', 'exit 0'] };
  await fs.writeFile(composePath, JSON.stringify({ services: { broker, dependent }, volumes: { [`${id}-data`]: { name: `${id}-data` } } }));
  owned = true;
  const t = Date.now(); await compose('up', '-d', '--pull', 'never', 'dependent'); report.composeGateMs = Date.now() - t;
  report.readyAfterGateMs = await ready();
  const c = await inspect(); const gate = JSON.parse(await docker('inspect', `${id}-gate`))[0];
  const successes = c.State.Health.Log.filter(e => e.ExitCode === 0);
  assert.ok(successes.length); assert.ok(Date.parse(gate.State.StartedAt) >= Date.parse(successes[0].Start));
  assert.equal(c.Image, metadata.Id);
  report.checks.push('actual image verified; no nc; production probe gates dependent startup; authenticated AMQP succeeds');
}
function quantile(values, p) { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.min(sorted.length-1, Math.floor(sorted.length*p))]; }
async function traffic(label, command) {
  const count = 120, rounds = 6, latencies = [], durations = [], seen = new Set(), webhooks = new Set();
  const c = await connect(); const ch = await c.createConfirmChannel(); ch.on('error', () => {});
  const exchange = `${id}.${label}`; const queue = `${exchange}.events-jobs`;
  await ch.assertExchange(exchange, 'direct', { durable: true });
  await ch.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(queue, exchange, 'event'); await ch.bindQueue(queue, exchange, 'audio-job');
  webhook = http.createServer((req, res) => {
    const key = req.headers['x-test-event']; if (webhooks.has(key)) { res.writeHead(409); res.end(); return; }
    webhooks.add(key); req.resume(); res.writeHead(204); res.end();
  });
  await new Promise(resolve => webhook.listen(0, '127.0.0.1', resolve));
  let failure; let acked = 0;
  const started = new Map();
  await ch.prefetch(8);
  const consumer = await ch.consume(queue, async msg => {
    if (!msg) return;
    try {
      const value = JSON.parse(msg.content.toString()); assert.ok(!seen.has(value.id), 'Duplicate normal delivery'); seen.add(value.id);
      if (value.kind === 'event') {
        await new Promise((resolve, reject) => {
          const req = http.request({ hostname: '127.0.0.1', port: webhook.address().port, method: 'POST', path: '/', headers: { 'X-Test-Event': value.id }, timeout: 3000 }, res => { res.resume(); res.statusCode === 204 ? resolve() : reject(new Error('Duplicate webhook')); });
          req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Webhook timeout'))); req.end();
        });
      } else { assert.equal(value.kind, 'audio-job'); await new Promise(resolve => setImmediate(resolve)); }
      latencies.push(performance.now() - started.get(value.id)); ch.ack(msg); acked++;
    } catch (error) { failure ||= error; ch.nack(msg, false, false); }
  });
  const before = await sample();
  for (let r = 0; r < rounds; r++) {
    const t = performance.now(); const checking = docker('exec', id, ...command).then(() => durations.push(performance.now() - t));
    for (let i = 0; i < count / rounds; i++) {
      const key = `${label}-${r}-${i}`, kind = i % 2 ? 'event' : 'audio-job'; started.set(key, performance.now());
      ch.publish(exchange, kind, Buffer.from(JSON.stringify({ id: key, kind })), { persistent: true, messageId: key, contentType: 'application/json' });
    }
    await bounded(ch.waitForConfirms(), 'publisher confirms'); await checking;
  }
  const deadline = Date.now() + 20000;
  while (acked < count && !failure && Date.now() < deadline) await sleep(20);
  if (failure) throw failure;
  assert.equal(acked, count); assert.equal(seen.size, count); assert.equal(webhooks.size, count / 2);
  const after = await sample(); await ch.cancel(consumer.consumerTag);
  assert.equal((await ch.checkQueue(queue)).messageCount, 0); assert.equal(await ch.get(queue), false);
  await ch.deleteQueue(queue); await ch.deleteExchange(exchange); await ch.close(); await close(c);
  await new Promise(resolve => webhook.close(resolve)); webhook = null;
  report.benchmarks.push({ label, probeSamples: durations, probeMedianMs: quantile(durations,.5), eventJobLatencyP95Ms: quantile(latencies,.95), published: count, confirmed: count, acked, webhookCount: webhooks.size, duplicateNormalDeliveries: 0, before, after,
    note: 'CI fixture, includes docker exec/sampling overhead; six probes for comparison, not the production polling frequency; cumulative memory peak is not an isolated per-probe peak.' });
}
async function persistence() {
  const q = `${id}.retained`, c = await connect(), p = await c.createConfirmChannel(); p.on('error', () => {});
  await p.assertQueue(q, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  for (let i=0;i<100;i++) p.sendToQueue(q, Buffer.from(String(i)), { persistent:true, messageId:String(i) });
  await p.waitForConfirms(); await p.close(); await close(c);
  const original = await inspect();
  await docker('exec', id, 'rabbitmqctl', '-q', 'stop_app');
  await docker('exec', id, 'timeout', '10', 'rabbitmq-diagnostics', '-q', 'ping');
  let rejected = false; try { await docker('exec', id, ...probe); } catch (e) { rejected = Number.isInteger(e.code) && e.code > 0; }
  assert.equal(rejected, true, 'TCP must fail while Erlang is alive but AMQP stopped');
  await docker('stop', '--time', '30', id); await docker('rm', id);
  await compose('up', '-d', '--no-deps', '--pull', 'never', 'broker'); report.recreatedReadyMs = await ready();
  const recreated = await inspect(); assert.equal(recreated.Image, original.Image); assert.equal(recreated.Config.Hostname, original.Config.Hostname);
  assert.equal(recreated.Mounts.find(m=>m.Destination==='/var/lib/rabbitmq').Source, original.Mounts.find(m=>m.Destination==='/var/lib/rabbitmq').Source);
  const a = await connect(), reader = await a.createChannel(); reader.on('error',()=>{}); const ids = new Set();
  for (let i=0;i<100;i++) { const msg = await reader.get(q,{noAck:false}); assert.ok(msg); assert.equal(msg.content.toString(),String(i)); assert.ok(!ids.has(msg.properties.messageId)); ids.add(msg.properties.messageId); reader.ack(msg); }
  assert.equal(await reader.get(q),false); await reader.deleteQueue(q); await reader.close(); await close(a);
  report.checks.push('TCP fails when AMQP is stopped although CLI ping passes; 100 confirmed messages survive recreation with same identity/digest/volume and are ACKed once');
}
(async () => {
  try { await prepare(); await traffic('tcp', probe); await traffic('cli-reference', ['timeout','10','rabbitmq-diagnostics','-q','ping']); await persistence(); report.success=true; }
  catch (error) { report.success=false; report.error={ name:error.name, code:error.code || 'TEST_FAILED' }; console.error(error.message.replaceAll(password,'[redacted]')); process.exitCode=1; }
  finally {
    for (const c of connections) c.connection.stream.destroy(); if (webhook) webhook.closeAllConnections(); if (webhook) webhook.close();
    if (owned) { try { await compose('down','--volumes'); } catch { process.exitCode=1; report.cleanupFailed=true; } }
    await fs.mkdir(folder,{recursive:true}); await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
  }
})();
