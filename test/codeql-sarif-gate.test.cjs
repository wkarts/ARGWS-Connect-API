'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { evaluateSarif, scanningAvailability, probeScanning } = require('../scripts/codeql-sarif-gate.cjs');

function fixture(score = '6.5', level = 'warning', extension = true) {
  const rule = { id: 'js/example', defaultConfiguration: { level }, properties: {} };
  if (score !== null) rule.properties = { tags: ['security'], 'security-severity': score };
  const driver = { name: 'CodeQL', semanticVersion: '2.27.2', rules: extension ? [] : [rule] };
  const result = {
    ruleId: rule.id,
    ...(extension ? { rule: { id: rule.id, index: 0, toolComponent: { index: 0 } } } : { ruleIndex: 0 }),
    message: { text: 'Preserve all findings, including <script> and\n::error:: text.' },
    locations: [
      { physicalLocation: { artifactLocation: { uri: 'test/codeql-sarif-gate.test.cjs' }, region: { startLine: 1 } } },
    ],
  };
  return {
    version: '2.1.0',
    runs: [
      {
        tool: { driver, extensions: extension ? [{ name: 'codeql/javascript-queries', rules: [rule] }] : [] },
        invocations: [{ executionSuccessful: true }],
        results: [result],
      },
    ],
  };
}

for (const score of ['7.0', '8.9', '9.0', '10.0']) {
  test(`blocks security score ${score} from extension rule metadata`, () => {
    const report = evaluateSarif(fixture(score));
    assert.equal(report.blocking, 1);
    assert.equal(report.findings[0].securitySeverity, Number(score));
  });
}

test('driver rule error blocks with no security score; result-level error also blocks', () => {
  assert.equal(evaluateSarif(fixture(null, 'error', false)).blocking, 1);
  const data = fixture('5.0');
  data.runs[0].results[0].level = 'error';
  assert.equal(evaluateSarif(data).blocking, 1);
});

test('medium, low, ordinary warnings and notes remain visible without blocking', () => {
  for (const [score, level, severity] of [
    ['6.5', 'warning', 'medium'],
    ['5.0', 'warning', 'medium'],
    ['3.9', 'warning', 'low'],
    [null, 'warning', 'warning'],
    [null, 'note', 'note'],
  ]) {
    const data = fixture(score, level);
    const report = evaluateSarif(data);
    assert.equal(report.blocking, 0);
    assert.equal(report.findings[0].severity, severity);
    assert.deepEqual(report.findings[0].result, data.runs[0].results[0]);
  }
});

test('suppression, baseline and accepted state cannot bypass the gate', () => {
  const data = fixture('9.0');
  Object.assign(data.runs[0].results[0], {
    suppressions: [{ kind: 'external', status: 'accepted' }],
    baselineState: 'unchanged',
  });
  assert.equal(evaluateSarif(data).blocking, 1);
});

test('resolves an unambiguous rule ID across extensions and rejects ambiguous/mismatched references', () => {
  const data = fixture();
  delete data.runs[0].results[0].rule;
  assert.equal(evaluateSarif(data).findings.length, 1);
  data.runs[0].tool.driver.rules = structuredClone(data.runs[0].tool.extensions[0].rules);
  assert.throws(() => evaluateSarif(data), /ambiguous/);
  const mismatch = fixture();
  mismatch.runs[0].results[0].rule.id = 'js/other';
  assert.throws(() => evaluateSarif(mismatch), /Conflicting/);
  mismatch.runs[0].results[0].rule.id = 'js/example';
  mismatch.runs[0].results[0].rule.toolComponent.index = 3;
  assert.throws(() => evaluateSarif(mismatch), /component/);
});

test('absent, malformed, unsuccessful or incomplete analysis fails closed', () => {
  const mutations = [
    (data) => {
      data.version = '2.0.0';
    },
    (data) => {
      data.runs = [];
    },
    (data) => {
      delete data.runs[0].invocations;
    },
    (data) => {
      data.runs[0].invocations[0].executionSuccessful = false;
    },
    (data) => {
      data.runs[0].invocations[0].toolExecutionNotifications = [{ level: 'error' }];
    },
    (data) => {
      delete data.runs[0].results;
    },
    (data) => {
      data.runs[0].tool.extensions = [];
    },
    (data) => {
      data.runs[0].results[0].level = 'fatal';
    },
    (data) => {
      delete data.runs[0].tool.extensions[0].rules[0].properties['security-severity'];
    },
    (data) => {
      data.runs[0].tool.extensions[0].rules[0].properties['security-severity'] = '';
    },
    (data) => {
      data.runs[0].tool.extensions[0].rules[0].properties['security-severity'] = 'unknown';
    },
    (data) => {
      data.runs[0].tool.extensions[0].rules[0].properties['security-severity'] = '11';
    },
    (data) => {
      data.runs[0].tool.extensions[0].rules[0].properties.tags = 'security';
    },
    (data) => {
      data.runs[0].tool.extensions[0].rules[0].properties.tags = [false];
    },
    (data) => {
      data.runs[0].tool.extensions[0].rules[0].properties = [];
    },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    assert.throws(() => evaluateSarif(data));
  }
});

test('completed analysis with zero results is valid', () => {
  const data = fixture();
  data.runs[0].results = [];
  assert.equal(evaluateSarif(data).blocking, 0);
});

test('malformed rule properties and default severities cannot become a nonblocking default', () => {
  for (const field of ['properties', 'defaultConfiguration']) {
    for (const value of [null, false, '', []]) {
      const data = fixture(null);
      data.runs[0].tool.extensions[0].rules[0][field] = value;
      assert.throws(() => evaluateSarif(data), /Invalid/);
    }
  }
  for (const target of ['result', 'default', 'properties']) {
    const data = fixture(null);
    const rule = data.runs[0].tool.extensions[0].rules[0];
    if (target === 'result') data.runs[0].results[0].level = null;
    if (target === 'default') rule.defaultConfiguration.level = null;
    if (target === 'properties') rule.properties['problem.severity'] = null;
    assert.throws(() => evaluateSarif(data), /Invalid severity metadata/);
  }
});

test('CodeQL recommendation metadata maps to a SARIF note while high security scores still block', () => {
  for (const score of [null, '7.5']) {
    const data = fixture(score);
    const rule = data.runs[0].tool.extensions[0].rules[0];
    delete rule.defaultConfiguration;
    rule.properties['problem.severity'] = 'recommendation';
    const report = evaluateSarif(data);
    assert.equal(report.findings[0].level, 'note');
    assert.equal(report.blocking, score === null ? 0 : 1);
  }
});

test('only explicit feature-disabled HTTP 403 permits service fallback', () => {
  assert.equal(scanningAvailability(200, []), true);
  for (const message of [
    'Code scanning is not enabled for this repository.',
    'Advanced Security must be enabled',
    'Code Security must be enabled',
  ]) {
    assert.equal(scanningAvailability(403, { message }), false);
  }
  for (const [status, body] of [
    [200, {}],
    [401, { message: 'Bad credentials' }],
    [403, { message: 'Resource not accessible by integration' }],
    [404, { message: 'Not Found' }],
    [429, {}],
    [500, {}],
    [404, { message: 'Code scanning is not enabled' }],
  ]) {
    assert.throws(() => scanningAvailability(status, body), /refusing fallback/);
  }
});

test('probe constrains credentials to one HTTPS request and does not swallow network errors', async () => {
  const env = { GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: 'owner/repo', GITHUB_API_URL: 'https://api.github.com' };
  const available = await probeScanning(env, async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/owner/repo/code-scanning/alerts?per_page=1');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { status: 200, json: async () => [] };
  });
  assert.equal(available, true);
  await assert.rejects(
    probeScanning(env, async () => {
      throw new Error('connection reset');
    }),
    /connection reset/,
  );
  await assert.rejects(probeScanning({ ...env, GITHUB_API_URL: 'http://example.com' }), /Invalid GitHub/);
});

function runGate(t, document, outcome = 'success') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-gate-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const summary = path.join(dir, 'summary.md');
  if (document !== undefined)
    fs.writeFileSync(
      path.join(dir, 'javascript.sarif'),
      typeof document === 'string' ? document : JSON.stringify(document),
    );
  const result = spawnSync(process.execPath, ['scripts/codeql-sarif-gate.cjs', 'gate', dir], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEQL_ANALYSIS_OUTCOME: outcome,
      CODEQL_HEAD_SHA: 'head-sha-fixture',
      GITHUB_SHA: 'event-sha-fixture',
      GITHUB_STEP_SUMMARY: summary,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  return { ...result, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
}

test('CLI emits complete recoverable SARIF, unchanged findings, hashes and escaped summary', (t) => {
  const data = fixture();
  const result = runGate(t, data);
  assert.equal(result.status, 0, result.stderr);
  const payload = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('CODEQL_SARIF_DATA '))
    .map((line) => line.slice('CODEQL_SARIF_DATA '.length))
    .join('');
  const restored = zlib.gunzipSync(Buffer.from(payload, 'base64'));
  assert.deepEqual(JSON.parse(restored), data);
  const hash = crypto.createHash('sha256').update(restored).digest('hex');
  assert.match(result.stdout, new RegExp(`CODEQL_SARIF_END ${hash}`));
  assert.match(result.stdout, /CODEQL_FINDING/);
  assert.match(result.summary, /securitySeverity/);
  assert.match(result.summary, /&lt;script&gt;/);
  assert.doesNotMatch(result.summary, /<script>/);
  assert.match(result.stdout, /"checkout":"[a-f0-9]{40}"/);
  assert.match(result.stdout, /"eventSha":"event-sha-fixture"/);
  assert.match(result.stdout, /"headSha":"head-sha-fixture"/);
});

test('CLI rejects missing/malformed SARIF and unsuccessful analyze even with a clean SARIF', (t) => {
  assert.equal(runGate(t, undefined).status, 1);
  const malformed = runGate(t, '{invalid');
  assert.equal(malformed.status, 1);
  assert.match(malformed.stdout, /CODEQL_SARIF_BEGIN/);
  const failedAnalysis = runGate(t, fixture(), 'failure');
  assert.equal(failedAnalysis.status, 1);
  assert.match(failedAnalysis.summary, /did not succeed/);
  assert.equal(runGate(t, fixture('9.0')).status, 1);
});
