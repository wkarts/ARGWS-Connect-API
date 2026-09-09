<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import MetricCard from '@/components/MetricCard.vue'
import { operations, type OperationalArchive, type OperationalEvent, type OperationalSnapshot } from '@/services/operations'

const snapshot = ref<OperationalSnapshot | null>(null)
const events = ref<OperationalEvent[]>([])
const archives = ref<OperationalArchive[]>([])
const error = ref(''), busy = ref(false), nextCursor = ref<string | null>(null)
const today = new Date().toLocaleDateString('en-CA')
const from = ref(today), to = ref(today)
const serviceNames: Record<string, string> = { api: 'API', database: 'Banco de dados', cache: 'Cache', events: 'Entrega de eventos', storage: 'Armazenamento', docs: 'Documentação', operations: 'Monitoramento', backup: 'Backup' }
const bytes = (value: number) => `${(value / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
const when = (value?: string) => value ? new Date(value).toLocaleString('pt-BR') : 'Não verificado'
const message = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível concluir a consulta.'
async function refresh() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    snapshot.value = await operations.snapshot()
    archives.value = (await operations.archives()).archives
    const history = await operations.history(from.value, to.value)
    events.value = history.events
    nextCursor.value = history.nextCursor
  } catch (e) { error.value = message(e) } finally { busy.value = false }
}
async function search(cursor = '') {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = await operations.history(from.value, to.value, cursor)
    events.value = result.events; nextCursor.value = result.nextCursor
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
    <PageHeader title="Visão Geral" description="Saúde da instalação e eventos operacionais. Sem conteúdo de conversas." />
    <div class="operations-toolbar"><button class="btn" :disabled="busy" @click="refresh">{{ busy ? 'Consultando...' : 'Atualizar' }}</button></div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="!snapshot && !busy" class="panel-card muted-block">Nenhum dado operacional disponível. O painel não exibe dados de exemplo.</div>
    <template v-if="snapshot">
      <div class="metric-grid">
        <MetricCard icon="heart" title="Serviços verificados" :value="String(snapshot.services.length)" hint="Verificações técnicas, não conversas" />
        <MetricCard icon="list" title="Dias no histórico" :value="String(archives.length)" />
        <MetricCard icon="settings" title="Espaço dos registros" :value="bytes(snapshot.diskBytes)" :hint="`Limite: ${bytes(snapshot.maxDiskBytes)}`" />
        <MetricCard icon="refresh" title="Tempo ativo do monitor" :value="`${Math.floor(snapshot.uptimeSeconds / 60)} min`" :hint="`Coleta: ${when(snapshot.checkedAt)}`" />
      </div>
      <div v-if="snapshot.maintenanceError || snapshot.dropped" class="alert error">O monitoramento precisa de atenção. Verifique armazenamento, arquivamento e registros não coletados: {{ snapshot.dropped }}.</div>
      <PanelCard title="Status dos serviços" description="Acessibilidade medida. Uma porta acessível não comprova a integridade dos dados.">
        <div class="operations-services">
          <div v-for="service in snapshot.services" :key="service.key" class="operations-service">
            <strong>{{ serviceNames[service.key] || 'Serviço' }}</strong>
            <span>{{ service.status === 'reachable' ? 'Acessível' : service.status === 'unavailable' ? 'Indisponível' : 'Não verificado' }}</span>
            <small>{{ service.type === 'tcp' ? 'Conectividade' : 'Verificação de resposta' }} · {{ service.durationMs }} ms · {{ when(service.checkedAt) }}</small>
          </div>
          <p v-if="!snapshot.services.length" class="muted">Nenhuma verificação configurada.</p>
        </div>
      </PanelCard>
      <PanelCard title="Eventos da operação" description="Consulte até 31 dias por vez. O histórico arquivado é lido sem restaurar registros no banco.">
        <form class="operations-filter" @submit.prevent="search()">
          <label>De<input v-model="from" type="date" required /></label>
          <label>Até<input v-model="to" type="date" required /></label>
          <button class="btn primary" :disabled="busy">Consultar período</button>
        </form>
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
      <PanelCard title="Arquivos diários" description="Somente registros operacionais permitidos. Não contém mensagens, contatos, fotos, áudio, QR ou credenciais.">
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
.operations-toolbar { display:flex; justify-content:flex-end; margin-bottom:16px }
.panel-card { margin-bottom:18px }
.operations-services { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px }
.operations-service { display:flex; flex-direction:column; gap:6px }
.operations-filter { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px }
.operations-filter label { display:flex; flex-direction:column; gap:6px }
.operations-filter input { padding:8px; border:1px solid var(--border,#dbe4ef); border-radius:8px; background:transparent; color:inherit }
.operations-table-wrap { overflow:auto; max-height:480px }
.operations-table { width:100%; border-collapse:collapse; text-align:left }
.operations-table th,.operations-table td { padding:10px; border-bottom:1px solid var(--border,#dbe4ef); vertical-align:top }
.operations-table th { font-weight:600 }
.operations-table small { white-space:nowrap }
@media(max-width:640px) { .operations-filter label,.operations-filter button { width:100% } }
</style>
