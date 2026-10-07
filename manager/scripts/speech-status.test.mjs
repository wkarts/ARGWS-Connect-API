import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/speech-status.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const status = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const retrySource = readFileSync(new URL('../src/services/retry-after.ts', import.meta.url), 'utf8')
const retryCompiled = ts.transpileModule(retrySource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const retry = await import(`data:text/javascript;base64,${Buffer.from(retryCompiled).toString('base64')}`)

test('supervision heartbeats do not report recognition progress', () => {
  const job = { status: 'processing', stage: 'loading_model', progressPercent: 4, controlHeartbeatAt: '2026-10-07T15:00:00Z' }
  assert.equal(status.reportedSpeechProgress(job), null)
  assert.equal(status.speechProgressToken(job), status.speechProgressToken({ ...job, controlHeartbeatAt: '2026-10-07T15:00:20Z' }))
  assert.equal(status.reportedSpeechProgress({ ...job, stage: 'transcribing', durationKnown: true, processedDurationMs: 15000, progressPercent: 50 }), 50)
  assert.equal(status.reportedSpeechProgress({ status: 'completed' }), 100)
})

test('unknown total duration remains indeterminate even after recognized chunks', () => {
  const job = { status: 'processing', stage: 'transcribing', processedDurationMs: 15000, progressPercent: 0 }
  assert.equal(status.reportedSpeechProgress(job), null)
  assert.equal(status.reportedSpeechProgress({ ...job, durationKnown: false, engineProgressAt: '2026-10-07T15:00:20Z' }), null)
  assert.equal(status.reportedSpeechProgress({ ...job, durationKnown: true, progressPercent: 50 }), 50)
})

test('polling backs off without advancing progress and slows down in background', () => {
  assert.equal(status.speechPollDelay('processing', 0), 1000)
  assert.ok(status.speechPollDelay('processing', 8) > status.speechPollDelay('processing', 0))
  assert.equal(status.speechPollDelay('queued', 0, true), 30000)
  assert.equal(status.speechPollDelay('idle'), 15000)
  assert.equal(status.speechPollDelay('queued', 0, false, 20), 20000)
  assert.equal(status.speechPollDelay('processing', 0, false, 120), 120000)
})

test('HTTP Retry-After seconds and dates reach polling without postponing the job deadline', () => {
  const now = Date.parse('2026-10-07T15:00:00Z')
  assert.equal(retry.parseRetryAfterSeconds(' 120 ', now), 120)
  assert.equal(retry.parseRetryAfterSeconds('Wed, 07 Oct 2026 15:01:30 GMT', now), 90)
  assert.equal(retry.parseRetryAfterSeconds('Wed, 07 Oct 2026 14:59:30 GMT', now), 0)
  assert.equal(retry.parseRetryAfterSeconds('invalid', now), 0)
  assert.equal(retry.parseRetryAfterSeconds(null, now), 0)
  const seconds = retry.errorRetryAfterSeconds({ retryAfterSeconds: 180 })
  const nextDelay = status.speechPollDelay('processing', 2, false, seconds)
  const deadline = status.speechDeadline('2026-10-07T15:00:30Z', now)
  assert.equal(Math.min(nextDelay, deadline - now), 30000)
  assert.equal(retry.errorRetryAfterSeconds(new Error('network failure')), 0)
})

test('dictation uses the earliest server/client deadline without extending it', () => {
  const accepted = Date.parse('2026-10-07T15:00:00Z')
  assert.equal(status.speechDeadline(null, accepted), accepted + 120000)
  assert.equal(status.speechDeadline('2026-10-07T15:30:00Z', accepted), accepted + 120000)
  assert.equal(status.speechDeadline('2026-10-07T15:00:30Z', accepted), accepted + 30000)
})

test('pool status gives priority to real readiness over consumer counts', () => {
  assert.match(status.speechPoolLabel({ state: 'warming', consumerCount: 2, workerReady: false }), /carregado/)
  assert.match(status.speechPoolLabel({ state: 'degraded', consumerCount: 2 }), /degradado/)
  assert.match(status.speechPoolLabel({ state: 'capacity_exhausted' }), /esgotada/)
})
