<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Archive, Check, ChevronDown, Edit3, Plus, RefreshCw, Save, Sparkles } from 'lucide-vue-next'
import { api } from '../api/client'
import type { ApiResponse, PlatformPlan } from '../types'
import { money } from '../utils/format'
import { useFeedback } from '../composables/useFeedback'
import { appConfirm } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import JsonEditor from '../components/JsonEditor.vue'

const featureDefinitions = [
  { key: 'channels', label: 'Canais', description: 'Canais de comunicação habilitados para o tenant.' },
  { key: 'instances', label: 'Instâncias', description: 'Instâncias e conexões gerenciadas pelo Connect|API.' },
  { key: 'messages', label: 'Mensagens', description: 'Envio e processamento de mensagens.' },
  { key: 'whatsapp', label: 'WhatsApp', description: 'Canal WhatsApp disponível para o tenant.' },
  { key: 'api', label: 'API', description: 'Acesso programático aos recursos liberados da plataforma.' },
  { key: 'webhooks', label: 'Webhooks', description: 'Entrega de eventos para sistemas externos.' },
  { key: 'automations', label: 'Automações', description: 'Fluxos e regras orientadas a eventos.' },
  { key: 'pbx', label: 'PBX', description: 'Recursos da extensão Connect|API PBX.' },
  { key: 'voip', label: 'VOIP', description: 'Recursos da extensão Connect|API VOIP.' },
  { key: 'custom_domain', label: 'Domínio personalizado', description: 'Domínio próprio para o ambiente do tenant.' },
  { key: 'custom_integrations_allowed', label: 'Integrações personalizadas', description: 'Permite integrações externas específicas do tenant.' },
] as const

const limitDefinitions = [
  { key: 'users', label: 'Usuários', description: '0 = ilimitado' },
  { key: 'instances', label: 'Instâncias', description: '0 = ilimitado' },
  { key: 'channels', label: 'Canais', description: '0 = ilimitado' },
  { key: 'monthly_messages', label: 'Mensagens por mês', description: '0 = ilimitado' },
  { key: 'webhooks', label: 'Webhooks', description: '0 = ilimitado' },
  { key: 'automations', label: 'Automações', description: '0 = ilimitado' },
  { key: 'storage_gb', label: 'Armazenamento (GB)', description: '0 = ilimitado' },
] as const

const knownFeatureKeys = new Set(featureDefinitions.map(item => item.key))
const knownLimitKeys = new Set(limitDefinitions.map(item => item.key))
const plans = ref<PlatformPlan[]>([])
const modal = ref(false)
const editing = ref<PlatformPlan | null>(null)
const includeInactive = ref(true)
const { error, success, loading, clear, fail, done } = useFeedback()
const form = reactive({
  code: '', name: '', description: '', monthly_price: '0.00', annual_price: '0.00',
  features: {} as Record<string, boolean>, limits: {} as Record<string, number>,
  advancedFeatures: '{}', advancedLimits: '{}', sort_order: 0, is_public: true, is_active: true
})
const activePlans = computed(() => plans.value.filter(item => item.is_active).length)

function defaultFeatures(): Record<string, boolean> {
  return Object.fromEntries(featureDefinitions.map(item => [item.key, false]))
}
function defaultLimits(): Record<string, number> {
  return Object.fromEntries(limitDefinitions.map(item => [item.key, 0]))
}
function unknownObject(source: Record<string, unknown>, known: Set<string>) {
  return Object.fromEntries(Object.entries(source || {}).filter(([key]) => !known.has(key)))
}
function featureLabel(key: string) { return featureDefinitions.find(item => item.key === key)?.label || key }
function limitLabel(key: string) { return limitDefinitions.find(item => item.key === key)?.label || key }

function reset() {
  editing.value = null
  Object.assign(form, {
    code: '', name: '', description: '', monthly_price: '0.00', annual_price: '0.00',
    features: defaultFeatures(), limits: defaultLimits(), advancedFeatures: '{}', advancedLimits: '{}',
    sort_order: plans.value.length * 10 + 10, is_public: true, is_active: true
  })
}
function openCreate() { clear(); reset(); modal.value = true }
function openEdit(item: PlatformPlan) {
  clear(); editing.value = item
  const features = defaultFeatures()
  for (const definition of featureDefinitions) features[definition.key] = Boolean(item.features?.[definition.key])
  const limits = defaultLimits()
  for (const definition of limitDefinitions) limits[definition.key] = Number(item.limits?.[definition.key] ?? 0)
  Object.assign(form, {
    code: item.code, name: item.name, description: item.description || '', monthly_price: item.monthly_price,
    annual_price: item.annual_price, features, limits,
    advancedFeatures: JSON.stringify(unknownObject(item.features as Record<string, unknown>, knownFeatureKeys), null, 2),
    advancedLimits: JSON.stringify(unknownObject(item.limits as Record<string, unknown>, knownLimitKeys), null, 2),
    sort_order: item.sort_order, is_public: item.is_public, is_active: item.is_active
  })
  modal.value = true
}
async function load() {
  loading.value = true; error.value = ''
  try { plans.value = (await api.get<ApiResponse<PlatformPlan[]>>('/control/v1/plans', { params: { include_inactive: includeInactive.value } })).data.data }
  catch (reason) { fail(reason) } finally { loading.value = false }
}
async function save() {
  clear(); loading.value = true
  try {
    const advancedFeatures = JSON.parse(form.advancedFeatures || '{}')
    const advancedLimits = JSON.parse(form.advancedLimits || '{}')
    const payload = {
      code: form.code, name: form.name, description: form.description,
      monthly_price: form.monthly_price, annual_price: form.annual_price,
      features: { ...advancedFeatures, ...form.features },
      limits: { ...advancedLimits, ...Object.fromEntries(Object.entries(form.limits).map(([key, value]) => [key, Number(value || 0)])) },
      sort_order: form.sort_order, is_public: form.is_public, is_active: form.is_active,
    }
    if (editing.value) {
      const { code: _code, ...update } = payload
      await api.patch(`/control/v1/plans/${editing.value.id}`, update)
      done('Plano atualizado e propagado aos tenants vinculados.')
    } else {
      await api.post('/control/v1/plans', payload)
      done('Plano criado com sucesso.')
    }
    modal.value = false; await load()
  } catch (reason) { fail(reason) } finally { loading.value = false }
}
async function deactivate(item: PlatformPlan) {
  const confirmed = await appConfirm({
    title: 'Desativar plano',
    message: `Desativar o plano ${item.name}? Os tenants vinculados não serão removidos, mas o plano deixará de estar disponível para novas associações.`,
    confirmLabel: 'Desativar plano',
    cancelLabel: 'Manter ativo',
    tone: 'warning',
  })
  if (!confirmed) return
  clear()
  try { await api.delete(`/control/v1/plans/${item.id}`); done('Plano desativado.'); await load() }
  catch (reason) { fail(reason) }
}
onMounted(load)
</script>

<template>
  <PageHeader title="Planos e capacidades" subtitle="Defina recursos, limites técnicos e valores comerciais. Alterações são propagadas aos tenants vinculados.">
    <label class="flex items-center gap-2 text-sm text-slate-600"><input v-model="includeInactive" type="checkbox" @change="load" /> Mostrar inativos</label>
    <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading && 'animate-spin'" /> Atualizar</button>
    <button class="btn-primary" @click="openCreate"><Plus :size="18" /> Novo plano</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''" />
  <InlineAlert :message="success" type="success" @dismiss="success=''" />

  <div class="mb-6 grid gap-4 sm:grid-cols-3">
    <div class="card"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Planos cadastrados</p><p class="mt-2 text-3xl font-bold">{{ plans.length }}</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Ativos</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{ activePlans }}</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Configuração</p><p class="mt-2 flex items-center gap-2 font-semibold"><Sparkles :size="19" class="text-amber-500" /> Recursos + capacidades</p></div>
  </div>

  <div class="grid gap-5 xl:grid-cols-2">
    <article v-for="item in plans" :key="item.id" class="card relative overflow-hidden" :class="!item.is_active && 'opacity-65'">
      <div class="absolute right-0 top-0 h-24 w-24 rounded-bl-[5rem] bg-blue-50" />
      <div class="relative flex items-start justify-between gap-4">
        <div><div class="flex flex-wrap items-center gap-2"><h2 class="text-lg font-bold">{{ item.name }}</h2><StatusBadge :status="item.is_active ? 'ACTIVE' : 'INACTIVE'" /><span v-if="!item.is_public" class="badge bg-violet-100 text-violet-700">Privado</span></div><p class="mt-1 font-mono text-xs text-slate-400">{{ item.code }}</p></div>
        <button class="btn-secondary !px-3 !py-2" @click="openEdit(item)"><Edit3 :size="16" /> Editar</button>
      </div>
      <p class="relative mt-4 min-h-10 text-sm leading-relaxed text-slate-600">{{ item.description || 'Sem descrição comercial.' }}</p>
      <div class="relative mt-5 grid grid-cols-2 gap-3"><div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-400">Mensal</p><p class="mt-1 font-bold">{{ money(item.monthly_price) }}</p></div><div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-400">Anual</p><p class="mt-1 font-bold">{{ money(item.annual_price) }}</p></div></div>
      <div class="relative mt-5"><p class="mb-2 text-xs font-semibold uppercase text-slate-400">Recursos habilitados</p><div class="flex flex-wrap gap-2"><span v-for="(enabled,key) in item.features" v-show="enabled" :key="key" class="badge bg-emerald-50 text-emerald-700"><Check :size="12" /> {{ featureLabel(String(key)) }}</span><span v-if="!Object.values(item.features).some(Boolean)" class="text-xs text-slate-400">Nenhum recurso adicional.</span></div></div>
      <div class="relative mt-4"><p class="mb-2 text-xs font-semibold uppercase text-slate-400">Limites</p><div class="grid gap-2 sm:grid-cols-2"><div v-for="(value,key) in item.limits" :key="key" class="flex justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs"><span class="text-slate-500">{{ limitLabel(String(key)) }}</span><strong>{{ Number(value) === 0 ? 'Ilimitado' : value }}</strong></div></div></div>
      <div class="relative mt-5 flex justify-end"><button class="text-xs font-semibold text-rose-600 hover:underline" @click="deactivate(item)"><Archive :size="14" class="inline" /> Desativar</button></div>
    </article>
  </div>

  <ModalDialog :open="modal" :title="editing ? 'Editar plano' : 'Novo plano'" size="xl" @close="modal=false">
    <form class="space-y-6" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2"><div><label class="label">Código</label><input v-model="form.code" class="input font-mono uppercase" :disabled="Boolean(editing)" required /></div><div><label class="label">Nome</label><input v-model="form.name" class="input" required /></div><div><label class="label">Preço mensal</label><input v-model="form.monthly_price" class="input" type="number" min="0" step="0.01" /></div><div><label class="label">Preço anual</label><input v-model="form.annual_price" class="input" type="number" min="0" step="0.01" /></div><div class="md:col-span-2"><label class="label">Descrição</label><textarea v-model="form.description" class="input" rows="3" /></div></div>

      <section><div class="mb-3"><h3 class="font-semibold text-slate-900">Recursos do plano</h3><p class="text-sm text-slate-500">Ative apenas o que deve ficar disponível para as tenants deste plano. O plano é a fonte comercial de verdade.</p></div><div class="grid gap-2 md:grid-cols-2"><label v-for="definition in featureDefinitions" :key="definition.key" class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><input v-model="form.features[definition.key]" type="checkbox" class="mt-1"/><span><span class="block text-sm font-semibold text-slate-800">{{definition.label}}</span><span class="block text-xs leading-5 text-slate-500">{{definition.description}}</span></span></label></div></section>

      <section><div class="mb-3"><h3 class="font-semibold text-slate-900">Capacidades e limites</h3><p class="text-sm text-slate-500">Informe 0 quando a capacidade não tiver limite comercial.</p></div><div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3"><div v-for="definition in limitDefinitions" :key="definition.key"><label class="label">{{definition.label}}</label><input v-model.number="form.limits[definition.key]" class="input" type="number" min="0" step="1"/><p class="mt-1 text-xs text-slate-400">{{definition.description}}</p></div></div></section>

      <details class="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary class="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700"><ChevronDown :size="16"/> Configuração avançada em JSON <span class="font-normal text-slate-400">(opcional)</span></summary>
        <p class="mt-2 text-xs leading-5 text-slate-500">Use somente para chaves futuras ainda sem controle visual. As opções acima sempre prevalecem.</p>
        <div class="mt-4 grid gap-4 lg:grid-cols-2"><JsonEditor v-model="form.advancedFeatures" label="Recursos adicionais" :rows="7"/><JsonEditor v-model="form.advancedLimits" label="Limites adicionais" :rows="7"/></div>
      </details>

      <div class="grid gap-4 md:grid-cols-3"><div><label class="label">Ordem</label><input v-model.number="form.sort_order" class="input" type="number" /></div><label class="flex items-center gap-2 pt-8 text-sm"><input v-model="form.is_public" type="checkbox" /> Visível comercialmente</label><label class="flex items-center gap-2 pt-8 text-sm"><input v-model="form.is_active" type="checkbox" /> Plano ativo</label></div>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary" :disabled="loading"><Save :size="18" /> Salvar plano</button></div>
    </form>
  </ModalDialog>
</template>
