<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { AppWindow, MapPin, Plus, RefreshCw, Smartphone } from 'lucide-vue-next'
import { createEngineTemplate, engineTemplates, listEngineInstances, type EngineInstance } from '../api/connectEngine'
import InlineAlert from '../components/InlineAlert.vue'
import JsonEditor from '../components/JsonEditor.vue'
import PageHeader from '../components/PageHeader.vue'
import { useFeedback } from '../composables/useFeedback'

const feedback = useFeedback()
const instances = ref<EngineInstance[]>([])
const instanceId = ref('')
const rawTemplates = ref<Record<string, unknown>>({})
const saving = ref(false)
const form = reactive({ key: '', title: '', description: '', ttlSeconds: 1800, locationMode: 'OPTIONAL', offline: true })
const pages = ref<unknown[]>([
  { key: 'inicio', title: 'Início', description: 'Primeira página', components: [{ type: 'TEXT', text: 'Olá {{contact.name}}!' }], next: 'confirmacao' },
  { key: 'confirmacao', title: 'Confirmar', description: 'Finalize a experiência', components: [{ type: 'CHECKBOX', id: 'accepted', label: 'Confirmo as informações' }] },
])

function findArrays(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  for (const key of ['templates','data','records','items']) { const found = findArrays(object[key]); if (found.length) return found }
  return []
}
const apps = computed(() => {
  const output: Array<{ template: string; key: string; title: string; pages: number }> = []
  for (const template of findArrays(rawTemplates.value)) {
    const policy = template.policy as Record<string, unknown> | undefined
    const microApps = policy?.microApps as Record<string, unknown> | undefined
    const list = Array.isArray(microApps?.apps) ? microApps?.apps as Record<string, unknown>[] : []
    for (const app of list) output.push({ template: String(template.name || ''), key: String(app.key || ''), title: String(app.title || app.key || ''), pages: Array.isArray(app.pages) ? app.pages.length : 0 })
  }
  return output
})

async function load() {
  if (!instanceId.value) return
  try { rawTemplates.value = await engineTemplates(instanceId.value) }
  catch (error) { feedback.fail(error) }
}

async function create() {
  if (!instanceId.value || !form.key.trim() || !form.title.trim()) return feedback.fail(new Error('Selecione a instância e preencha chave/título.'))
  saving.value = true; feedback.clear()
  const key = form.key.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  const app = {
    key,
    title: form.title.trim(),
    description: form.description,
    startPage: String((pages.value[0] as Record<string, unknown>)?.key || 'inicio'),
    ttlSeconds: form.ttlSeconds,
    accessMode: 'CONVERSATION_SESSION',
    offline: { enabled: form.offline, persistDraft: form.offline, queueSubmit: form.offline },
    pages: pages.value,
  }
  try {
    await createEngineTemplate(instanceId.value, {
      name: `microapp_${key}`,
      language: 'pt_BR', category: 'UTILITY', allowCategoryChange: false, enabled: true,
      components: [{ type: 'BODY', text: `Abra ${form.title}.` }],
      actions: { bindings: [] },
      policy: {
        interactionTtlSeconds: form.ttlSeconds,
        microApps: { version: 1, apps: [app] },
      },
    })
    feedback.done('Micro App criado como contrato de Template no Engine.')
    await load()
  } catch (error) { feedback.fail(error) }
  finally { saving.value = false }
}

onMounted(async () => { try { instances.value = await listEngineInstances(); instanceId.value = instances.value[0]?.id || ''; await load() } catch (error) { feedback.fail(error) } })
watch(instanceId, load)
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Micro App Studio" subtitle="Crie interfaces transacionais multipágina vinculadas à conversa. O runtime permanece no Engine; a Platform fornece a experiência de produto.">
      <template #actions><button class="btn-secondary" @click="load"><RefreshCw :size="16"/> Atualizar</button></template>
    </PageHeader>
    <InlineAlert :message="feedback.error.value" type="error" @dismiss="feedback.error.value=''"/><InlineAlert :message="feedback.success.value" type="success" @dismiss="feedback.success.value=''"/>
    <div class="grid gap-4 md:grid-cols-3"><div class="card p-5"><AppWindow :size="24" class="text-blue-600"/><h2 class="mt-3 font-semibold">Multipágina</h2><p class="mt-2 text-sm text-slate-500">Inputs, selects, data/hora, tabelas e navegação.</p></div><div class="card p-5"><MapPin :size="24" class="text-cyan-600"/><h2 class="mt-3 font-semibold">GPS / Geofence</h2><p class="mt-2 text-sm text-slate-500">Políticas de localização pertencem ao contrato do app.</p></div><div class="card p-5"><Smartphone :size="24" class="text-violet-600"/><h2 class="mt-3 font-semibold">Mobile / Offline</h2><p class="mt-2 text-sm text-slate-500">Sessão temporária, rascunho e fila local.</p></div></div>
    <div class="card p-5"><label class="block max-w-xl"><span class="form-label">Instância</span><select v-model="instanceId" class="form-input"><option disabled value="">Selecione</option><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.alias }} · {{ item.provider }}</option></select></label></div>
    <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form class="card space-y-5 p-6" @submit.prevent="create">
        <div class="flex items-center gap-2"><Plus :size="20" class="text-blue-600"/><h2 class="font-semibold">Novo Micro App</h2></div>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Chave</span><input v-model="form.key" class="form-input" placeholder="checkin" required/></label><label><span class="form-label">Título</span><input v-model="form.title" class="form-input" placeholder="Check-in" required/></label></div>
        <label class="block"><span class="form-label">Descrição</span><input v-model="form.description" class="form-input"/></label>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">TTL da sessão (s)</span><input v-model.number="form.ttlSeconds" type="number" min="60" max="86400" class="form-input"/></label><label class="flex items-end gap-2 pb-3 text-sm"><input v-model="form.offline" type="checkbox"/> rascunho/fila offline</label></div>
        <JsonEditor v-model="pages" label="Páginas e componentes" :rows="18" hint="Contrato canônico do Micro App. O builder visual poderá editar este mesmo objeto sem conversão."/>
        <div class="flex justify-end"><button class="btn-primary" :disabled="saving"><AppWindow :size="16"/> {{ saving ? 'Criando...' : 'Criar Micro App' }}</button></div>
      </form>
      <aside class="card p-5"><h2 class="font-semibold">Micro Apps encontrados</h2><p class="mt-1 text-sm text-slate-500">{{ apps.length }} app(s) nos templates desta instância.</p><div class="mt-4 space-y-2"><div v-for="app in apps" :key="`${app.template}:${app.key}`" class="rounded-xl border border-slate-200 p-3"><p class="text-sm font-semibold">{{ app.title }}</p><p class="text-xs text-slate-500">{{ app.key }} · {{ app.pages }} página(s)</p><p class="mt-1 truncate text-[11px] text-slate-400">Template: {{ app.template }}</p></div><p v-if="!apps.length" class="py-6 text-center text-sm text-slate-400">Nenhum Micro App.</p></div></aside>
    </div>
  </section>
</template>
