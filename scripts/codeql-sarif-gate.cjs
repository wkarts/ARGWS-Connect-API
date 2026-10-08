'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const POLICY =
  'Block error results and security scores >= 7.0; retain every result without suppression or baseline filtering.';
const LEVELS = new Set(['none', 'note', 'warning', 'error']);
const MAX_SARIF_BYTES = 64 * 1024 * 1024;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveRule(run, result) {
  const driver = run.tool.driver;
  const extensions = run.tool.extensions || [];
  const reference = result.rule || {};
  const ids = [result.ruleId, reference.id].filter((id) => id !== undefined);
  requireValue(
    ids.every((id) => typeof id === 'string' && id.length > 0),
    'Invalid rule identifier',
  );
  requireValue(new Set(ids).size <= 1, 'Conflicting rule identifiers');
  const component = reference.toolComponent;
  let components = [driver, ...extensions];
  if (component) {
    if (component.index !== undefined) {
      requireValue(Number.isInteger(component.index) && component.index >= 0, 'Invalid component index');
      components = [extensions[component.index]].filter(Boolean);
    }
    for (const key of ['name', 'guid']) {
      if (component[key] !== undefined) components = components.filter((item) => item[key] === component[key]);
    }
    requireValue(components.length === 1, 'Unresolved or ambiguous rule component');
  }
  const index = reference.index ?? result.ruleIndex;
  if (reference.index !== undefined && result.ruleIndex !== undefined) {
    requireValue(reference.index === result.ruleIndex && !component, 'Conflicting rule indices');
  }
  if (index !== undefined) {
    requireValue(Number.isInteger(index) && index >= 0, 'Invalid rule index');
    if (!component) components = [driver];
  }
  let candidates = components.flatMap((item) =>
    index === undefined ? item.rules || [] : [item.rules?.[index]].filter(Boolean),
  );
  if (ids.length) candidates = candidates.filter((rule) => rule.id === ids[0]);
  requireValue((ids.length || index !== undefined) && candidates.length === 1, 'Unresolved or ambiguous rule metadata');
  return candidates[0];
}

function evaluateSarif(document) {
  requireValue(document?.version === '2.1.0', 'Expected SARIF 2.1.0');
  requireValue(Array.isArray(document.runs) && document.runs.length > 0, 'SARIF has no analysis runs');
  const findings = [];
  const analyses = [];
  for (const [runIndex, run] of document.runs.entries()) {
    requireValue(run.tool?.driver?.name === 'CodeQL', 'Expected a CodeQL analysis run');
    requireValue(
      Array.isArray(run.invocations) && run.invocations.length > 0,
      'Missing invocation completion evidence',
    );
    for (const invocation of run.invocations) {
      requireValue(invocation.executionSuccessful === true, 'CodeQL invocation did not complete successfully');
      for (const field of ['toolExecutionNotifications', 'toolConfigurationNotifications']) {
        requireValue(
          invocation[field] === undefined || Array.isArray(invocation[field]),
          'Invalid analysis notifications',
        );
        for (const notification of invocation[field] || []) {
          requireValue(notification.level === undefined || LEVELS.has(notification.level), 'Invalid diagnostic level');
          requireValue(notification.level !== 'error', 'CodeQL reported an analysis error');
        }
      }
    }
    requireValue(run.tool.extensions === undefined || Array.isArray(run.tool.extensions), 'Invalid tool extensions');
    const components = [run.tool.driver, ...(run.tool.extensions || [])];
    let ruleCount = 0;
    for (const component of components) {
      requireValue(
        component && (component.rules === undefined || Array.isArray(component.rules)),
        'Invalid rule metadata',
      );
      const ids = new Set();
      for (const rule of component.rules || []) {
        requireValue(
          typeof rule.id === 'string' && rule.id.length > 0 && !ids.has(rule.id),
          'Invalid or duplicate rule metadata',
        );
        ids.add(rule.id);
        ruleCount++;
      }
    }
    requireValue(ruleCount > 0, 'Missing executed query metadata');
    requireValue(Array.isArray(run.results), 'Missing analysis results');
    analyses.push({
      runIndex,
      tool: run.tool.driver.name,
      version: run.tool.driver.semanticVersion || run.tool.driver.version,
      automationDetails: run.automationDetails,
      properties: run.properties,
      ruleCount,
    });
    for (const result of run.results) {
      requireValue(result && typeof result === 'object' && result.message, 'Invalid result');
      const rule = resolveRule(run, result);
      const properties = rule.properties === undefined ? {} : rule.properties;
      requireValue(
        properties && typeof properties === 'object' && !Array.isArray(properties),
        `Invalid rule properties for ${rule.id}`,
      );
      requireValue(
        rule.defaultConfiguration === undefined ||
          (rule.defaultConfiguration &&
            typeof rule.defaultConfiguration === 'object' &&
            !Array.isArray(rule.defaultConfiguration)),
        `Invalid default configuration for ${rule.id}`,
      );
      for (const level of [result.level, rule.defaultConfiguration?.level]) {
        requireValue(level === undefined || LEVELS.has(level), `Invalid severity metadata for ${rule.id}`);
      }
      const problemSeverity = properties['problem.severity'];
      requireValue(
        problemSeverity === undefined || ['error', 'warning', 'recommendation'].includes(problemSeverity),
        `Invalid severity metadata for ${rule.id}`,
      );
      requireValue(
        properties.tags === undefined ||
          (Array.isArray(properties.tags) && properties.tags.every((tag) => typeof tag === 'string')),
        `Invalid rule tags for ${rule.id}`,
      );
      const problemLevel = problemSeverity === 'recommendation' ? 'note' : problemSeverity;
      const level = result.level ?? rule.defaultConfiguration?.level ?? problemLevel ?? 'warning';
      requireValue(LEVELS.has(level), `Invalid result level for ${rule.id}`);
      const rawScore = properties['security-severity'];
      const security = rawScore !== undefined || properties.tags?.includes('security');
      let score = null;
      if (security) {
        requireValue(
          (typeof rawScore === 'number' || typeof rawScore === 'string') && /^\d+(\.\d+)?$/.test(String(rawScore)),
          `Missing or invalid security score for ${rule.id}`,
        );
        score = Number(rawScore);
        requireValue(Number.isFinite(score) && score >= 0 && score <= 10, `Invalid security score for ${rule.id}`);
      }
      findings.push({
        runIndex,
        ruleId: rule.id,
        level,
        securitySeverity: score,
        severity:
          score === null ? level : score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low',
        blocking: level === 'error' || (score !== null && score >= 7),
        rule,
        result,
      });
    }
  }
  return { analyses, findings, blocking: findings.filter((item) => item.blocking).length };
}

function scanningAvailability(status, body) {
  if (status === 200 && Array.isArray(body)) return true;
  // Match only explicit feature-enablement errors recognized by codeql-action.
  if (
    status === 403 &&
    typeof body?.message === 'string' &&
    /Code scanning is not enabled|Code Security must be enabled|Advanced Security must be enabled/i.test(body.message)
  )
    return false;
  throw new Error(`Code scanning availability could not be established (HTTP ${status}); refusing fallback`);
}

async function probeScanning(env = process.env, request = fetch) {
  requireValue(
    env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || ''),
    'Missing GitHub probe configuration',
  );
  const base = new URL(env.GITHUB_API_URL || 'https://api.github.com');
  requireValue(base.protocol === 'https:' && !base.username && !base.password, 'Invalid GitHub API URL');
  const response = await request(
    `${base.href.replace(/\/$/, '')}/repos/${env.GITHUB_REPOSITORY}/code-scanning/alerts?per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    },
  );
  const available = scanningAvailability(response.status, await response.json());
  const report = available
    ? 'Code scanning is available: SARIF publication is mandatory in the next step.'
    : 'GitHub explicitly reports Code scanning disabled: the automatic local SARIF gate remains mandatory; full evidence is in this job log.';
  console.log(report);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `available=${available}\n`);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `\n${report}\n`);
  return available;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function archiveEvidence(name, bytes) {
  const payload = zlib.gzipSync(bytes).toString('base64');
  requireValue(payload.length <= 8 * 1024 * 1024, 'Compressed SARIF exceeds the recoverable log evidence budget');
  const metadata = { name, bytes: bytes.length, sha256: sha256(bytes), encoding: 'gzip+base64' };
  console.log(`CODEQL_SARIF_BEGIN ${JSON.stringify(metadata)}`);
  for (let start = 0; start < payload.length; start += 1024)
    console.log(`CODEQL_SARIF_DATA ${payload.slice(start, start + 1024)}`);
  console.log(`CODEQL_SARIF_END ${metadata.sha256}`);
  return metadata;
}

function locations(result) {
  return [
    ...(result.locations || []),
    ...(result.relatedLocations || []),
    ...(result.codeFlows || []).flatMap((flow) =>
      (flow.threadFlows || []).flatMap((thread) => (thread.locations || []).map((item) => item.location)),
    ),
  ]
    .filter(Boolean)
    .map((item) => item.physicalLocation)
    .filter(Boolean);
}

function gate(directory, env = process.env) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.sarif'))
    .sort();
  requireValue(files.length > 0, 'No SARIF files produced');
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0'));
  const sourceNames = new Set([
    'scripts/connect-backup-crypto.cjs',
    'operations-agent/store.cjs',
    'operations-agent/server.cjs',
    '.github/workflows/security.yml',
    'scripts/codeql-sarif-gate.cjs',
  ]);
  const report = {
    policy: POLICY,
    checkout,
    eventSha: env.GITHUB_SHA,
    headSha: env.CODEQL_HEAD_SHA,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    analysisOutcome: env.CODEQL_ANALYSIS_OUTCOME,
    files: [],
    analyses: [],
    findings: [],
    sources: [],
    errors: [],
  };
  if (env.CODEQL_ANALYSIS_OUTCOME !== 'success') report.errors.push('The CodeQL analysis step did not succeed');
  let totalBytes = 0;
  for (const name of files) {
    try {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      totalBytes += stat.size;
      requireValue(stat.isFile() && totalBytes <= MAX_SARIF_BYTES, 'Invalid or oversized SARIF input');
      const bytes = fs.readFileSync(file);
      report.files.push(archiveEvidence(name, bytes));
      const analysis = evaluateSarif(JSON.parse(bytes.toString('utf8')));
      report.analyses.push(...analysis.analyses.map((item) => ({ file: name, ...item })));
      for (const finding of analysis.findings) {
        report.findings.push({ file: name, ...finding });
        for (const location of locations(finding.result)) {
          const uri = location.artifactLocation?.uri;
          if (typeof uri === 'string') {
            let decoded;
            try {
              decoded = decodeURIComponent(uri);
            } catch {
              continue;
            }
            if (tracked.has(decoded)) sourceNames.add(decoded);
          }
        }
      }
    } catch (error) {
      report.errors.push(`${name}: ${error.message}`);
    }
  }
  for (const name of [...sourceNames].sort()) {
    if (tracked.has(name) && fs.lstatSync(name).isFile())
      report.sources.push({ name, sha256: sha256(fs.readFileSync(name)) });
  }
  report.blocking = report.findings.filter((finding) => finding.blocking).length;
  report.passed = report.errors.length === 0 && report.blocking === 0;
  console.log(`CODEQL_GATE_METADATA ${JSON.stringify({ ...report, findings: undefined })}`);
  for (const finding of report.findings) console.log(`CODEQL_FINDING ${JSON.stringify(finding)}`);
  const escaped = JSON.stringify(report, null, 2).replace(
    /[&<>]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char],
  );
  let summary = `## CodeQL automatic SARIF gate: ${report.passed ? 'PASS' : 'FAIL'}\n\n${POLICY}\n\nAnalyzed checkout: \`${checkout}\`. Results: ${report.findings.length}; blocking: ${report.blocking}; analysis/metadata errors: ${report.errors.length}.\n\nThe job log contains every finding, source/SARIF SHA-256, analysis scope metadata and recoverable complete SARIF (CODEQL_SARIF_BEGIN/DATA/END). Evidence follows Actions log retention; it does not depend on artifact storage quota.\n\n`;
  summary +=
    Buffer.byteLength(escaped) < 800000
      ? `<details><summary>Complete findings and metadata</summary>\n<pre>${escaped}</pre>\n</details>\n`
      : 'The complete report exceeds the summary size budget; every finding and the complete SARIF remain in the job log.\n';
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return report;
}

if (require.main === module) {
  (async () => {
    if (process.argv[2] === 'probe') await probeScanning();
    else if (process.argv[2] === 'gate') process.exitCode = gate(process.argv[3] || 'codeql-results').passed ? 0 : 1;
    else throw new Error('Usage: node scripts/codeql-sarif-gate.cjs gate [directory] | probe');
  })().catch((error) => {
    console.error(`CodeQL gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { evaluateSarif, scanningAvailability, probeScanning, archiveEvidence, gate };
