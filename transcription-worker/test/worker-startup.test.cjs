'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

const fixture = path.join(__dirname, 'fixtures/reconnecting-worker.cjs');

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', fail);
      resolve(server.address().port);
    });
  });
}

function observe(child) {
  const events = new EventEmitter();
  const records = [];
  let pending = '';
  let output = '';
  let result;
  child.stdout.on('data', (chunk) => {
    pending += chunk.toString();
    output += chunk.toString();
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try { const record = JSON.parse(line); records.push(record); events.emit('record', record); }
      catch { /* The worker also emits ordinary diagnostic lines. */ }
    }
  });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => { result = { code, signal }; resolve(result); events.emit('exit'); });
  });
  const waitFor = (predicate) => {
    const previous = records.find(predicate);
    if (previous) return Promise.resolve(previous);
    if (result) return Promise.reject(new Error(`Worker exited before recovery: ${JSON.stringify(result)}\n${output}`));
    return new Promise((resolve, reject) => {
      const done = (error, value) => {
        clearTimeout(timer); events.removeListener('record', onRecord); events.removeListener('exit', onExit);
        error ? reject(error) : resolve(value);
      };
      const onRecord = (record) => { if (predicate(record)) done(null, record); };
      const onExit = () => done(new Error(`Worker exited before recovery: ${JSON.stringify(result)}\n${output}`));
      const timer = setTimeout(() => done(new Error('Worker recovery timed out:\n' + output)), 10000);
      events.on('record', onRecord); events.once('exit', onExit);
    });
  };
  return { waitFor, exited };
}

test('subprocesso sobrevive a ECONNREFUSED, reconecta após perder todos os sockets e encerra por SIGTERM', { timeout: 30000 }, async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [fixture, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const watched = observe(child);
  try {
    const first = await watched.waitFor((record) => record.event === 'connection-failed');
    assert.equal(first.code, 'ECONNREFUSED'); assert.equal(first.attempt, 1);
    await listen(server, port);
    await watched.waitFor((record) => record.event === 'ready' && record.attempt === 2);
    assert.equal(sockets.size, 1);
    for (const socket of sockets) socket.destroy();
    await watched.waitFor((record) => record.event === 'connection-closed' && record.attempt === 2);
    await watched.waitFor((record) => record.event === 'ready' && record.attempt === 3);
    child.kill('SIGTERM');
    await watched.waitFor((record) => record.event === 'stopped');
    assert.deepEqual(await watched.exited, { code: 0, signal: null });
  } finally {
    child.kill('SIGKILL');
    await watched.exited;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SIGTERM cancela a reconexão pendente sem esperar o broker nem deixar o processo vivo', { timeout: 10000 }, async () => {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [fixture, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const watched = observe(child);
  try {
    await watched.waitFor((record) => record.event === 'connection-failed');
    child.kill('SIGTERM');
    await watched.waitFor((record) => record.event === 'stopped');
    assert.deepEqual(await watched.exited, { code: 0, signal: null });
  } finally { child.kill('SIGKILL'); await watched.exited; }
});
