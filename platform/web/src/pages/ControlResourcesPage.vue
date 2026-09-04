<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Activity,
  Boxes,
  Database,
  FolderPlus,
  Gauge,
  HardDrive,
  Play,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  ShieldAlert,
  Trash2,
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { useAuthStore } from '../stores/auth'
import type { ApiResponse } from '../types'
import { appPrompt } from '../composables/useAppDialog'

type Tab = 'S3' | 'POSTGRES' | 'PROMETHEUS' | 'GRAFANA' | 'CATALOG'

interface CatalogEntry {
  code: string
  name: string
  management: string
  path: string
  category: string
}

interface BucketItem {
  name: string
  creation_date?: string | null
  versioning: string
  managed: boolean
}

interface BucketObject {
  key: string
  size: number
  etag: string
  last_modified?: string | null
  storage_class?: string | null
}

interface BucketObjectsPage {
  bucket: string
  prefix: string
  objects: BucketObject[]
  has_more: boolean
  next_token?: string | null
}

interface PgDatabase {
  datname: string
  owner: string
  size_bytes: number
  connections: number
  xact_commit: number
  xact_rollback: number
  datallowconn: boolean
  managed: boolean
}

interface PgRole {
  rolname: string
  rolsuper: boolean
  rolcreaterole: boolean
  rolcreatedb: boolean
  rolcanlogin: boolean
  rolconnlimit: number
  rolvaliduntil?: string | null
}

interface PgSession {
  pid: number
  datname?: string | null
  usename?: string | null
  application_name?: string | null
  client_addr?: string | null
  state?: string | null
  wait_event_type?: string | null
  wait_event?: string | null
  query_start?: string | null
  query?: string | null
  managed: boolean
}

interface PgOverview {
  server: { version: string; current_user: string; max_connections: number }
  databases: PgDatabase[]
  roles: PgRole[]
}

interface PrometheusOverview {
  health: { enabled: boolean; healthy: boolean; ready: boolean; base_url?: string }
  targets: { activeTargets?: Array<Record<string, any>>; droppedTargets?: Array<Record<string, any>> }
  alerts: { alerts?: Array<Record<string, any>> }
  rules: { groups?: Array<Record<string, any>> }
  runtime: Record<string, any>
  build: Record<string, any>
}

interface GrafanaOverview {
  health: { healthy: boolean; base_url: string; details?: Record<string, any> }
  admin_configured: boolean
  dashboards: Array<Record<string, any>>
  folders: Array<Record<string, any>>
  datasources: Array<Record<string, any>>
}

const auth = useAuthStore()
const activeTab = ref<Tab>('S3')
const loading = ref(false)
const error = ref('')
const success = ref('')
const catalog = ref<CatalogEntry[]>([])

const buckets = ref<BucketItem[]>([])
const selectedBucket = ref('')
const bucketObjects = ref<BucketObjectsPage | null>(null)
const objectPrefix = ref('')
const newBucket = ref('')

const postgres = ref<PgOverview | null>(null)
const pgSessions = ref<PgSession[]>([])
const pgLocks = ref<Array<Record<string, any>>>([])
const maintenanceOperation = ref<Record<string, 'ANALYZE' | 'VACUUM_ANALYZE' | 'REINDEX_DATABASE'>>({})

const prometheus = ref<PrometheusOverview | null>(null)
const promQuery = ref('up')
const promResult = ref<Record<string, any> | null>(null)

const grafana = ref<GrafanaOverview | null>(null)
const newFolderTitle = ref('')
const newFolderUid = ref('')
const dashboardJson = ref('')

const isSuperadmin = computed(() => auth.user?.role === 'PLATFORM_SUPERADMIN')
const managedDbCount = computed(() => postgres.value?.databases.filter(item => item.managed).length || 0)
const activeTargetCount = computed(() => prometheus.value?.targets?.activeTargets?.length || 0)
const firingAlertCount = computed(() => (prometheus.value?.alerts?.alerts || []).filter(item => String(item.state || '').toLowerCase() === 'firing').length)

function feedbackOk(message: string) {
  error.value = ''
  success.value = message
}

function feedbackError(value: unknown) {
  success.value = ''
  error.value = apiError(value)
}

function bytes(value: number | undefined | null): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unit = 0
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024
    unit++
  }
  return `${current.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${units[unit]}`
}

async function exactConfirmation(expected: string, description: string): Promise<string | null> {
  return await appPrompt({ title: 'Confirmação avançada', message: description, inputLabel: `Digite exatamente: ${expected}`, placeholder: expected, confirmLabel: 'Confirmar operação', cancelLabel: 'Cancelar', tone: 'danger', required: true })
}

async function loadCatalog() {
  const response = await api.get<ApiResponse<CatalogEntry[]>>('/control/v1/resources/catalog')
  catalog.value = response.data.data
}

async function loadS3() {
  const response = await api.get<ApiResponse<BucketItem[]>>('/control/v1/resources/s3/buckets')
  buckets.value = response.data.data
  if (selectedBucket.value && !buckets.value.some(item => item.name === selectedBucket.value)) {
    selectedBucket.value = ''
    bucketObjects.value = null
  }
}

async function loadBucketObjects(bucket = selectedBucket.value) {
  if (!bucket) return
  selectedBucket.value = bucket
  const response = await api.get<ApiResponse<BucketObjectsPage>>(`/control/v1/resources/s3/buckets/${encodeURIComponent(bucket)}/objects`, {
    params: { prefix: objectPrefix.value, limit: 250 },
  })
  bucketObjects.value = response.data.data
}

async function createBucket() {
  if (!newBucket.value.trim()) return
  try {
    loading.value = true
    await api.post('/control/v1/resources/s3/buckets', { name: newBucket.value.trim() })
    feedbackOk('Bucket criado com sucesso.')
    newBucket.value = ''
    await loadS3()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function setBucketVersioning(bucket: BucketItem, enabled: boolean) {
  try {
    loading.value = true
    await api.patch(`/control/v1/resources/s3/buckets/${encodeURIComponent(bucket.name)}/versioning`, { enabled })
    feedbackOk(`Versionamento ${enabled ? 'ativado' : 'suspenso'} em ${bucket.name}.`)
    await loadS3()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function deleteBucket(bucket: BucketItem) {
  const confirm = await exactConfirmation(bucket.name, 'A exclusão somente será aceita para bucket vazio.')
  if (confirm === null) return
  try {
    loading.value = true
    await api.delete(`/control/v1/resources/s3/buckets/${encodeURIComponent(bucket.name)}`, { data: { confirm } })
    feedbackOk(`Bucket ${bucket.name} excluído.`)
    await loadS3()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function deleteObject(item: BucketObject) {
  if (!selectedBucket.value) return
  const confirm = await exactConfirmation(item.key, 'A exclusão do objeto é permanente para versões não protegidas.')
  if (confirm === null) return
  try {
    loading.value = true
    const key = item.key.split('/').map(encodeURIComponent).join('/')
    await api.delete(`/control/v1/resources/s3/buckets/${encodeURIComponent(selectedBucket.value)}/objects/${key}`, { data: { confirm } })
    feedbackOk(`Objeto ${item.key} removido.`)
    await loadBucketObjects()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function loadPostgres() {
  const [overview, sessions, locks] = await Promise.all([
    api.get<ApiResponse<PgOverview>>('/control/v1/resources/postgres'),
    api.get<ApiResponse<PgSession[]>>('/control/v1/resources/postgres/sessions'),
    api.get<ApiResponse<Array<Record<string, any>>>>('/control/v1/resources/postgres/locks'),
  ])
  postgres.value = overview.data.data
  pgSessions.value = sessions.data.data
  pgLocks.value = locks.data.data
}

async function maintainDatabase(database: PgDatabase) {
  const operation = maintenanceOperation.value[database.datname] || 'ANALYZE'
  const confirm = await exactConfirmation(database.datname, `Executar ${operation} em ${database.datname}.`)
  if (confirm === null) return
  try {
    loading.value = true
    await api.post(`/control/v1/resources/postgres/databases/${encodeURIComponent(database.datname)}/maintenance`, { operation, confirm })
    feedbackOk(`${operation} concluído em ${database.datname}.`)
    await loadPostgres()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function terminateSession(session: PgSession) {
  const expected = String(session.pid)
  const confirm = await exactConfirmation(expected, `Encerrar a sessão PID ${session.pid} em ${session.datname || 'PostgreSQL'}.`)
  if (confirm === null) return
  try {
    loading.value = true
    await api.post(`/control/v1/resources/postgres/sessions/${session.pid}/terminate`, { confirm })
    feedbackOk(`Sessão ${session.pid} encerrada.`)
    await loadPostgres()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function loadPrometheus() {
  const response = await api.get<ApiResponse<PrometheusOverview>>('/control/v1/resources/prometheus')
  prometheus.value = response.data.data
}

async function executePromQuery() {
  if (!promQuery.value.trim()) return
  try {
    loading.value = true
    const response = await api.post<ApiResponse<Record<string, any>>>('/control/v1/resources/prometheus/query', { expression: promQuery.value.trim() })
    promResult.value = response.data.data
    feedbackOk('Consulta PromQL executada.')
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function reloadPrometheus() {
  const confirm = await exactConfirmation('PROMETHEUS', 'Recarregar a configuração ativa do Prometheus.')
  if (confirm === null) return
  try {
    loading.value = true
    await api.post('/control/v1/resources/prometheus/reload', { confirm })
    feedbackOk('Configuração do Prometheus recarregada.')
    await loadPrometheus()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function loadGrafana() {
  const response = await api.get<ApiResponse<GrafanaOverview>>('/control/v1/resources/grafana')
  grafana.value = response.data.data
}

async function createGrafanaFolder() {
  if (!newFolderTitle.value.trim()) return
  try {
    loading.value = true
    await api.post('/control/v1/resources/grafana/folders', {
      title: newFolderTitle.value.trim(),
      uid: newFolderUid.value.trim() || undefined,
    })
    feedbackOk('Pasta Grafana criada.')
    newFolderTitle.value = ''
    newFolderUid.value = ''
    await loadGrafana()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function deleteGrafanaFolder(folder: Record<string, any>) {
  const uid = String(folder.uid || '')
  if (!uid) return
  const confirm = await exactConfirmation(uid, `Excluir a pasta Grafana ${String(folder.title || uid)}.`)
  if (confirm === null) return
  try {
    loading.value = true
    await api.delete(`/control/v1/resources/grafana/folders/${encodeURIComponent(uid)}`, { data: { confirm } })
    feedbackOk('Pasta Grafana removida.')
    await loadGrafana()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function editDashboard(uid: string) {
  try {
    const response = await api.get<ApiResponse<Record<string, any>>>(`/control/v1/resources/grafana/dashboards/${encodeURIComponent(uid)}`)
    const data = response.data.data
    dashboardJson.value = JSON.stringify({ dashboard: data.dashboard, folderUid: data.meta?.folderUid, overwrite: true }, null, 2)
  } catch (value) { feedbackError(value) }
}

async function saveDashboard() {
  try {
    loading.value = true
    const parsed = JSON.parse(dashboardJson.value || '{}')
    await api.put('/control/v1/resources/grafana/dashboards', parsed)
    feedbackOk('Dashboard Grafana salvo.')
    await loadGrafana()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function deleteDashboard(item: Record<string, any>) {
  const uid = String(item.uid || '')
  if (!uid) return
  const confirm = await exactConfirmation(uid, `Excluir o dashboard ${String(item.title || uid)}.`)
  if (confirm === null) return
  try {
    loading.value = true
    await api.delete(`/control/v1/resources/grafana/dashboards/${encodeURIComponent(uid)}`, { data: { confirm } })
    feedbackOk('Dashboard Grafana removido.')
    await loadGrafana()
  } catch (value) { feedbackError(value) } finally { loading.value = false }
}

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([loadCatalog(), loadS3(), loadPostgres(), loadPrometheus(), loadGrafana()])
  } catch (value) {
    feedbackError(value)
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="space-y-5">
    <PageHeader title="Recursos da plataforma" description="Administração central de storage, bancos, observabilidade e serviços operacionais pelo Control Plane.">
      <template #actions>
        <button class="btn-secondary" :disabled="loading" @click="loadAll"><RefreshCw :size="16" :class="loading ? 'animate-spin' : ''" /> Atualizar</button>
      </template>
    </PageHeader>

    <InlineAlert v-if="error" type="error" :message="error" />
    <InlineAlert v-if="success" type="success" :message="success" />

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <div class="card p-4"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Buckets</p><p class="mt-1 text-2xl font-bold text-slate-900">{{ buckets.length }}</p><p class="text-xs text-slate-500">S3 / MinIO</p></div>
      <div class="card p-4"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bancos gerenciados</p><p class="mt-1 text-2xl font-bold text-slate-900">{{ managedDbCount }}</p><p class="text-xs text-slate-500">PostgreSQL</p></div>
      <div class="card p-4"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Targets</p><p class="mt-1 text-2xl font-bold text-slate-900">{{ activeTargetCount }}</p><p class="text-xs text-slate-500">Prometheus</p></div>
      <div class="card p-4"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Alertas firing</p><p class="mt-1 text-2xl font-bold" :class="firingAlertCount ? 'text-rose-600' : 'text-slate-900'">{{ firingAlertCount }}</p><p class="text-xs text-slate-500">Observabilidade</p></div>
      <div class="card p-4"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Grafana</p><p class="mt-1 text-2xl font-bold" :class="grafana?.health.healthy ? 'text-emerald-600' : 'text-rose-600'">{{ grafana?.health.healthy ? 'OK' : 'OFF' }}</p><p class="text-xs text-slate-500">{{ grafana?.dashboards.length || 0 }} dashboards</p></div>
    </div>

    <div class="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">
      <button v-for="tab in (['S3','POSTGRES','PROMETHEUS','GRAFANA','CATALOG'] as Tab[])" :key="tab" class="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition" :class="activeTab === tab ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="activeTab = tab">
        {{ tab === 'S3' ? 'S3 / MinIO' : tab === 'POSTGRES' ? 'PostgreSQL' : tab === 'CATALOG' ? 'Todos os recursos' : tab[0] + tab.slice(1).toLowerCase() }}
      </button>
    </div>

    <section v-if="activeTab === 'S3'" class="space-y-4">
      <div class="card p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 class="font-semibold text-slate-900">Buckets</h2><p class="text-xs text-slate-500">Inventário real do endpoint S3 configurado na plataforma.</p></div>
          <div v-if="isSuperadmin" class="flex gap-2"><input v-model="newBucket" class="input min-w-64" placeholder="novo-bucket" /><button class="btn-primary" :disabled="loading || !newBucket.trim()" @click="createBucket"><HardDrive :size="15" /> Criar</button></div>
        </div>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-slate-200 text-slate-500"><tr><th class="p-2">Bucket</th><th class="p-2">Versionamento</th><th class="p-2">Gerenciado</th><th class="p-2">Criado</th><th class="p-2 text-right">Ações</th></tr></thead>
            <tbody>
              <tr v-for="bucket in buckets" :key="bucket.name" class="border-b border-slate-100 last:border-0">
                <td class="p-2"><button class="font-semibold text-blue-700 hover:underline" @click="loadBucketObjects(bucket.name)">{{ bucket.name }}</button></td>
                <td class="p-2"><StatusBadge :status="bucket.versioning === 'Enabled' ? 'ACTIVE' : 'DISABLED'" :label="bucket.versioning" /></td>
                <td class="p-2">{{ bucket.managed ? 'Sim' : 'Externo' }}</td>
                <td class="p-2 text-slate-500">{{ bucket.creation_date || '—' }}</td>
                <td class="p-2"><div v-if="isSuperadmin" class="flex justify-end gap-1"><button class="btn-ghost text-[11px]" @click="setBucketVersioning(bucket, bucket.versioning !== 'Enabled')">{{ bucket.versioning === 'Enabled' ? 'Suspender versão' : 'Ativar versão' }}</button><button class="btn-ghost text-rose-600" @click="deleteBucket(bucket)"><Trash2 :size="14" /></button></div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="selectedBucket" class="card p-4">
        <div class="flex flex-wrap items-center gap-2"><h2 class="font-semibold">Objetos · {{ selectedBucket }}</h2><div class="ml-auto flex gap-2"><input v-model="objectPrefix" class="input" placeholder="Prefixo" @keyup.enter="loadBucketObjects()" /><button class="btn-secondary" @click="loadBucketObjects()"><Search :size="14" /> Buscar</button></div></div>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-xs"><thead class="border-b border-slate-200 text-slate-500"><tr><th class="p-2">Chave</th><th class="p-2">Tamanho</th><th class="p-2">Atualizado</th><th class="p-2">ETag</th><th class="p-2"></th></tr></thead><tbody>
            <tr v-for="item in bucketObjects?.objects || []" :key="item.key" class="border-b border-slate-100"><td class="max-w-xl break-all p-2 font-mono">{{ item.key }}</td><td class="p-2">{{ bytes(item.size) }}</td><td class="p-2 text-slate-500">{{ item.last_modified || '—' }}</td><td class="p-2 font-mono text-slate-400">{{ item.etag }}</td><td class="p-2 text-right"><button v-if="isSuperadmin" class="btn-ghost text-rose-600" @click="deleteObject(item)"><Trash2 :size="14" /></button></td></tr>
          </tbody></table>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'POSTGRES'" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-3"><div class="card p-4"><p class="text-xs text-slate-500">Versão</p><p class="mt-1 font-semibold">{{ postgres?.server.version || '—' }}</p></div><div class="card p-4"><p class="text-xs text-slate-500">Usuário administrativo</p><p class="mt-1 font-semibold">{{ postgres?.server.current_user || '—' }}</p></div><div class="card p-4"><p class="text-xs text-slate-500">Max connections</p><p class="mt-1 font-semibold">{{ postgres?.server.max_connections || 0 }}</p></div></div>
      <div class="card overflow-hidden"><div class="border-b border-slate-200 p-4"><h2 class="font-semibold">Bancos</h2><p class="text-xs text-slate-500">Operações destrutivas são limitadas a bancos do Control Plane e tenants.</p></div><div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-3">Banco</th><th class="p-3">Owner</th><th class="p-3">Tamanho</th><th class="p-3">Conexões</th><th class="p-3">Commits</th><th class="p-3">Ações</th></tr></thead><tbody>
        <tr v-for="db in postgres?.databases || []" :key="db.datname" class="border-t border-slate-100"><td class="p-3"><div class="flex items-center gap-2"><Database :size="15"/><span class="font-semibold">{{ db.datname }}</span><StatusBadge v-if="db.managed" status="ACTIVE" label="Gerenciado" /></div></td><td class="p-3">{{ db.owner }}</td><td class="p-3">{{ bytes(db.size_bytes) }}</td><td class="p-3">{{ db.connections }}</td><td class="p-3">{{ Number(db.xact_commit || 0).toLocaleString('pt-BR') }}</td><td class="p-3"><div v-if="isSuperadmin && db.managed" class="flex gap-2"><select v-model="maintenanceOperation[db.datname]" class="input py-1 text-xs"><option value="ANALYZE">ANALYZE</option><option value="VACUUM_ANALYZE">VACUUM ANALYZE</option><option value="REINDEX_DATABASE">REINDEX DATABASE</option></select><button class="btn-secondary py-1 text-xs" @click="maintainDatabase(db)"><Play :size="13" /> Executar</button></div></td></tr>
      </tbody></table></div></div>
      <div class="card overflow-hidden"><div class="border-b border-slate-200 p-4"><h2 class="font-semibold">Sessões ativas</h2><p class="text-xs text-slate-500">{{ pgSessions.length }} sessões · {{ pgLocks.length }} locks observados.</p></div><div class="max-h-[34rem] overflow-auto"><table class="w-full text-left text-xs"><thead class="sticky top-0 bg-slate-50 text-slate-500"><tr><th class="p-3">PID</th><th class="p-3">Banco / usuário</th><th class="p-3">Estado</th><th class="p-3">Query</th><th class="p-3"></th></tr></thead><tbody><tr v-for="session in pgSessions" :key="session.pid" class="border-t border-slate-100"><td class="p-3 font-mono">{{ session.pid }}</td><td class="p-3"><p class="font-medium">{{ session.datname || '—' }}</p><p class="text-slate-400">{{ session.usename || '—' }}</p></td><td class="p-3"><StatusBadge :status="session.state === 'active' ? 'ACTIVE' : 'PENDING'" :label="session.state || '—'" /></td><td class="max-w-2xl truncate p-3 font-mono text-slate-500" :title="session.query || ''">{{ session.query || '—' }}</td><td class="p-3 text-right"><button v-if="isSuperadmin && session.managed" class="btn-ghost text-rose-600" title="Encerrar sessão" @click="terminateSession(session)"><Trash2 :size="14" /></button></td></tr></tbody></table></div></div>
    </section>

    <section v-else-if="activeTab === 'PROMETHEUS'" class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-3"><div class="card p-4"><p class="text-xs text-slate-500">Health</p><div class="mt-2"><StatusBadge :status="prometheus?.health.healthy ? 'HEALTHY' : 'ERROR'" :label="prometheus?.health.healthy ? 'Healthy' : 'Indisponível'" /></div></div><div class="card p-4"><p class="text-xs text-slate-500">Readiness</p><div class="mt-2"><StatusBadge :status="prometheus?.health.ready ? 'HEALTHY' : 'ERROR'" :label="prometheus?.health.ready ? 'Ready' : 'Not ready'" /></div></div><div class="card p-4"><p class="text-xs text-slate-500">Versão</p><p class="mt-1 font-semibold">{{ prometheus?.build.version || '—' }}</p></div></div>
      <div class="card p-4"><div class="flex flex-col gap-3 sm:flex-row"><input v-model="promQuery" class="input flex-1 font-mono" placeholder="PromQL, ex.: up" @keyup.enter="executePromQuery" /><button class="btn-primary" @click="executePromQuery"><Gauge :size="15" /> Consultar</button><button v-if="isSuperadmin" class="btn-secondary" @click="reloadPrometheus"><RefreshCw :size="15" /> Reload</button></div><pre v-if="promResult" class="mt-4 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] text-slate-200">{{ JSON.stringify(promResult, null, 2) }}</pre></div>
      <div class="grid gap-4 xl:grid-cols-2"><div class="card p-4"><h2 class="font-semibold">Targets</h2><div class="mt-3 space-y-2"><div v-for="(target, index) in prometheus?.targets?.activeTargets || []" :key="index" class="rounded-lg border border-slate-200 p-3 text-xs"><div class="flex items-center gap-2"><StatusBadge :status="String(target.health || '').toLowerCase() === 'up' ? 'HEALTHY' : 'ERROR'" :label="target.health || 'unknown'" /><span class="font-mono text-slate-600">{{ target.scrapeUrl || target.labels?.instance || 'target' }}</span></div><p v-if="target.lastError" class="mt-2 text-rose-600">{{ target.lastError }}</p></div></div></div><div class="card p-4"><h2 class="font-semibold">Alertas</h2><div class="mt-3 space-y-2"><div v-for="(alert, index) in prometheus?.alerts?.alerts || []" :key="index" class="rounded-lg border border-slate-200 p-3 text-xs"><div class="flex items-center gap-2"><ShieldAlert :size="15"/><span class="font-semibold">{{ alert.labels?.alertname || 'Alerta' }}</span><StatusBadge :status="String(alert.state || '').toLowerCase() === 'firing' ? 'ERROR' : 'PENDING'" :label="alert.state || 'pending'" /></div><p class="mt-1 text-slate-500">{{ alert.annotations?.summary || alert.annotations?.description || '' }}</p></div><p v-if="!(prometheus?.alerts?.alerts || []).length" class="text-sm text-slate-400">Nenhum alerta ativo.</p></div></div></div>
    </section>

    <section v-else-if="activeTab === 'GRAFANA'" class="space-y-4">
      <div class="card p-4"><div class="flex flex-wrap items-center gap-3"><div class="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Activity :size="20" /></div><div><h2 class="font-semibold">Grafana</h2><p class="text-xs text-slate-500">{{ grafana?.health.base_url || 'endpoint interno' }}</p></div><StatusBadge class="ml-auto" :status="grafana?.health.healthy ? 'HEALTHY' : 'ERROR'" :label="grafana?.health.healthy ? 'Saudável' : 'Indisponível'" /></div><InlineAlert v-if="grafana && !grafana.admin_configured" class="mt-4" type="warning" message="A API está alcançável, mas a administração exige um Service Account Token do Grafana configurado para a plataforma." /></div>
      <div v-if="grafana?.admin_configured" class="grid gap-4 xl:grid-cols-2"><div class="card p-4"><div class="flex items-center justify-between"><h2 class="font-semibold">Dashboards</h2><span class="text-xs text-slate-400">{{ grafana.dashboards.length }}</span></div><div class="mt-3 max-h-80 space-y-2 overflow-auto"><div v-for="item in grafana.dashboards" :key="String(item.uid)" class="flex items-center gap-3 rounded-lg border border-slate-200 p-3"><Gauge :size="16" class="text-orange-500"/><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{{ item.title }}</p><p class="text-[11px] text-slate-400">{{ item.uid }}</p></div><button class="btn-ghost text-xs" @click="editDashboard(String(item.uid))">Editar JSON</button><button v-if="isSuperadmin" class="btn-ghost text-rose-600" @click="deleteDashboard(item)"><Trash2 :size="14"/></button></div></div></div><div class="card p-4"><div class="flex items-center justify-between"><h2 class="font-semibold">Pastas</h2><span class="text-xs text-slate-400">{{ grafana.folders.length }}</span></div><div v-if="isSuperadmin" class="mt-3 flex gap-2"><input v-model="newFolderTitle" class="input flex-1" placeholder="Título"/><input v-model="newFolderUid" class="input w-36" placeholder="UID opcional"/><button class="btn-primary" @click="createGrafanaFolder"><FolderPlus :size="14"/></button></div><div class="mt-3 max-h-64 space-y-2 overflow-auto"><div v-for="folder in grafana.folders" :key="String(folder.uid)" class="flex items-center gap-3 rounded-lg border border-slate-200 p-3"><Boxes :size="15"/><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{{ folder.title }}</p><p class="text-[11px] text-slate-400">{{ folder.uid }}</p></div><button v-if="isSuperadmin" class="btn-ghost text-rose-600" @click="deleteGrafanaFolder(folder)"><Trash2 :size="14"/></button></div></div></div></div>
      <div v-if="grafana?.admin_configured" class="card p-4"><div class="flex items-center justify-between"><div><h2 class="font-semibold">Editor de dashboard</h2><p class="text-xs text-slate-500">JSON enviado exclusivamente para o contrato de dashboard do Grafana; não existe proxy genérico.</p></div><button v-if="isSuperadmin" class="btn-primary" :disabled="!dashboardJson.trim()" @click="saveDashboard"><Save :size="14"/> Salvar</button></div><textarea v-model="dashboardJson" class="mt-3 min-h-72 w-full rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-200 outline-none focus:border-blue-500" placeholder='{"dashboard":{"title":"...","panels":[]},"overwrite":true}' /></div>
      <div v-if="grafana?.admin_configured" class="card p-4"><h2 class="font-semibold">Datasources</h2><div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3"><div v-for="source in grafana.datasources" :key="String(source.uid || source.id)" class="rounded-lg border border-slate-200 p-3 text-xs"><p class="font-semibold">{{ source.name }}</p><p class="mt-1 text-slate-500">{{ source.type }} · {{ source.url }}</p><p class="mt-1 text-[11px] text-slate-400">Segredos nunca são retornados pelo Control Plane.</p></div></div></div>
    </section>

    <section v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <RouterLink v-for="item in catalog" :key="item.code" :to="item.path" class="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md"><div class="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-blue-50 group-hover:text-blue-700"><ServerCog :size="19"/></div><div class="min-w-0 flex-1"><p class="font-semibold text-slate-900">{{ item.name }}</p><p class="text-xs text-slate-500">{{ item.category }} · {{ item.management }}</p></div></RouterLink>
    </section>
  </div>
</template>
