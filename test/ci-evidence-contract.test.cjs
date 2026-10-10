'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const read = (name) => yaml.load(fs.readFileSync(path.join(root, name), 'utf8'));
const workflow = (name) => read(`.github/workflows/${name}.yml`);
const expression = (value) => String(value).replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '').trim();
const uploads = (steps) => steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));

function requiredStep(steps, matcher) {
  const found = steps.filter((step) => matcher.test(step.run || step.uses || ''));
  assert.ok(found.length > 0, `Required validation is missing: ${matcher}`);
  for (const step of found) {
    assert.equal(step.if, undefined, `${step.name || step.uses} must run before artifacts are transported`);
    assert.notEqual(step['continue-on-error'], true, `${step.name || step.uses} must block on failure`);
  }
  return found;
}

test('Operations builds and validates the package in PRs, with transport required on push', () => {
  const source = workflow('operations-deployments');
  assert.ok(source.on.pull_request);
  assert.ok(source.on.push);
  const job = source.jobs.operations;
  assert.equal(job.if, undefined);
  assert.notEqual(job['continue-on-error'], true);
  requiredStep(job.steps, /sync-operations-deployments\.py --check/);
  requiredStep(job.steps, /operations-compose-contract\.py/);
  requiredStep(job.steps, /operations-statistics(?:-http)?\.test\.cjs/);
  requiredStep(job.steps, /scripts\/package-operations-deployments\.py/);
  const transport = uploads(job.steps);
  assert.equal(transport.length, 1);
  assert.equal(expression(transport[0].if), "github.event_name != 'pull_request'");
  assert.notEqual(transport[0]['continue-on-error'], true);
  assert.equal(transport[0].with['if-no-files-found'], 'error');
});

test('Find Hub keeps all Windows gates and requires artifacts by default', () => {
  const source = workflow('findhub-extension-build');
  const input = source.on.workflow_call.inputs.upload_artifacts;
  assert.equal(input.type, 'boolean');
  assert.equal(input.default, true);
  const job = source.jobs.windows;
  assert.equal(job.if, undefined);
  assert.notEqual(job['continue-on-error'], true);
  requiredStep(job.steps, /cargo \+1\.90\.0 test/);
  requiredStep(job.steps, /cargo \+1\.90\.0 build/);
  requiredStep(job.steps, /windows-assistant\/smoke-test\.ps1/);
  requiredStep(job.steps, /installer\/smoke-test\.ps1/);
  requiredStep(job.steps, /build-findhub-distribution\.cjs[^\n]*--finalize/);
  requiredStep(job.steps, /scripts\/verify-findhub-distribution\.cjs/);
  const transport = uploads(job.steps);
  assert.equal(transport.length, 1);
  assert.equal(expression(transport[0].if), 'inputs.upload_artifacts');
  assert.equal(transport[0].with['if-no-files-found'], 'error');
  assert.notEqual(transport[0]['continue-on-error'], true);
});

test('Find Hub publication callers retain the artifact consumed by their release jobs', () => {
  const develop = workflow('findhub-extension-release');
  const stable = workflow('auto-version-release');
  const reusable = './.github/workflows/findhub-extension-build.yml';
  const developBuilds = Object.values(develop.jobs).filter((job) => job.uses === reusable);
  const stableBuilds = Object.values(stable.jobs).filter((job) => job.uses === reusable);
  assert.equal(developBuilds.length, 1);
  assert.equal(stableBuilds.length, 1);
  assert.equal(expression(developBuilds[0].with.upload_artifacts), "github.event_name != 'pull_request'");
  assert.ok(stableBuilds[0].with.upload_artifacts === undefined || stableBuilds[0].with.upload_artifacts === true);
  for (const source of [develop, stable]) {
    const consumers = Object.values(source.jobs).flatMap((job) => job.steps || [])
      .filter((step) => step.uses?.startsWith('actions/download-artifact@') &&
        step.with?.name === 'findhub-extension-distribution');
    assert.equal(consumers.length, 1);
    assert.notEqual(consumers[0]['continue-on-error'], true);
  }
});

test('Native speech recognition runs before evidence transport and publication keeps the mandatory default', () => {
  const action = read('.github/actions/speech-native-smoke/action.yml');
  assert.equal(action.inputs.upload_artifacts.default, 'true');
  requiredStep(action.runs.steps, /speech-model-provision\.cjs/);
  requiredStep(action.runs.steps, /scripts\/native-smoke\.cjs/);
  requiredStep(action.runs.steps, /preserve-speech-evidence\.cjs/);
  const transport = uploads(action.runs.steps);
  assert.equal(transport.length, 1);
  assert.equal(expression(transport[0].if), "inputs.upload_artifacts == 'true'");
  assert.equal(transport[0].with['if-no-files-found'], 'error');
  assert.notEqual(transport[0]['continue-on-error'], true);
  for (const file of ['ghcr-publish-application', 'auto-version-release']) {
    const callers = Object.values(workflow(file).jobs).flatMap((job) => job.steps || [])
      .filter((step) => step.uses === './.github/actions/speech-native-smoke');
    assert.equal(callers.length, 1, file);
    assert.ok(callers[0].with.upload_artifacts === undefined || callers[0].with.upload_artifacts === 'true', file);
    assert.notEqual(callers[0]['continue-on-error'], true, file);
  }
});

test('Speech PRs still require native, SQL, RabbitMQ and storage validation', () => {
  const source = workflow('speech-integrity');
  const native = source.jobs.native;
  assert.equal(native.if, undefined);
  assert.deepEqual(native.strategy.matrix.include.map((item) => item.arch).sort(), ['amd64', 'arm64']);
  const smoke = requiredStep(native.steps, /^\.\/\.github\/actions\/speech-native-smoke$/)[0];
  assert.equal(expression(smoke.with.upload_artifacts), "github.event_name != 'pull_request'");
  const durable = source.jobs.durable;
  assert.equal(durable.if, undefined);
  assert.deepEqual(durable.strategy.matrix.include.map((item) => item.provider).sort(), ['mysql', 'postgresql']);
  requiredStep(durable.steps, /test\/speech-durable\.integration\.test\.ts/);
  requiredStep(durable.steps, /test\/speech-storage\.integration\.test\.ts/);
  const residency = durable.steps.find((step) => /legacy-residency-integration\.test\.cjs/.test(step.run || ''));
  assert.ok(residency);
  assert.equal(expression(residency.if), "matrix.provider == 'postgresql'");
  assert.notEqual(residency['continue-on-error'], true);
  const transport = uploads(durable.steps);
  assert.equal(transport.length, 1);
  assert.equal(expression(transport[0].if), "always() && github.event_name != 'pull_request'");
  assert.equal(transport[0].with['if-no-files-found'], 'error');
  assert.notEqual(transport[0]['continue-on-error'], true);
});

test('CodeQL analysis and the SARIF gate remain blocking without artifact storage', () => {
  const job = workflow('security').jobs.codeql;
  assert.equal(job.if, undefined);
  assert.notEqual(job['continue-on-error'], true);
  requiredStep(job.steps, /^github\/codeql-action\/init@/);
  requiredStep(job.steps, /^github\/codeql-action\/autobuild@/);
  const analysis = requiredStep(job.steps, /^github\/codeql-action\/analyze@/)[0];
  assert.equal(analysis.with.upload, 'never');
  assert.equal(analysis.with['upload-database'], false);
  assert.notEqual(analysis.with['skip-queries'], true);
  const gate = job.steps.find((step) => /node scripts\/codeql-sarif-gate\.cjs gate(?:\s|$)/.test(step.run || ''));
  assert.ok(gate, 'Automatic SARIF validation is required');
  assert.ok(gate.if === undefined || expression(gate.if) === 'always()');
  assert.notEqual(gate['continue-on-error'], true);
  assert.ok(job.steps.indexOf(gate) > job.steps.indexOf(analysis));
  assert.equal(uploads(job.steps).length, 0);
  const scanningUpload = job.steps.find((step) => step.uses?.startsWith('github/codeql-action/upload-sarif@'));
  assert.ok(scanningUpload, 'Code scanning must receive the report when the repository supports it');
  assert.notEqual(scanningUpload['continue-on-error'], true);
});
