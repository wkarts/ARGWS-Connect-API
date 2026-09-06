<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { api } from '../api/client'
import type { ApiResponse } from '../types'

type State = 'READY' | 'WAITING' | 'ERROR' | 'STALE' | 'DISABLED' | 'RUNNING' | 'STAGING'
interface Service {
  id: 'dns' | 'acme' | 'cloudpanel'
  title: string
  state: State
  code: string | null
  message: string
  stage: string | null
  env_fields: string[]
  checked_at: string | null
  expires_at: string | null
  last_installed_at: string | null
  last_verified_at: string | null
}
interface Report {
  schema_version: number
  scope: string
  read_only: boolean
  services_confirmed: boolean
  queried_at: string
  services: Service[]
}
const data = ref<Report | null>(null)
const loading = ref(false)
const error = ref('')
let abort: AbortController | null = null
let alive = true
const labels: Record<State, string> = {
  READY: 'Confirmado pelo serviço', WAITING: 'Aguardando serviço', ERROR: 'Verificar causa',
  STALE: 'Estado desatualizado', DISABLED: 'Desativado', RUNNING: 'Em execução', STAGING: 'Certificado de teste'
}
const stages: Record<string, string> = {
  configuration: 'Configuração', dns: 'DNS', account: 'Conta ACME', issuance: 'Emissão',
  host: 'Acesso ao host', installation: 'Instalação do certificado'
}
const tone = (state: State) => state === 'READY' ? 'bg-emerald-50 text-emerald-700'
  : state === 'ERROR' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'
const date = (value: string | null) => {
  if (!value) return 'Ainda não informado'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Data indisponível' : parsed.toLocaleString('pt-BR')
}
async function refresh() {
  if (loading.value || !alive) return
  loading.value = true
  error.value = ''
  // Never retain a green status after a failed refresh or reuse persistent storage.
  data.value = null
  abort = new AbortController()
  try {
    const response = await api.get<ApiResponse<Report>>('/control/v1/tls/diagnostics', {
      signal: abort.signal, timeout: 10000
    })
    const result = response.data.data
    if (result?.schema_version !== 1 || result.scope !== 'PLATFORM_SERVICES' || result.read_only !== true
      || !Array.isArray(result.services) || result.services.length !== 3
      || new Set(result.services.map(service => service?.id)).size !== 3
      || !result.services.every(service => service && ['dns', 'acme', 'cloudpanel'].includes(service.id)
        && Object.prototype.hasOwnProperty.call(labels, service.state)
        && typeof service.title === 'string' && typeof service.message === 'string'
        && Array.isArray(service.env_fields) && service.env_fields.length <= 10
        && service.env_fields.every(field => typeof field === 'string' && /^[A-Z][A-Z0-9_]*$/.test(field)))) {
      throw new Error('INVALID_SCHEMA')
    }
    if (alive) data.value = result
  } catch (exception) {
    if (!alive) return
    const status = (exception as { response?: { status?: number } })?.response?.status
    error.value = status === 403 ? 'Sua conta não tem permissão para consultar o diagnóstico da plataforma.'
      : status === 404 ? 'Diagnóstico integrado indisponível nesta API. Atualize API e interface para o mesmo canal publicado.'
        : 'Não foi possível consultar o diagnóstico. A lista de domínios continua disponível; tente atualizar o diagnóstico.'
  } finally {
    loading.value = false
    abort = null
  }
}
onMounted(refresh)
onBeforeUnmount(() => { alive = false; abort?.abort() })
defineExpose({ refresh })
</script>

<template>
  <section aria-label="Diagnóstico integrado de DNS e SSL" class="card p-4 space-y-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck class="h-4 w-4 text-blue-600" /> Diagnóstico DNS/SSL da stack</h2>
        <p class="mt-1 text-xs text-slate-500">Você configura somente <strong>compose.yaml</strong> e <strong>.env</strong>. Certificados e estados internos são gerados pelos serviços.</p>
      </div>
      <button type="button" class="btn-secondary" :disabled="loading" @click="refresh">
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />{{ loading ? 'Consultando...' : 'Atualizar diagnóstico' }}
      </button>
    </div>
    <p v-if="error" role="alert" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{{ error }}</p>
    <p v-else-if="loading" role="status" class="text-sm text-slate-500">Consultando os registros dos serviços existentes...</p>
    <div v-if="data" class="grid gap-3 lg:grid-cols-3" aria-live="polite">
      <article v-for="service in data.services" :key="service.id" :data-testid="`tls-${service.id}`" class="rounded-xl border border-slate-200 p-3 space-y-2">
        <h3 class="text-sm font-semibold text-slate-800">{{ service.title }}</h3>
        <span class="inline-block rounded px-2 py-1 text-xs font-medium" :class="tone(service.state)">{{ labels[service.state] || 'Estado não confirmado' }}</span>
        <p class="text-sm text-slate-700">{{ service.message }}</p>
        <p v-if="service.code" class="break-all font-mono text-xs text-slate-500">{{ service.code }}</p>
        <p v-if="service.stage" class="text-xs text-slate-500">Etapa: {{ stages[service.stage] || 'Não informada' }}</p>
        <p v-if="service.env_fields.length" class="break-words text-xs text-slate-600">Campos do <strong>.env</strong> a conferir: <code>{{ service.env_fields.join(', ') }}</code>. Os valores não são exibidos.</p>
        <div class="border-t border-slate-100 pt-2 text-xs text-slate-500">
          <p>Último estado do serviço: {{ date(service.checked_at) }}</p>
          <p v-if="service.expires_at">Validade do certificado: {{ date(service.expires_at) }}</p>
          <p v-if="service.last_installed_at">Última instalação: {{ date(service.last_installed_at) }}</p>
          <p v-if="service.last_verified_at">Última verificação: {{ date(service.last_verified_at) }}</p>
        </div>
      </article>
    </div>
    <p class="text-xs text-slate-500">Consulta somente leitura. Não executa comandos, não força emissão nem ativa clientes. Não crie JSONs ou certificados manualmente; as configurações e os volumes permanecem nos serviços da stack.</p>
  </section>
</template>
