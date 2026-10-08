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
  assert.match(status.speechPoolLabel({ state: 'warming', consumerCount: 2, workerReady: false }), /Inicialização/)
  assert.match(status.speechPoolLabel({ state: 'degraded', consumerCount: 2 }), /degradado/)
  assert.match(status.speechPoolLabel({ state: 'capacity_exhausted' }), /esgotada/)
})

const coldHealth = {
  enabled: true, state: 'warming', connected: true, processAlive: true, brokerConnected: true,
  modelVerified: true, engineReady: false, workerReady: false, dictationWorkerReady: false,
  acceptingJobs: true, capabilities: { transcription: true, dictation: true },
  modelDownload: { status: 'ready', installed: true },
  queuedJobs: 0, processingJobs: 0, dictationQueuedJobs: 0, dictationProcessingJobs: 0,
}

test('a verified idle coordinator is available on demand without claiming a loaded engine', () => {
  const before = structuredClone(coldHealth)
  assert.equal(status.speechWorkerLabel(coldHealth, 'transcription'), 'Disponível sob demanda')
  assert.equal(status.speechWorkerLabel(coldHealth, 'dictation'), 'Disponível sob demanda')
  assert.match(status.speechPoolLabel(coldHealth), /disponível sob demanda/)
  assert.doesNotMatch(status.speechPoolLabel(coldHealth), /está sendo carregado|inicialização ainda não terminou/i)
  assert.deepEqual(coldHealth, before)
})

test('worker readiness and workload do not leak between transcription and dictation', () => {
  const health = { ...coldHealth, state: 'busy', workerReady: true, engineReady: true, processingJobs: 1,
    capabilities: { transcription: true, dictation: false } }
  assert.equal(status.speechWorkerLabel(health, 'transcription'), 'Trabalho em andamento')
  assert.equal(status.speechWorkerLabel(health, 'dictation'), 'Indisponível')
  assert.equal(status.speechWorkerLabel({ ...health, processingJobs: 0 }, 'transcription'), 'Pronto')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, dictationProcessingJobs: 1 }, 'transcription'), 'Disponível sob demanda')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, dictationProcessingJobs: 1 }, 'dictation'), 'Trabalho em andamento')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, dictationQueuedJobs: 1 }, 'dictation'), 'Aguardando processamento')
  assert.equal(status.speechWorkerLabel({ workerReady: true }, 'transcription'), 'Pronto')
})

test('disabled, disconnected and exhausted modes never appear available on demand', () => {
  assert.equal(status.speechWorkerLabel(null, 'transcription'), 'Consultando')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, enabled: false }, 'transcription'), 'Desativado')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, dictationEnabled: false }, 'dictation'), 'Desativado')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, state: 'offline' }, 'transcription'), 'Sem conexão')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, state: 'offline', processAlive: false, modelVerified: false }, 'transcription'), 'Sem conexão')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, connected: false }, 'transcription'), 'Sem conexão')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, processAlive: false }, 'transcription'), 'Sem conexão')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, brokerConnected: false }, 'transcription'), 'Sem conexão')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, acceptingJobs: false }, 'transcription'), 'Indisponível')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, state: 'degraded' }, 'transcription'), 'Indisponível')
  assert.equal(status.speechWorkerLabel({ ...coldHealth, state: 'capacity_exhausted', acceptingJobs: false }, 'transcription'), 'Capacidade esgotada')
  assert.equal(status.speechWorkerLabel({ enabled: true, consumerCount: 2 }, 'transcription'), 'Indisponível')
})

test('model provisioning and failed verification have explicit labels', () => {
  const health = { ...coldHealth, state: 'offline', processAlive: false, modelVerified: false }
  assert.equal(status.speechWorkerLabel({ ...health, modelDownload: { status: 'not_installed', installed: false } }, 'transcription'), 'Modelo não instalado')
  for (const modelStatus of ['downloading', 'verifying']) {
    assert.equal(status.speechWorkerLabel({ ...health, modelDownload: { status: modelStatus, installed: false } }, 'transcription'), 'Preparando modelo')
  }
  assert.equal(status.speechWorkerLabel({ ...coldHealth, modelVerified: false }, 'transcription'), 'Modelo não verificado')
  assert.equal(status.speechWorkerLabel({ ...health, modelDownload: { status: 'failed', installed: false } }, 'transcription'), 'Modelo não verificado')
})

test('SQL processing counts do not claim recognition or current native inference', () => {
  const health = { ...coldHealth, state: 'busy', processingJobs: 1, lastSuccessfulInferenceAt: null }
  assert.equal(status.speechWorkerLabel(health, 'transcription'), 'Trabalho em andamento')
  assert.match(status.speechPoolLabel(health), /trabalhos marcados como em processamento/)
  assert.doesNotMatch(status.speechPoolLabel(health), /motor está processando|reconhecimento concluído|transcrevendo/i)
  assert.equal(status.reportedSpeechProgress({ status: 'processing', stage: 'loading_model' }), null)
})

test('settings refresh replaces the startup snapshot and prevents overlapping requests', async () => {
  const settings = readFileSync(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8')
  const script = settings.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
  const parsed = ts.createSourceFile('SettingsView.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = parsed.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'loadSpeechHealth')
  assert.ok(declaration)
  const body = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const speechHealth = { value: coldHealth }, speechError = { value: '' }, speechLoading = { value: false }
  let calls = 0, resolveRequest, rejectRequest
  const connect = { speechHealth: () => { calls++; return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject }) } }
  const refresh = new Function('connect', 'speechHealth', 'speechError', 'speechLoading', 'friendlyError', body + '; return loadSpeechHealth')(
    connect, speechHealth, speechError, speechLoading, (error) => error.message,
  )
  const first = refresh()
  assert.equal(speechLoading.value, true)
  assert.equal(speechHealth.value, null)
  await refresh()
  assert.equal(calls, 1)
  const ready = { ...coldHealth, state: 'ready', workerReady: true, engineReady: true }
  resolveRequest(ready)
  await first
  assert.equal(speechHealth.value, ready)
  assert.equal(speechLoading.value, false)
  const second = refresh()
  rejectRequest(new Error('Consulta indisponível'))
  await second
  assert.equal(speechLoading.value, false)
  assert.equal(speechHealth.value, null)
  assert.equal(speechError.value, 'Consulta indisponível')
})
