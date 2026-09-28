'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function load(relative, overrides = {}, globals = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative).exports;
  const module = { exports: {} };
  cache.set(relative, module);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    fileName: relative,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      Buffer,
      Date,
      console,
      process: { env: {} },
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name === 'crypto') return require('node:crypto');
        throw new Error('Unexpected dependency ' + name);
      },
      ...globals,
    },
    { filename: relative },
  );
  return module.exports;
}

const { FindHubFlowBuffer } = load('src/api/integrations/channel/findhub/services/findhub-flow.service.ts');

function input(sequence) {
  return {
    kind: 'mcs.frame',
    instanceId: 'instance-a',
    instanceName: 'account-a',
    data: { sequence },
  };
}

test('protocol flow ring buffer stays bounded and reports dropped events', () => {
  const buffer = new FindHubFlowBuffer(32);
  for (let sequence = 1; sequence <= 33; sequence++) buffer.publish(input(sequence));

  const snapshot = buffer.snapshot();
  assert.equal(snapshot.bufferLimit, 32);
  assert.equal(snapshot.bufferSize, 32);
  assert.equal(snapshot.dropped, 1);
  assert.equal(snapshot.sequence, 33);
  assert.equal(snapshot.events[0].sequence, 2);
  assert.equal(snapshot.events.at(-1).data.sequence, 33);
  assert.notEqual(snapshot.events[0].eventId, snapshot.events[1].eventId);
});

test('flow listeners are isolated and unsubscribe idempotently', () => {
  const buffer = new FindHubFlowBuffer(32);
  let healthy = 0;
  const stopBroken = buffer.subscribe(() => {
    throw new Error('monitor fixture failure');
  });
  const stopHealthy = buffer.subscribe(() => healthy++);

  buffer.publish(input(1));
  assert.equal(healthy, 1);
  stopBroken();
  stopBroken();
  stopHealthy();
  stopHealthy();
  buffer.publish(input(2));
  assert.equal(healthy, 1);
});

test('flow snapshots do not expose a mutable reference to stored event data', () => {
  const buffer = new FindHubFlowBuffer(32);
  buffer.publish({ ...input(1), data: { status: 'safe' } });
  const snapshot = buffer.snapshot();
  snapshot.events[0].data.status = 'mutated-locally';
  assert.equal(buffer.snapshot().events[0].data.status, 'safe');
});
