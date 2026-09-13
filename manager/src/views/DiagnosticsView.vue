<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import { diagnostics, type DiagnosticCategory, type DiagnosticEvent, type DiagnosticFilters, type DiagnosticLevel, type DiagnosticStatus } from '@/services/diagnostics'

const status = ref<DiagnosticStatus | null>(null)
const events = ref<DiagnosticEvent[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false), loadingMore = ref(false), downloading = ref(false), saving = ref(false)
const error = ref(''), exportError = ref(''), settingsError = ref(''), settingsSuccess = ref('')
const loadedAt = ref(''), live = ref(false), showSettings = ref(false), selected = ref<DiagnosticEvent | null>(null)
const drawer = ref<HTMLElement | null>(null), copied = ref(false)
const draft = reactive({ period: '1h', level: '' as DiagnosticLevel | '', category: '' as DiagnosticCategory | '', traceId: '', callId: '', instanceId: '' })
const applied = ref<DiagnosticFilters>({})
const retentionDays = ref(7), maxDiskMB = ref(128), format = ref<'gzip' | 'jsonl'>('gzip')
const levels = { info: 'Informação', warn: 'Aviso', error: 'Erro' }
const categories: Record<DiagnosticCategory, string> = { http: 'Requisições', error: 'Erros', connection: 'Conexões', call: 'Chamadas', runtime: 'Execução', frontend: 'Interface', system: 'Sistema' }
const periods: Record<string, number> = { '15m': 15 * 60000, '1h': 3600000, '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 }
const usage = computed(() => status.value?.maxDiskBytes ? Math.min(100, Math.round(status.value.diskBytes / status.value.maxDiskBytes * 100)) : 0)
const captureOk = computed(() => Boolean(status.value?.ready && status.value.persistent && !status.value.storageError))
const activeIds = computed(() => ['traceId', 'callId', 'instanceId'].filter(key => Boolean(applied.value[key as keyof DiagnosticFilters])).length)
let requestController: AbortController | null = null, exportController: AbortController | null = null, settingsController: AbortController | null = null
let timer: ReturnType<typeof setInterval> | undefined
let revision = 0, disposed = false
let focusBeforeDrawer: HTMLElement | null = null

function bytes(value = 0) { return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB` }
function date(value: string) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—' }
function message(caught: unknown) { return caught instanceof Error ? caught.message : 'Não foi possível concluir a consulta. Tente novamente.' }
function filters(): DiagnosticFilters {
  const now = Date.now()
  return { from: new Date(now - periods[draft.period]!).toISOString(), to: new Date(now).toISOString(), level: draft.level, category: draft.category, traceId: draft.traceId.trim(), callId: draft.callId.trim(), instanceId: draft.instanceId.trim() }
}
function validIds() {
  if ([draft.traceId, draft.callId, draft.instanceId].some(value => value.trim() && !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.trim()))) {
    error.value = 'Use o identificador técnico copiado do diagnóstico, com até 128 caracteres. Não informe telefone ou nome.'
    return false
  }
  return true
}
async function refresh(updateFilters = true) {
  if (!validIds()) return
  requestController?.abort()
  requestController = new AbortController()
  const currentRevision = ++revision, signal = requestController.signal
  if (updateFilters) applied.value = filters()
  loading.value = true; loadingMore.value = false; error.value = ''
  // Old records must never appear as the result of a newly selected filter.
  events.value = []; cursor.value = null
  try {
    const [snapshot, page] = await Promise.all([diagnostics.status(signal), diagnostics.events(applied.value, '', signal)])
    if (disposed || currentRevision !== revision) return
    status.value = snapshot; events.value = page.events; cursor.value = page.nextCursor
    loadedAt.value = new Date().toISOString()
    if (!showSettings.value) { retentionDays.value = snapshot.retentionDays; maxDiskMB.value = Math.round(snapshot.maxDiskBytes / 1048576) }
  } catch (caught) {
    if (!disposed && currentRevision === revision && !signal.aborted) error.value = message(caught)
  } finally { if (!disposed && currentRevision === revision) loading.value = false }
}
async function more() {
  if (!cursor.value || loading.value || loadingMore.value) return
  const currentRevision = revision, signal = requestController?.signal
  loadingMore.value = true; error.value = ''
  try {
    const page = await diagnostics.events(applied.value, cursor.value, signal)
    if (disposed || currentRevision !== revision) return
    const known = new Set(events.value.map(event => event.id))
    events.value.push(...page.events.filter(event => !known.has(event.id)))
    cursor.value = page.nextCursor
  } catch (caught) { if (!disposed && currentRevision === revision && !signal?.aborted) error.value = message(caught) }
  finally { if (!disposed && currentRevision === revision) loadingMore.value = false }
}
function reset() {
  Object.assign(draft, { period: '1h', level: '', category: '', traceId: '', callId: '', instanceId: '' })
  void refresh()
}
function filterId(key: 'traceId' | 'callId' | 'instanceId', value: string) {
  draft[key] = value; closeDetails(); void refresh()
}
async function download() {
  if (downloading.value) return
  exportController?.abort(); exportController = new AbortController()
  downloading.value = true; exportError.value = ''
  try { await diagnostics.download({ ...applied.value }, format.value, exportController.signal) }
  catch (caught) { if (!disposed && !exportController.signal.aborted) exportError.value = message(caught) }
  finally { if (!disposed) downloading.value = false }
}
async function saveSettings() {
  settingsError.value = ''; settingsSuccess.value = ''
  if (!Number.isInteger(retentionDays.value) || retentionDays.value < 1 || retentionDays.value > 30 || !Number.isInteger(maxDiskMB.value) || maxDiskMB.value < 32 || maxDiskMB.value > 512) {
    settingsError.value = 'Informe de 1 a 30 dias e de 32 a 512 MB, em números inteiros.'; return
  }
  settingsController?.abort(); settingsController = new AbortController(); saving.value = true
  try {
    const snapshot = await diagnostics.settings(retentionDays.value, maxDiskMB.value, settingsController.signal)
    if (disposed) return
    status.value = snapshot; settingsSuccess.value = 'Limites de armazenamento atualizados.'
  } catch (caught) { if (!disposed && !settingsController.signal.aborted) settingsError.value = message(caught) }
  finally { if (!disposed) saving.value = false }
}
async function openDetails(event: DiagnosticEvent) {
  focusBeforeDrawer = document.activeElement as HTMLElement
  selected.value = event; copied.value = false
  await nextTick(); drawer.value?.focus()
}
function closeDetails() { selected.value = null; focusBeforeDrawer?.focus() }
function drawerKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeDetails(); return }
  if (event.key !== 'Tab' || !drawer.value) return
  const nodes = Array.from(drawer.value.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')).filter(node => !node.hasAttribute('disabled'))
  if (!nodes.length) { event.preventDefault(); return }
  const first = nodes[0]!, last = nodes[nodes.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
async function copyEvent() {
  if (!selected.value) return
  try { await navigator.clipboard.writeText(JSON.stringify(selected.value, null, 2)); copied.value = true }
  catch { copied.value = false; exportError.value = 'A cópia não foi permitida pelo navegador. Use o download para salvar os registros.' }
}
watch(live, enabled => {
  if (timer) clearInterval(timer)
  if (enabled) timer = setInterval(() => { if (!loading.value && !loadingMore.value && !document.hidden) void refresh() }, 5000)
})
onMounted(() => { void refresh() })
onUnmounted(() => {
  disposed = true; ++revision
  if (timer) clearInterval(timer)
  requestController?.abort(); exportController?.abort(); settingsController?.abort()
})
</script>

<template>
  <AppShell>
    <div class="diagnostics">
      <PageHeader title="Centro de diagnóstico" description="Acompanhe erros e a sequência técnica das operações para investigar falhas.">
        <button class="btn ghost" :disabled="loading" @click="refresh()"><AppIcon name="refresh" :size="16" />{{ loading ? 'Atualizando…' : 'Atualizar' }}</button>
      </PageHeader>

      <section class="privacy-note"><AppIcon name="shield" :size="22" /><div><strong>Diagnóstico sem conteúdo de conversas</strong><p>Coleta automática de eventos técnicos. Não registra mensagens, áudio, mídias ou chaves. Os identificadores são pseudonimizados para acompanhar a mesma operação.</p></div></section>

      <p v-if="status?.version" class="runtime-meta">API {{ status.version }}<template v-if="status.startedAt"> · Serviço iniciado em {{ date(status.startedAt) }}</template></p>
      <div v-if="status" class="metric-grid">
        <article class="diagnostic-metric"><span>Coleta e armazenamento</span><strong class="capture-state" :class="{ attention: !captureOk }"><i></i>{{ captureOk ? 'Em funcionamento' : 'Requer atenção' }}</strong><small>{{ status.storageError ? 'Falha de armazenamento detectada' : status.persistent ? 'Histórico disponível em disco' : 'Histórico não persistido em disco' }}</small></article>
        <article class="diagnostic-metric"><span>Eventos retidos</span><strong>{{ status.storedEvents.toLocaleString('pt-BR') }}</strong><small>Nos últimos {{ status.retentionDays }} dias, sujeito ao limite de espaço</small></article>
        <article class="diagnostic-metric"><span>Erros e avisos retidos</span><strong><span class="error-count">{{ status.counts.error }}</span><em>erros</em><span class="warn-count">{{ status.counts.warn }}</span><em>avisos</em></strong><small>Totais do histórico, antes dos filtros</small></article>
        <article class="diagnostic-metric"><span>Espaço utilizado</span><strong>{{ bytes(status.diskBytes) }}<em>/ {{ bytes(status.maxDiskBytes) }}</em></strong><div class="usage-track"><span :style="{ width: `${usage}%` }"></span></div><small>{{ status.dropped }} eventos descartados pela proteção de volume</small></article>
      </div>
      <p v-if="status && (!captureOk || status.dropped > 0)" class="notice warning" role="status">{{ !captureOk ? 'O histórico pode estar incompleto. Verifique o estado do armazenamento antes de reproduzir a falha.' : 'A proteção de volume descartou eventos. Considere um intervalo menor ao reproduzir a falha; o histórico pode ter lacunas.' }}</p>

      <section class="diagnostic-panel">
        <header class="section-heading"><div><h2>Rastreamento de eventos</h2><p>Reproduza o problema e baixe o período correspondente nas duas APIs envolvidas.</p></div><label class="live-toggle"><input v-model="live" type="checkbox" /><span class="live-dot" :class="{ enabled: live }"></span>Atualizar a cada 5 s</label></header>
        <form class="filter-form" @submit.prevent="refresh()">
          <div class="filter-main">
            <label>Período<select v-model="draft.period"><option value="15m">Últimos 15 minutos</option><option value="1h">Última hora</option><option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option></select></label>
            <label>Nível<select v-model="draft.level"><option value="">Todos os níveis</option><option v-for="(label, key) in levels" :key="key" :value="key">{{ label }}</option></select></label>
            <label>Categoria<select v-model="draft.category"><option value="">Todas as categorias</option><option v-for="(label, key) in categories" :key="key" :value="key">{{ label }}</option></select></label>
          </div>
          <div class="filter-ids">
            <label>Rastreio<input v-model="draft.traceId" placeholder="Identificador do rastreio" maxlength="128" spellcheck="false" /></label>
            <label>Chamada<input v-model="draft.callId" placeholder="Identificador técnico da chamada" maxlength="128" spellcheck="false" /></label>
            <label>Instância<input v-model="draft.instanceId" placeholder="Identificador pseudonimizado" maxlength="128" spellcheck="false" /></label>
            <div class="filter-actions"><button type="button" class="btn ghost" @click="reset">Limpar</button><button type="submit" class="btn primary" :disabled="loading">Aplicar filtros</button></div>
          </div>
        </form>
        <div class="results-toolbar"><div><strong>{{ events.length }} eventos carregados</strong><span v-if="activeIds"> · {{ activeIds }} filtro(s) por identificador</span><small v-if="loadedAt">Atualizado em {{ date(loadedAt) }}{{ live ? ' · exibe a página mais recente' : '' }}</small><small v-if="applied.from && applied.to">Período aplicado: {{ date(applied.from) }} — {{ date(applied.to) }}</small></div><div class="download-controls"><label class="sr-only" for="diagnostic-format">Formato do download</label><select id="diagnostic-format" v-model="format"><option value="gzip">Compactado (.gz)</option><option value="jsonl">Texto (.jsonl)</option></select><button class="btn primary" :disabled="downloading || loading || !loadedAt || Boolean(error)" @click="download"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" /></svg>{{ downloading ? 'Preparando…' : 'Baixar diagnóstico' }}</button></div></div>
        <p class="download-hint">O download inclui todos os eventos do período e dos filtros aplicados, inclusive os que ainda não foram carregados na tela.</p>
        <p v-if="error" class="notice error" role="alert">{{ error }}</p>
        <p v-if="exportError" class="notice error" role="alert">{{ exportError }}</p>
        <div v-if="loading" class="empty-state" role="status"><AppIcon name="refresh" :size="26" /><strong>Consultando o histórico…</strong></div>
        <div v-else-if="!events.length && !error" class="empty-state"><AppIcon name="audit" :size="28" /><strong>Nenhum evento neste intervalo</strong><p>Amplie o período ou reproduza a operação e atualize a consulta.</p></div>
        <div v-else-if="events.length" class="event-table-wrap">
          <table class="event-table"><thead><tr><th>Horário</th><th>Nível</th><th>Evento</th><th>Correlação</th><th><span class="sr-only">Detalhes</span></th></tr></thead><tbody><tr v-for="event in events" :key="event.id"><td class="timestamp">{{ date(event.timestamp) }}</td><td><span class="level-badge" :class="event.level">{{ levels[event.level] || event.level }}</span></td><td class="event-description"><span class="event-category">{{ categories[event.category] || event.category }}<template v-if="event.component"> · {{ event.component }}</template></span><strong>{{ event.summary || event.code }}</strong><code>{{ event.code }}</code></td><td class="correlation"><button v-if="event.traceId" type="button" @click="filterId('traceId', event.traceId)" :title="`Filtrar rastreio ${event.traceId}`">Rastreio <code>{{ event.traceId }}</code></button><button v-if="event.callId" type="button" @click="filterId('callId', event.callId)" :title="`Filtrar chamada ${event.callId}`">Chamada <code>{{ event.callId }}</code></button><button v-if="event.instanceId" type="button" @click="filterId('instanceId', event.instanceId)" :title="`Filtrar instância ${event.instanceId}`">Instância <code>{{ event.instanceId }}</code></button><span v-if="!event.traceId && !event.callId && !event.instanceId">—</span></td><td><button class="btn ghost compact" @click="openDetails(event)">Detalhes</button></td></tr></tbody></table>
        </div>
        <div v-if="cursor && !loading" class="load-more"><button class="btn ghost" :disabled="loadingMore" @click="more">{{ loadingMore ? 'Carregando…' : 'Carregar mais eventos' }}</button></div>
      </section>

      <section class="diagnostic-panel settings-panel"><button class="settings-heading" :aria-expanded="showSettings" aria-controls="diagnostic-settings" @click="showSettings = !showSettings"><span><AppIcon name="settings" :size="18" /><strong>Retenção do diagnóstico</strong></span><span>{{ showSettings ? 'Recolher' : 'Ajustar limites' }}</span></button><div v-if="showSettings" id="diagnostic-settings" class="settings-body"><p>O diagnóstico funciona automaticamente. Os registros mais antigos expiram conforme o período e o espaço disponível. Reduzir os limites pode remover registros antigos; baixe o histórico antes, se precisar preservá-lo.</p><form class="settings-form" @submit.prevent="saveSettings"><label>Manter por quantos dias<input v-model.number="retentionDays" type="number" min="1" max="30" step="1" required /></label><label>Espaço máximo (MB)<input v-model.number="maxDiskMB" type="number" min="32" max="512" step="1" required /></label><button class="btn primary" :disabled="saving">{{ saving ? 'Salvando…' : 'Salvar limites' }}</button></form><p v-if="settingsError" class="notice error" role="alert">{{ settingsError }}</p><p v-if="settingsSuccess" class="notice success" role="status">{{ settingsSuccess }}</p></div></section>
    </div>
    <Teleport to="body"><div v-if="selected" class="diagnostic-drawer-backdrop" @mousedown.self="closeDetails"><section ref="drawer" class="diagnostic-drawer" role="dialog" aria-modal="true" aria-labelledby="diagnostic-event-title" tabindex="-1" @keydown="drawerKeys"><header><div><span class="level-badge" :class="selected.level">{{ levels[selected.level] }}</span><h2 id="diagnostic-event-title">Detalhes do evento</h2><p>{{ date(selected.timestamp) }}</p></div><button class="icon-button" aria-label="Fechar detalhes" @click="closeDetails"><AppIcon name="close" /></button></header><div class="drawer-content"><h3>{{ selected.summary || selected.code }}</h3><code>{{ selected.code }}</code><dl><template v-if="selected.traceId"><dt>Rastreio</dt><dd><button @click="filterId('traceId', selected.traceId)">{{ selected.traceId }}</button></dd></template><template v-if="selected.callId"><dt>Chamada</dt><dd><button @click="filterId('callId', selected.callId)">{{ selected.callId }}</button></dd></template><template v-if="selected.instanceId"><dt>Instância</dt><dd><button @click="filterId('instanceId', selected.instanceId)">{{ selected.instanceId }}</button></dd></template></dl><div class="payload-heading"><h4>Registro técnico</h4><button class="btn ghost compact" @click="copyEvent">{{ copied ? 'Copiado' : 'Copiar registro' }}</button></div><pre>{{ JSON.stringify(selected, null, 2) }}</pre></div></section></div></Teleport>
  </AppShell>
</template>

<style scoped>
.runtime-meta{font-size:11px;color:var(--muted);margin:0}.diagnostics{display:grid;gap:20px}.diagnostics :deep(.page-header){margin-bottom:0}.privacy-note{display:flex;gap:14px;align-items:flex-start;background:var(--primary-soft);border:1px solid var(--border);border-radius:14px;padding:17px 20px;color:var(--primary)}.privacy-note strong{font-size:14px}.privacy-note p{color:var(--muted);font-size:13px;line-height:1.6;margin:4px 0 0}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}.diagnostic-metric{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:19px 18px;display:flex;flex-direction:column;gap:12px;min-width:0}.diagnostic-metric>span{font-size:12px;color:var(--muted);font-weight:600}.diagnostic-metric>strong{font-size:25px;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}.diagnostic-metric em{font-size:12px;color:var(--muted);font-style:normal;font-weight:400}.diagnostic-metric small{color:var(--muted);font-size:11px;line-height:1.5}.diagnostic-metric .capture-state{font-size:15px;align-items:center;min-height:30px;color:var(--success)}.capture-state i{width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0}.diagnostic-metric .attention{color:var(--warning)}.error-count{color:var(--danger)}.warn-count{color:var(--warning);margin-left:6px}.usage-track{height:5px;border-radius:6px;overflow:hidden;background:var(--surface-3)}.usage-track span{display:block;height:100%;background:var(--primary)}.diagnostic-panel{border:1px solid var(--border);border-radius:16px;background:var(--surface);overflow:hidden}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 24px;border-bottom:1px solid var(--border)}.section-heading h2{font-size:17px;margin:0 0 5px}.section-heading p{font-size:12px;color:var(--muted);margin:0;line-height:1.6}.live-toggle{display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap;cursor:pointer}.live-toggle input{width:16px;height:16px;accent-color:var(--primary)}.live-dot{width:6px;height:6px;border-radius:50%;background:var(--muted)}.live-dot.enabled{background:var(--success)}.filter-form{padding:20px 24px;background:var(--surface-2);display:grid;gap:14px;border-bottom:1px solid var(--border)}.filter-main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.filter-ids{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:14px}.diagnostics label:not(.live-toggle){display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:600;min-width:0}.diagnostics input:not([type=checkbox]),.diagnostics select{min-height:41px;width:100%;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:9px;padding:9px 11px;font-size:12px}.filter-ids input{font-family:ui-monospace,monospace}.filter-actions{display:flex;align-items:flex-end;gap:8px}.filter-actions .btn{white-space:nowrap}.results-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 24px 8px;font-size:12px}.results-toolbar strong{font-size:13px}.results-toolbar small{display:block;color:var(--muted);font-size:11px;line-height:1.7;margin-top:3px}.download-controls{display:flex;gap:9px;align-items:center}.download-controls select{width:156px}.download-controls .btn{white-space:nowrap}.download-hint{margin:0;padding:0 24px 18px;color:var(--muted);font-size:11px;line-height:1.5}.notice{padding:13px 16px;border-radius:10px;font-size:13px;line-height:1.6;margin:0}.diagnostic-panel>.notice{margin:0 24px 16px}.notice.error{background:var(--danger-soft);color:var(--danger)}.notice.warning{background:var(--warning-soft);color:var(--warning)}.notice.success{background:var(--success-soft);color:var(--success)}.empty-state{padding:45px 20px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:var(--muted)}.empty-state strong{font-size:14px;color:var(--text)}.empty-state p{font-size:12px;margin:0;text-align:center}.event-table-wrap{overflow:auto}.event-table{width:100%;border-collapse:collapse;text-align:left}.event-table th{font-size:11px;color:var(--muted);font-weight:600;padding:12px 16px;background:var(--surface-2);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.event-table th:first-child,.event-table td:first-child{padding-left:24px}.event-table td{padding:15px 16px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:top}.event-table tbody tr:last-child td{border-bottom:0}.event-table tbody tr:hover{background:var(--surface-2)}.timestamp{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}.level-badge{display:inline-flex;border-radius:6px;padding:4px 7px;font-size:10px;font-weight:700;white-space:nowrap;background:var(--primary-soft);color:var(--primary)}.level-badge.warn{background:var(--warning-soft);color:var(--warning)}.level-badge.error{background:var(--danger-soft);color:var(--danger)}.event-description{min-width:260px;max-width:500px}.event-description strong{display:block;font-size:12px;font-weight:600;line-height:1.6;overflow-wrap:anywhere}.event-category{font-size:10px;color:var(--muted);display:block;margin-bottom:5px}.event-description code{display:block;margin-top:5px;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.correlation{min-width:175px;max-width:225px}.correlation button{background:transparent;border:0;padding:2px 0;display:block;text-align:left;color:var(--muted);font-size:10px;width:100%;cursor:pointer}.correlation code{display:block;color:var(--primary);font-size:10px;overflow-wrap:anywhere}.correlation button:hover code{text-decoration:underline}.load-more{text-align:center;padding:18px;border-top:1px solid var(--border)}.settings-heading{width:100%;display:flex;align-items:center;justify-content:space-between;background:transparent;color:var(--text);border:0;padding:20px 24px;cursor:pointer;font-size:12px}.settings-heading>span:first-child{display:flex;gap:10px;align-items:center;font-size:13px}.settings-heading>span:last-child{color:var(--primary)}.settings-body{border-top:1px solid var(--border);padding:20px 24px}.settings-body>p{color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 17px}.settings-form{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap}.settings-form label{width:200px}.settings-body .notice{margin-top:16px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.diagnostic-drawer-backdrop{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.35);display:flex;justify-content:flex-end}.diagnostic-drawer{width:min(620px,100%);background:var(--surface);color:var(--text);height:100%;overflow:auto;box-shadow:var(--shadow);outline:none}.diagnostic-drawer>header{display:flex;justify-content:space-between;align-items:flex-start;padding:25px;border-bottom:1px solid var(--border)}.diagnostic-drawer h2{font-size:20px;margin:12px 0 6px}.diagnostic-drawer header p{margin:0;color:var(--muted);font-size:12px}.drawer-content{padding:25px}.drawer-content h3{font-size:16px;line-height:1.6;margin:0 0 8px;overflow-wrap:anywhere}.drawer-content>code{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.drawer-content dl{display:grid;gap:7px;margin:23px 0}.drawer-content dt{font-size:11px;color:var(--muted);margin-top:10px}.drawer-content dd{margin:0;overflow-wrap:anywhere}.drawer-content dd button{background:transparent;border:0;padding:0;color:var(--primary);font-size:12px;font-family:ui-monospace,monospace;cursor:pointer;text-align:left;overflow-wrap:anywhere}.payload-heading{display:flex;justify-content:space-between;align-items:center;margin:26px 0 12px}.payload-heading h4{font-size:13px;margin:0}.drawer-content pre{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:17px;font-size:11px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.diagnostics button:focus-visible,.diagnostic-drawer button:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
@media(max-width:1200px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.filter-ids{grid-template-columns:repeat(3,minmax(0,1fr))}.filter-actions{grid-column:1/-1;justify-content:flex-end}.results-toolbar{align-items:flex-start;flex-wrap:wrap}}
@media(max-width:700px){.diagnostics{gap:14px}.metric-grid{gap:10px}.diagnostic-metric{padding:14px}.diagnostic-metric>strong{font-size:20px}.diagnostic-metric .capture-state{font-size:13px}.section-heading{align-items:flex-start;flex-direction:column;padding:18px}.filter-form{padding:18px}.filter-main,.filter-ids{grid-template-columns:1fr}.filter-actions{grid-column:auto}.results-toolbar{padding:18px 18px 8px}.download-controls{width:100%;flex-wrap:wrap}.download-controls .btn{flex:1}.download-hint{padding:0 18px 18px}.settings-heading,.settings-body{padding:18px}.settings-form label{width:100%}.privacy-note{padding:15px}.diagnostic-panel>.notice{margin-left:18px;margin-right:18px}}
</style>
