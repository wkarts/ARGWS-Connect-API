'use strict';

// CI reports remain reviewable in job logs when PR artifact storage is full.
// Publication still requires the composite action's artifact upload.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const REPORT_LIMIT = 128 * 1024;
const LOG_LIMIT = 256 * 1024;
const SUMMARY_LIMIT = 512 * 1024;

function validatePolicy(env) {
  const upload = env.SPEECH_EVIDENCE_UPLOAD_ARTIFACTS ?? 'true';
  assert.ok(upload === 'true' || upload === 'false', 'upload_artifacts must be true or false.');
  assert.ok(upload !== 'false' || env.GITHUB_EVENT_NAME === 'pull_request',
    'Artifact upload can be disabled only for pull_request evidence.');
}

function readBounded(file, limit, optional = false) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile(), `${path.basename(file)} must be a regular file.`);
    const minimum = optional ? 0 : 1;
    assert.ok(stat.size >= minimum && stat.size <= limit,
      `${path.basename(file)} must contain ${minimum}..${limit} bytes.`);
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes <= limit) {
      const count = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    assert.ok(bytes >= minimum && bytes <= limit, `${path.basename(file)} exceeded its evidence limit.`);
    const content = buffer.subarray(0, bytes);
    return { name: path.basename(file), bytes, sha256: createHash('sha256').update(content).digest('hex'),
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) };
  } finally { fs.closeSync(fd); }
}

function finite(value, label, minimum = 0) {
  assert.ok(Number.isFinite(value) && value >= minimum, `${label} must be a finite number >= ${minimum}.`);
}

function validateReport(kind, report, env) {
  assert.ok(report && typeof report === 'object' && !Array.isArray(report), 'Evidence must be a JSON object.');
  if (kind === 'native') {
    assert.equal(report.nativeRecognition, true, 'Native recognition must have passed.');
    assert.equal(report.sameProcessReused, true, 'Both recordings must reuse the native process.');
    assert.equal(report.architecture, { X64: 'x64', ARM64: 'arm64' }[env.RUNNER_ARCH]);
    assert.match(report.modelSha256 || '', /^[a-f0-9]{64}$/);
    assert.equal(report.cgroup?.poolLimitEnforced, true, 'The whole-pool cgroup limit must be enforced.');
    assert.equal(report.cgroup.memoryMax, '1342177280');
    assert.match(report.cgroup.memoryPeak || '', /^[0-9]+$/);
    assert.ok(Number(report.cgroup.memoryPeak) > 0 && Number(report.cgroup.memoryPeak) < 1342177280);
    finite(report.coldStartMs, 'coldStartMs');
    assert.ok(Array.isArray(report.runs) && report.runs.length === 2, 'Both recognition results are required.');
    for (const [index, run] of report.runs.entries()) {
      assert.equal(run.index, index + 1);
      finite(run.inferenceMs, 'inferenceMs');
      assert.ok(Number.isInteger(run.segments) && run.segments > 0, 'Recognized segments are required.');
      assert.match(run.text || '', /country/i);
    }
    return;
  }
  assert.equal(typeof report.success, 'boolean', 'RabbitMQ report must record its result.');
  assert.ok(Array.isArray(report.checks) && report.checks.every((check) => typeof check === 'string'));
  assert.ok(Array.isArray(report.samples));
  if (!report.success) {
    assert.ok(typeof report.error === 'string' && report.error.length > 0, 'Failed RabbitMQ report needs its error.');
    return; // Preserve the partial diagnostic report, then fail the evidence step.
  }
  assert.match(report.image || '', /^ghcr\.io\/[a-z0-9_.-]+\/argws-connect-rabbitmq@sha256:[a-f0-9]{64}$/);
  assert.ok(typeof report.rabbitmqVersion === 'string' && report.rabbitmqVersion.length > 0);
  finite(report.initialReadyMs, 'initialReadyMs');
  finite(report.recreatedReadyMs, 'recreatedReadyMs');
  assert.ok(report.checks.length >= 4, 'Startup, diagnostic projection, stopped listener and persistence evidence required.');
  for (const key of ['memoryBytes', 'memorySwapBytes', 'nanoCpus', 'pids']) finite(report.limits?.[key], key, 1);
  for (const phase of ['ready', 'confirmed_backlog', 'recreated_and_drained']) {
    const sample = report.samples.find((item) => item.phase === phase);
    finite(sample?.currentBytes, `${phase}.currentBytes`, 1);
  }
}

function fenced(text, language) {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n`;
}

function preserve(kind, env = process.env) {
  validatePolicy(env);
  assert.ok(kind === 'native' || kind === 'rabbitmq', 'Expected native, rabbitmq or policy.');
  assert.ok(path.isAbsolute(env.RUNNER_TEMP || ''), 'RUNNER_TEMP must be absolute.');
  assert.ok(path.isAbsolute(env.GITHUB_STEP_SUMMARY || ''), 'GITHUB_STEP_SUMMARY must be absolute.');
  assert.match(env.GITHUB_RUN_ID || '', /^[0-9]+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^[0-9]+$/);
  assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40,64}$/);
  assert.match(env.GITHUB_REPOSITORY || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_JOB || '', /^[A-Za-z0-9_-]+$/);
  assert.ok(['X64', 'ARM64'].includes(env.RUNNER_ARCH), 'Expected a supported native runner architecture.');
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.match(checkoutSha, /^[a-f0-9]{40,64}$/);
  const headSha = env.SPEECH_EVIDENCE_HEAD_SHA || checkoutSha;
  assert.match(headSha, /^[a-f0-9]{40,64}$/);
  let reportFile;
  if (kind === 'native') {
    reportFile = path.join(env.RUNNER_TEMP, `speech-native-smoke-${env.RUNNER_ARCH}.json`);
  } else {
    assert.ok(['postgresql', 'mysql'].includes(env.DATABASE_PROVIDER), 'Expected a SQL provider.');
    reportFile = path.join(env.RUNNER_TEMP, `speech-rabbit-ci-${env.DATABASE_PROVIDER}-${env.GITHUB_RUN_ID}`, 'report.json');
  }
  const source = readBounded(reportFile, REPORT_LIMIT);
  const report = JSON.parse(source.text);
  validateReport(kind, report, env);
  const files = [source];
  if (kind === 'rabbitmq') {
    const log = readBounded(path.join(path.dirname(reportFile), 'rabbitmq.log'), LOG_LIMIT, true);
    if (log) files.push(log);
  }
  const image = kind === 'native' ? env.SPEECH_SMOKE_IMAGE : report.image || null;
  const imageId = kind === 'native' ? env.SPEECH_EVIDENCE_IMAGE_ID : null;
  if (kind === 'native') {
    assert.ok(typeof image === 'string' && image.length > 0 && image.length <= 512, 'Native image reference required.');
    assert.match(imageId || '', /^sha256:[a-f0-9]{64}$/, 'Resolved native image ID required.');
  }
  const metadata = { schemaVersion: 1, kind, repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB,
    event: env.GITHUB_EVENT_NAME, eventSha: env.GITHUB_SHA, checkoutSha, headSha,
    architecture: env.RUNNER_ARCH, provider: env.DATABASE_PROVIDER || null, image, imageId,
    files: files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) };
  const title = `Speech ${kind} evidence`;
  const body = `### ${title}\n\nFull reports; SHA-256 covers the original UTF-8 file bytes. ` +
    'The job log also contains this evidence.\n\n' + fenced(JSON.stringify(metadata, null, 2), 'json') +
    files.map((file) => `\n${file.name}\n\n${fenced(file.text, file.name.endsWith('.json') ? 'json' : 'text')}`).join('');
  assert.ok(Buffer.byteLength(body) <= SUMMARY_LIMIT, 'Evidence exceeds the summary budget; nothing was truncated.');
  const summaryBytes = fs.existsSync(env.GITHUB_STEP_SUMMARY) ? fs.statSync(env.GITHUB_STEP_SUMMARY).size : 0;
  assert.ok(summaryBytes + Buffer.byteLength(body) <= SUMMARY_LIMIT, 'Step summary exceeds its evidence budget.');
  // Report text, including diagnostic logs, must never become runner commands.
  const token = randomUUID();
  process.stdout.write(`::stop-commands::${token}\n${body}\n::${token}::\n`);
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY, body, 'utf8');
  assert.ok(kind !== 'rabbitmq' || report.success, 'RabbitMQ integration failed; complete evidence was preserved.');
  return metadata;
}

if (require.main === module) {
  try {
    if (process.argv[2] === 'policy') validatePolicy(process.env);
    else preserve(process.argv[2]);
  } catch (error) {
    console.error(`Speech evidence failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { preserve, validatePolicy, validateReport, REPORT_LIMIT, LOG_LIMIT, SUMMARY_LIMIT };
