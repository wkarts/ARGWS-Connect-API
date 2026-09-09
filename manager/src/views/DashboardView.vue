<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import MetricCard from '@/components/MetricCard.vue'
import OperationalChart from '@/components/OperationalChart.vue'
import { operations, type OperationalArchive, type OperationalEvent, type OperationalSnapshot, type OperationalStatistics } from '@/services/operations'

const snapshot = ref<OperationalSnapshot | null>(null)
const statistics = ref<OperationalStatistics | null>(null)
const events = ref<OperationalEvent[]>([])
const archives = ref<OperationalArchive[]>([])
const error = ref(''), busy = ref(false), nextCursor = ref<string | null>(null)
const today = new Date().toLocaleDateString('en-CA')
const from = ref(today), to = ref(today)
const serviceNames: Record<string, string> = { api: 'API', database: 'Banco de dados', cache: 'Cache', events: 'Entrega de eventos', storage: 'Armazenamento', docs: 'Documentação', operations: 'Monitoramento', backup: 'Backup' }
const bytes = (value: number) => `${(value / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
const when = (value?: string) => value ? new Date(value).toLocaleString('pt-BR') : 'Não verificado'
const amount = (value: number | null | undefined, unit = '') => value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`
const message = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível concluir a consulta.'
const label = (value: string) => value.length === 10 ? `${value.slice(8)}/${value.slice(5,7)}` : value
const requestPoints = computed(() => (statistics.value?.series || []).map(p => ({ label: label(p.label), value: p.requests })))
const errorPoints = computed(() => (statistics.value?.series || []).map(p => ({ label: label(p.label), value: p.errors })))
const durationPoints = computed(() => (statistics.value?.series || []).map(p => ({ label: label(p.label), value: p.averageMs })))
const archivePoints = computed(() => (statistics.value?.archives || []).map(p => ({ label: label(p.day), value: p.bytes / 1048576 })))
const axisNote = computed(() => statistics.value ? `Por ${statistics.value.granularity === 'hour' ? 'hora' : 'dia'} · ${statistics.value.timezone}` : 'Aguardando coleta')
const loadedRange = computed(() => statistics.value ? `${statistics.value.from} a ${statistics.value.to}` : 'Nenhum período carregado')
async function loadPeriod() {
  const stats = await operations.statistics(from.value, to.value)
  const history = await operations.history(from.value, to.value)
  statistics.value = stats; events.value = history.events; nextCursor.value = history.nextCursor
}
async function refresh() {
  if (busy.value) return
  busy.value = true; error.value = ''; statistics.value = null
  try {
    snapshot.value = await operations.snapshot()
    archives.value = (await operations.archives()).archives
    await loadPeriod()
  } catch (e) { error.value = message(e) } finally { busy.value = false }
}
async function search(cursor = '') {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    if (!cursor) { statistics.value = null; events.value = []; nextCursor.value = null; await loadPeriod() }
    else {
      const result = await operations.history(statistics.value?.from || from.value, statistics.value?.to || to.value, cursor)
      events.value = result.events; nextCursor.value = result.nextCursor
    }
  } catch (e) { error.value = message(e) } finally { busy.value = false }
}
async function inspectDay(day: string) { from.value = day; to.value = day; await search() }
async function download(day: string) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await operations.download(day) } catch (e) { error.value = message(e) } finally { busy.value = false }
}
onMounted(refresh)
</script>
<template>
  <AppShell>
    <PageHeader title="Visão Geral" description="Saúde da instalação e estatísticas operacionais. Sem conteúdo de conversas." />
    <form class="operations-filter" @submit.prevent="search()">
      <label>De<input v-model="from" type="date" required /></label>
      <label>Até<input v-model="to" type="date" required /></label>
      <button class="btn primary" :disabled="busy || !snapshot">Consultar período</button>
      <button class="btn" type="button" :disabled="busy" @click="refresh">{{ busy ? 'Consultando...' : 'Atualizar' }}</button>
    </form>
    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <div v-if="!snapshot && !busy" class="panel-card muted-block">Nenhum dado operacional disponível. O painel não exibe dados de exemplo.</div>
    <template v-if="snapshot">
      <div class="metric-grid">
        <MetricCard icon="list" title="Requisições no período" :value="amount(statistics?.totals.requests)" hint="Requisições HTTP observadas, não mensagens" />
        <MetricCard icon="heart" title="Erros do servidor" :value="amount(statistics?.totals.errors)" :hint="`HTTP 5xx · Taxa: ${amount(statistics?.totals.errorRate, '%')}`" />
        <MetricCard icon="refresh" title="Tempo médio de resposta" :value="amount(statistics?.totals.averageMs, ' ms')" hint="Tempo HTTP ponderado pelo número de requisições" />
        <MetricCard icon="settings" title="Espaço dos registros" :value="bytes(snapshot.diskBytes)" :hint="`Uso atual · Limite: ${bytes(snapshot.maxDiskBytes)}`" />
      </div>
      <div class="operations-period"><span>{{ loadedRange }} · {{ axisNote }}</span><span>Atualizado: {{ when(statistics?.generatedAt) }}</span></div>
      <div v-if="statistics?.incomplete" class="alert error">Há intervalos sem coleta neste período. Os gráficos mostram somente os dados recebidos; não representam cobertura integral.</div>
      <div class="operations-chart-grid" :aria-busy="busy">
        <PanelCard title="Requisições" :description="axisNote"><OperationalChart title="Requisições por intervalo" :points="requestPoints" /></PanelCard>
        <PanelCard title="Erros HTTP 5xx" description="Falhas observadas no atendimento das requisições"><OperationalChart title="Erros do servidor por intervalo" :points="errorPoints" /></PanelCard>
        <PanelCard title="Tempo médio de resposta" description="Milissegundos · Lacunas não são interpoladas"><OperationalChart title="Tempo médio HTTP" :points="durationPoints" kind="line" unit="ms" /></PanelCard>
        <PanelCard title="Tamanho dos arquivos por dia" description="Tamanho atual dos arquivos recentes ou compactados do período"><OperationalChart title="Tamanho dos arquivos diários" :points="archivePoints" unit="MB" /></PanelCard>
      </div>
      <p class="operations-note">Sem amostras, o intervalo fica sem dados — não é tratado como zero. A coleta é operacional e não representa contagem de mensagens, disponibilidade garantida ou tempo de áudio.</p>
      <div v-if="snapshot.maintenanceError || snapshot.dropped" class="alert error">O monitoramento precisa de atenção. Verifique armazenamento, arquivamento e registros não coletados: {{ snapshot.dropped }}.</div>
      <PanelCard title="Status dos serviços" :description="`Última coleta: ${when(snapshot.checkedAt)}. Acessibilidade não comprova integridade dos dados.`">
        <div class="operations-services">
          <div v-for="service in snapshot.services" :key="service.key" class="operations-service">
            <strong>{{ serviceNames[service.key] || 'Serviço' }}</strong>
            <span :class="['operations-status', service.status]">{{ service.status === 'reachable' ? 'Acessível' : service.status === 'unavailable' ? 'Indisponível' : 'Não verificado' }}</span>
            <small>{{ service.type === 'tcp' ? 'Conectividade' : 'Verificação de resposta' }} · {{ service.durationMs }} ms · {{ when(service.checkedAt) }}</small>
          </div>
          <p v-if="!snapshot.services.length" class="muted">Nenhuma verificação configurada.</p>
        </div>
      </PanelCard>
      <PanelCard title="Eventos da operação" description="Até 31 dias por consulta. Registros arquivados são lidos sem retornar ao banco.">
        <div class="operations-table-wrap"><table class="operations-table">
          <thead><tr><th>Data e hora</th><th>Serviço</th><th>Evento</th><th>Dados técnicos</th></tr></thead>
          <tbody><tr v-for="event in events" :key="event.id">
            <td>{{ when(event.timestamp) }}</td><td>{{ serviceNames[event.service || 'operations'] || 'Operação' }}</td><td>{{ event.title }}</td>
            <td><span v-if="event.count !== undefined">Quantidade: {{ event.count }}</span><span v-if="event.errors !== undefined"> · Falhas: {{ event.errors }}</span></td>
          </tr></tbody>
        </table></div>
        <div v-if="!events.length" class="muted-block">Nenhum evento registrado no período consultado.</div>
        <button v-if="nextCursor" class="btn" :disabled="busy" @click="search(nextCursor)">Próxima página</button>
      </PanelCard>
      <PanelCard title="Arquivos diários" description="Somente registros operacionais. Não contém mensagens, contatos, fotos, áudio, QR ou credenciais.">
        <div class="operations-table-wrap"><table class="operations-table">
          <thead><tr><th>Dia</th><th>Estado</th><th>Tamanho</th><th>Verificação</th><th>Ações</th></tr></thead>
          <tbody><tr v-for="archive in archives" :key="archive.day">
            <td>{{ archive.day }}</td><td>{{ archive.archived ? 'Compactado' : 'Registro recente' }}</td><td>{{ bytes(archive.bytes) }}</td><td>{{ when(archive.verifiedAt) }}</td>
            <td><button class="btn compact" :disabled="busy" @click="inspectDay(archive.day)">Consultar</button> <button class="btn compact" :disabled="busy" @click="download(archive.day)">Baixar registro</button></td>
          </tr></tbody>
        </table></div>
        <p v-if="!archives.length" class="muted-block">Nenhum arquivo disponível.</p>
      </PanelCard>
    </template>
  </AppShell>
</template>
<style scoped>
.panel-card { margin-bottom:18px }
.operations-period { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; color:var(--muted,#64748b); font-size:12px; margin:14px 0 }
.operations-chart-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px }
.operations-chart-grid .panel-card { margin:0; min-width:0 }
.operations-note { color:var(--muted,#64748b); font-size:12px; margin:14px 0 20px }
.operations-services { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px }
.operations-service { display:flex; flex-direction:column; gap:6px }
.operations-status { font-size:12px; font-weight:600 }
.operations-status.reachable { color:var(--success,#15803d) }
.operations-status.unavailable { color:var(--danger,#dc2626) }
.operations-filter { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin:12px 0 16px }
.operations-filter label { display:flex; flex-direction:column; gap:6px }
.operations-filter input { padding:8px; border:1px solid var(--border,#dbe4ef); border-radius:8px; background:transparent; color:inherit }
.operations-table-wrap { overflow:auto; max-height:480px }
.operations-table { width:100%; border-collapse:collapse; text-align:left }
.operations-table th,.operations-table td { padding:10px; border-bottom:1px solid var(--border,#dbe4ef); vertical-align:top }
.operations-table th { font-weight:600 }
@media(max-width:1000px) { .operations-chart-grid { grid-template-columns:1fr } }
@media(max-width:640px) { .operations-filter label,.operations-filter button { width:100% } }
</style>
