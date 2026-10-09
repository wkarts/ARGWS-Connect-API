#!/usr/bin/env node
'use strict';

// This is a real, bounded native recognition check. It does not certify pt-BR
// quality, queue recovery, host capacity, or the production latency SLO.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { readFile, writeFile, readdir } = require('node:fs/promises');
const path = require('node:path');

const binary = process.env.SPEECH_WHISPER_CPP_BINARY || '/usr/local/bin/whisper-server';
const model = process.env.SPEECH_WHISPER_MODEL_FILE;
const expectedHash = process.env.SPEECH_WHISPER_MODEL_SHA256;
const audio = process.env.SPEECH_SMOKE_AUDIO || path.resolve(__dirname, '../native/jfk.wav');
const port = Number(process.env.SPEECH_SMOKE_PORT || 18178);
const threads = Math.max(1, Math.min(2, Number(process.env.SPEECH_INFERENCE_THREADS || 1)));
const timeoutMs = 300000;

async function optionalFile(file) {
  return readFile(file, 'utf8').catch(() => null);
}

async function nativeProcPid(pid) {
  // Some executors expose a host procfs inside a separate PID namespace.
  // Match both the namespace ID and our exact executable/port before sampling.
  const matches = async (candidate) => {
    const command = await optionalFile(`/proc/${candidate}/cmdline`);
    if (!command?.includes(`${binary}\0`) || !command.includes(`\0${port}\0`)) return false;
    const status = await optionalFile(`/proc/${candidate}/status`);
    return status?.match(/^NSpid:\s+(.+)$/m)?.[1]?.trim().split(/\s+/).at(-1) === String(pid);
  };
  if (await matches(pid)) return pid;
  for (const candidate of await readdir('/proc')) {
    if (/^\d+$/.test(candidate) && await matches(candidate)) return Number(candidate);
  }
  return null;
}

async function main() {
  assert.ok(model && expectedHash && /^[a-f0-9]{64}$/.test(expectedHash), 'verified model path/hash are required');
  // This smoke exercises whisper-server, not the optional Transformers/ONNX engine.
  // The legacy image validates its N-API binding at build time; the native-only
  // image intentionally contains no ONNX dependency. All recognition checks below
  // still execute against the actual binary and checksum-verified model.
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(model)) hash.update(chunk);
  assert.equal(hash.digest('hex'), expectedHash, 'model checksum mismatch');

  const start = performance.now();
  let peakNativeRssKiB = 0;
  let peakNativeThreads = 0;
  let logs = '';
  let spawnError;
  const child = spawn(binary, ['--model', model, '--host', '127.0.0.1', '--port', String(port),
    '--threads', String(threads), '--processors', '1', '--no-gpu', '--no-context', '--language', 'en'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', (error) => { spawnError = error; });
  const collectLog = (chunk) => { logs = (logs + String(chunk)).slice(-8000); };
  child.stdout.on('data', collectLog);
  child.stderr.on('data', collectLog);
  const procPid = await nativeProcPid(child.pid);
  const sample = setInterval(async () => {
    if (!procPid) return;
    const status = await optionalFile(`/proc/${procPid}/status`);
    const value = Number(status?.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0);
    peakNativeRssKiB = Math.max(peakNativeRssKiB, value);
    peakNativeThreads = Math.max(peakNativeThreads, Number(status?.match(/^Threads:\s+(\d+)$/m)?.[1] || 0));
  }, 100);
  const hardStop = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  let report;
  try {
    let ready = false;
    const readyDeadline = Date.now() + 90000;
    while (Date.now() < readyDeadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, `native process exited during startup: ${logs}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok && (await response.json()).status === 'ok') { ready = true; break; }
      } catch { /* The native listener starts after the model is loaded. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, `model did not become ready: ${logs}`);
    const coldStartMs = Math.round(performance.now() - start);
    const input = await readFile(audio);
    const runs = [];
    for (let index = 0; index < 2; index += 1) {
      const data = new FormData();
      data.append('file', new Blob([input], { type: 'audio/wav' }), 'jfk.wav');
      data.append('language', 'en');
      data.append('temperature', '0');
      data.append('temperature_inc', '0');
      data.append('response_format', 'verbose_json');
      data.append('no_language_probabilities', 'true');
      const inferenceStart = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/inference`, {
        method: 'POST', body: data, signal: AbortSignal.timeout(120000),
      });
      assert.equal(response.status, 200, `native inference failed: ${logs}`);
      const result = await response.json();
      assert.match(String(result.text), /country/i, 'real JFK speech must be recognized');
      assert.ok(Array.isArray(result.segments) && result.segments.length > 0, 'real segments required');
      assert.ok(result.segments.every((item) => Number.isFinite(item.start) && item.end >= item.start));
      const inferenceMs = Math.round(performance.now() - inferenceStart);
      runs.push({ index: index + 1, inferenceMs, audioSeconds: result.duration,
        rtf: Number((inferenceMs / (Number(result.duration) * 1000)).toFixed(3)),
        text: result.text, segments: result.segments.length });
      assert.equal(child.exitCode, null, 'same loaded process must survive both jobs');
    }
    const memoryMax = (await optionalFile('/sys/fs/cgroup/memory.max'))?.trim();
    const memoryPeak = (await optionalFile('/sys/fs/cgroup/memory.peak'))?.trim();
    if (process.env.SPEECH_SMOKE_EXPECT_CGROUP_BYTES) {
      assert.equal(memoryMax, process.env.SPEECH_SMOKE_EXPECT_CGROUP_BYTES, 'whole-pool memory limit missing');
      assert.ok(Number(memoryPeak) < Number(memoryMax), 'pool exceeded configured cgroup memory');
    }
    if (peakNativeThreads) assert.ok(peakNativeThreads <= threads + 4, 'native HTTP pool created excessive threads');
    report = { nativeRecognition: true, architecture: process.arch, modelSha256: expectedHash,
      sameProcessReused: true, pid: child.pid, procPid, threads,
      peakNativeThreads: peakNativeThreads || null, coldStartMs, peakNativeRssKiB: peakNativeRssKiB || null, runs,
      coldStartDefinition: 'Time to native /health after model load; validated recognition follows the first inference.',
      cgroup: { poolLimitEnforced: Boolean(process.env.SPEECH_SMOKE_EXPECT_CGROUP_BYTES),
        memoryMax, memoryPeak, cpuStat: await optionalFile('/sys/fs/cgroup/cpu.stat') },
      limits: 'Recognition smoke only; pt-BR corpus, full queue integration and VPS soak still required.' };
  } finally {
    clearInterval(sample);
    clearTimeout(hardStop);
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) {
      const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
      await new Promise((resolve) => child.once('exit', resolve));
      clearTimeout(kill);
    }
  }
  if (process.env.SPEECH_SMOKE_REPORT) await writeFile(process.env.SPEECH_SMOKE_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
