'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { REPORT_LIMIT, LOG_LIMIT, SUMMARY_LIMIT } = require('../.github/scripts/preserve-speech-evidence.cjs');

const root = path.resolve(__dirname, '..');
const script = path.join(root, '.github/scripts/preserve-speech-evidence.cjs');
const digest = 'a'.repeat(64);

function nativeReport(architecture = 'x64') {
  return { nativeRecognition: true, sameProcessReused: true, architecture,
    modelSha256: digest, coldStartMs: 1800, threads: 1, peakNativeThreads: 5, peakNativeRssKiB: 208000,
    cgroup: { poolLimitEnforced: true, memoryMax: '1342177280', memoryPeak: '450000000', cpuStat: 'usage_usec 1200' },
    runs: [1, 2].map((index) => ({ index, inferenceMs: 1200, audioSeconds: 11, rtf: 0.109,
      text: 'Ask what you can do for your country.', segments: 2 })),
    limits: 'Recognition smoke only; VPS soak still required.' };
}

function rabbitReport() {
  return { success: true, image: `ghcr.io/wkarts/argws-connect-rabbitmq@sha256:${digest}`,
    rabbitmqVersion: '4.3.6', initialReadyMs: 6100, recreatedReadyMs: 6120,
    checks: ['deployment limits', 'diagnostic identity', 'stopped listener', '100 confirmed quorum messages'],
    samples: ['ready', 'confirmed_backlog', 'recreated_and_drained'].map((phase) =>
      ({ phase, currentBytes: 155000000, peakBytes: 240000000 })),
    limits: { memoryBytes: 2147483648, memorySwapBytes: 2147483648, nanoCpus: 2000000000, pids: 256,
      runtime: '{2,1,1,{ok,{absolute,1073741824}}}' } };
}

function fixture(t, kind = 'native', report = nativeReport()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-evidence-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const env = { ...process.env, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md'),
    GITHUB_EVENT_NAME: 'pull_request', SPEECH_EVIDENCE_UPLOAD_ARTIFACTS: 'false',
    GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'b'.repeat(40),
    SPEECH_EVIDENCE_HEAD_SHA: 'c'.repeat(40), GITHUB_REPOSITORY: 'wkarts/ARGWS-Connect-API',
    GITHUB_JOB: kind, RUNNER_ARCH: 'X64', DATABASE_PROVIDER: 'postgresql',
    SPEECH_SMOKE_IMAGE: 'speech-native:amd64', SPEECH_EVIDENCE_IMAGE_ID: `sha256:${digest}` };
  const file = kind === 'native' ? path.join(directory, 'speech-native-smoke-X64.json') :
    path.join(directory, 'speech-rabbit-ci-postgresql-1234/report.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = JSON.stringify(report, null, 2);
  fs.writeFileSync(file, raw);
  return { directory, env, file, raw,
    run: (args = [kind]) => spawnSync(process.execPath, [script, ...args],
      { cwd: root, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 10000 }),
    summary: () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') };
}

function metadata(summary) {
  return JSON.parse(summary.match(/```json\n([\s\S]*?)\n```/)[1]);
}

for (const kind of ['native', 'rabbitmq']) {
  test(`${kind}: full report and original-byte digest are accessible in both log and summary`, (t) => {
    const f = fixture(t, kind, kind === 'native' ? nativeReport() : rabbitReport());
    fs.writeFileSync(f.env.GITHUB_STEP_SUMMARY, 'Earlier step evidence\n');
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const summary = f.summary();
    assert.ok(summary.startsWith('Earlier step evidence\n'));
    assert.ok(summary.includes(f.raw));
    assert.ok(result.stdout.includes(f.raw));
    const meta = metadata(summary);
    assert.equal(meta.files[0].sha256, createHash('sha256').update(f.raw).digest('hex'));
    assert.equal(meta.files[0].bytes, Buffer.byteLength(f.raw));
    assert.equal(meta.repository, f.env.GITHUB_REPOSITORY);
    assert.equal(meta.runId, '1234');
    assert.equal(meta.runAttempt, '2');
    assert.equal(meta.eventSha, f.env.GITHUB_SHA);
    assert.equal(meta.headSha, f.env.SPEECH_EVIDENCE_HEAD_SHA);
    assert.match(meta.checkoutSha, /^[a-f0-9]{40,64}$/);
    assert.equal(meta.image, kind === 'native' ? f.env.SPEECH_SMOKE_IMAGE : rabbitReport().image);
    if (kind === 'native') assert.equal(meta.imageId, f.env.SPEECH_EVIDENCE_IMAGE_ID);
    assert.ok(Buffer.byteLength(summary) < SUMMARY_LIMIT);
  });
}

test('ARM64 native evidence binds the actual runner architecture', (t) => {
  const f = fixture(t, 'native', nativeReport('arm64'));
  f.env.RUNNER_ARCH = 'ARM64';
  fs.renameSync(f.file, path.join(f.directory, 'speech-native-smoke-ARM64.json'));
  assert.equal(f.run().status, 0);
  assert.equal(metadata(f.summary()).architecture, 'ARM64');
});

test('artifact retention is mandatory by default and PR opt-out rejects typos or publication events', (t) => {
  const f = fixture(t);
  delete f.env.SPEECH_EVIDENCE_UPLOAD_ARTIFACTS;
  f.env.GITHUB_EVENT_NAME = 'push';
  assert.equal(f.run(['policy']).status, 0);
  for (const value of ['FALSE', '', 'no', 'tru']) {
    f.env.SPEECH_EVIDENCE_UPLOAD_ARTIFACTS = value;
    assert.notEqual(f.run(['policy']).status, 0, value);
  }
  f.env.SPEECH_EVIDENCE_UPLOAD_ARTIFACTS = 'false';
  for (const event of ['push', 'workflow_dispatch', 'release', 'pull_request_target']) {
    f.env.GITHUB_EVENT_NAME = event;
    assert.notEqual(f.run(['policy']).status, 0, event);
  }
  f.env.GITHUB_EVENT_NAME = 'pull_request';
  assert.equal(f.run(['policy']).status, 0);
  f.env.SPEECH_EVIDENCE_UPLOAD_ARTIFACTS = 'true';
  f.env.GITHUB_EVENT_NAME = 'push';
  assert.equal(f.run().status, 0);
});

for (const [label, content] of [['empty', ''], ['truncated', '{"nativeRecognition":'],
  ['non-object', '[]'], ['invalid UTF-8', Buffer.from([0xff, 0xfe])], ['oversized', 'x'.repeat(REPORT_LIMIT + 1)]]) {
  test(`${label} evidence fails without claiming a valid report`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.file, content);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Speech evidence failed:/);
    assert.equal(fs.existsSync(f.env.GITHUB_STEP_SUMMARY), false);
  });
}

test('missing, symlink and non-file reports fail', (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.file);
  assert.notEqual(f.run().status, 0);
  const target = path.join(f.directory, 'other.json');
  fs.writeFileSync(target, f.raw);
  fs.symlinkSync(target, f.file);
  assert.notEqual(f.run().status, 0);
  fs.unlinkSync(f.file);
  fs.mkdirSync(f.file);
  assert.notEqual(f.run().status, 0);
});

for (const [label, mutate] of [
  ['recognition failure', (report) => { report.nativeRecognition = false; }],
  ['different process', (report) => { report.sameProcessReused = false; }],
  ['wrong architecture', (report) => { report.architecture = 'arm64'; }],
  ['missing model digest', (report) => { delete report.modelSha256; }],
  ['missing pool limit', (report) => { report.cgroup.poolLimitEnforced = false; }],
  ['pool over budget', (report) => { report.cgroup.memoryPeak = report.cgroup.memoryMax; }],
  ['missing second inference', (report) => { report.runs.pop(); }],
  ['missing recognized text', (report) => { report.runs[1].text = ''; }],
]) {
  test(`native report rejects ${label}`, (t) => {
    const report = nativeReport();
    mutate(report);
    const f = fixture(t, 'native', report);
    assert.notEqual(f.run().status, 0);
  });
}

test('successful RabbitMQ report requires recreation measurements and an immutable image', (t) => {
  const f = fixture(t, 'rabbitmq', rabbitReport());
  for (const mutate of [(report) => { report.samples.pop(); }, (report) => { report.image = 'rabbitmq:latest'; },
    (report) => { report.checks = []; }, (report) => { delete report.limits; }]) {
    const report = rabbitReport();
    mutate(report);
    fs.writeFileSync(f.file, JSON.stringify(report));
    assert.notEqual(f.run().status, 0);
  }
});

test('failed RabbitMQ report and complete diagnostic log remain accessible and keep the gate red', (t) => {
  const report = { success: false, error: 'Readiness timed out', checks: [], samples: [] };
  const f = fixture(t, 'rabbitmq', report);
  const log = 'native failure\n```\n::error::untrusted log content\n';
  fs.writeFileSync(path.join(path.dirname(f.file), 'rabbitmq.log'), log);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /integration failed; complete evidence was preserved/);
  assert.ok(result.stdout.includes(f.raw));
  assert.ok(result.stdout.includes(log));
  assert.ok(f.summary().includes(log));
  assert.ok(f.summary().includes('````text\n'));
  const token = result.stdout.match(/^::stop-commands::([^\n]+)\n/)[1];
  assert.ok(result.stdout.endsWith(`::${token}::\n`));
  const meta = metadata(f.summary());
  assert.equal(meta.files[1].sha256, createHash('sha256').update(log).digest('hex'));
});

test('oversized diagnostic logs fail rather than silently truncate', (t) => {
  const f = fixture(t, 'rabbitmq', rabbitReport());
  fs.writeFileSync(path.join(path.dirname(f.file), 'rabbitmq.log'), 'x'.repeat(LOG_LIMIT + 1));
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.existsSync(f.env.GITHUB_STEP_SUMMARY), false);
});

test('summary budget and inaccessible destination fail instead of losing evidence silently', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.env.GITHUB_STEP_SUMMARY, 'x'.repeat(SUMMARY_LIMIT));
  assert.notEqual(f.run().status, 0);
  fs.unlinkSync(f.env.GITHUB_STEP_SUMMARY);
  f.env.GITHUB_STEP_SUMMARY = path.join(f.directory, 'missing/summary.md');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.ok(result.stdout.includes(f.raw), 'Complete evidence must remain in the log if summary writing fails.');
});

test('missing image identity and invalid run metadata fail', (t) => {
  const f = fixture(t);
  delete f.env.SPEECH_EVIDENCE_IMAGE_ID;
  assert.notEqual(f.run().status, 0);
  f.env.SPEECH_EVIDENCE_IMAGE_ID = `sha256:${digest}`;
  f.env.GITHUB_RUN_ID = '../another-run';
  assert.notEqual(f.run().status, 0);
});
