<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Eye, FileCode2, Plus, RefreshCw, Send, Trash2 } from 'lucide-vue-next'
import {
  createEngineTemplate,
  deleteEngineTemplate,
  editEngineTemplate,
  engineTemplateCapabilities,
  engineTemplates,
  listEngineInstances,
  previewEngineTemplate,
  sendEngineTemplate,
  type EngineInstance,
} from '../api/connectEngine'
import InlineAlert from '../components/InlineAlert.vue'
import JsonEditor from '../components/JsonEditor.vue'
import PageHeader from '../components/PageHeader.vue'
import { appConfirm } from '../composables/useAppDialog'
import { useFeedback } from '../composables/useFeedback'

interface QuickReply { id: string; text: string }
const feedback = useFeedback()
const instances = ref<EngineInstance[]>([])
const instanceId = ref('')
const rawTemplates = ref<Record<string, unknown>>({})
const capabilities = ref<Record<string, unknown>>({})
const selected = ref<Record<string, unknown> | null>(null)
const preview = ref<unknown>(null)
const variables = ref<Record<string, unknown>>({})
const testNumber = ref('')
const loading = ref(false)
const saving = ref(false)

const form = reactive({ name: '', language: 'pt_BR', category: 'UTILITY', body: 'Olá {{customer.name}}!', footer: '', enabled: true })
const quickReplies = ref<QuickReply[]>([])
const actionsPolicy = ref<Record<string, unknown>>({ bindings: [] })
const templatePolicy = ref<Record<string, unknown>>({})

function firstArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  for (const key of ['templates','data','records','items']) {
    const found = firstArray(object[key])
    if (found.length) return found
  }
  return []
}
const templates = computed(() => firstArray(rawTemplates.value))

function components() {
  const result: Record<string, unknown>[] = [{ type: 'BODY', text: form.body }]
  if (form.footer.trim()) result.push({ type: 'FOOTER', text: form.footer.trim() })
  if (quickReplies.value.length) result.push({ type: 'BUTTONS', buttons: quickReplies.value.map((button) => ({ type: 'QUICK_REPLY', text: button.text, id: button.id })) })
  return result
}

function newTemplate() {
  selected.value = null
  Object.assign(form, { name: '', language: 'pt_BR', category: 'UTILITY', body: 'Olá {{customer.name}}!', footer: '', enabled: true })
  quickReplies.value = []
  actionsPolicy.value = { bindings: [] }
  templatePolicy.value = {}
  preview.value = null
}

function selectTemplate(item: Record<string, unknown>) {
  selected.value = item
  form.name = String(item.name || '')
  form.language = String(item.language || 'pt_BR')
  form.category = String(item.category || 'UTILITY')
  form.enabled = item.enabled !== false
  const list = Array.isArray(item.components) ? item.components as Record<string, unknown>[] : []
  form.body = String(list.find((c) => c.type === 'BODY')?.text || '')
  form.footer = String(list.find((c) => c.type === 'FOOTER')?.text || '')
  const buttons = list.find((c) => c.type === 'BUTTONS')?.buttons
  quickReplies.value = Array.isArray(buttons) ? buttons.filter((b) => (b as Record<string, unknown>).type === 'QUICK_REPLY').map((b) => ({ id: String((b as Record<string, unknown>).id || (b as Record<string, unknown>).text || ''), text: String((b as Record<string, unknown>).text || '') })) : []
  actionsPolicy.value = (item.actions && typeof item.actions === 'object') ? item.actions as Record<string, unknown> : { bindings: [] }
  templatePolicy.value = (item.policy && typeof item.policy === 'object') ? item.policy as Record<string, unknown> : {}
  preview.value = null
}

function addQuickReply() { quickReplies.value.push({ id: `reply_${quickReplies.value.length + 1}`, text: 'Nova opção' }) }

async function load() {
  if (!instanceId.value) return
  loading.value = true; feedback.clear()
  try {
    const [tpl, caps] = await Promise.all([engineTemplates(instanceId.value), engineTemplateCapabilities(instanceId.value)])
    rawTemplates.value = tpl; capabilities.value = caps
  } catch (error) { feedback.fail(error) }
  finally { loading.value = false }
}

async function save() {
  if (!instanceId.value || !form.name.trim() || !form.body.trim()) return feedback.fail(new Error('Selecione uma instância e preencha nome/corpo.'))
  saving.value = true; feedback.clear()
  const payload = { name: form.name.trim(), language: form.language, category: form.category, allowCategoryChange: false, components: components(), actions: actionsPolicy.value, policy: templatePolicy.value, enabled: form.enabled }
  try {
    const templateId = String(selected.value?.templateId || selected.value?.id || '')
    if (templateId) await editEngineTemplate(instanceId.value, { templateId, ...payload })
    else await createEngineTemplate(instanceId.value, payload)
    feedback.done(templateId ? 'Template atualizado.' : 'Template criado.')
    await load()
  } catch (error) { feedback.fail(error) }
  finally { saving.value = false }
}

async function previewTemplate() {
  if (!instanceId.value) return
  feedback.clear(); preview.value = null
  try { preview.value = await previewEngineTemplate(instanceId.value, { name: form.name, language: form.language, category: form.category, components: components(), variables: variables.value, policy: templatePolicy.value }) }
  catch (error) { feedback.fail(error) }
}

async function sendTest() {
  if (!instanceId.value || !testNumber.value) return feedback.fail(new Error('Informe o número do teste.'))
  try { await sendEngineTemplate(instanceId.value, { number: testNumber.value, name: form.name, language: form.language, variables: variables.value }); feedback.done('Template entregue ao Engine para envio.') }
  catch (error) { feedback.fail(error) }
}

async function remove() {
  if (!instanceId.value || !form.name) return
  const confirmed = await appConfirm({ title: 'Excluir template', message: `Excluir o template ${form.name}? Templates de sistema permanecem protegidos pelo Engine.`, confirmLabel: 'Excluir template', cancelLabel: 'Cancelar', tone: 'danger' })
  if (!confirmed) return
  try { await deleteEngineTemplate(instanceId.value, { name: form.name, hsmId: selected.value?.hsmId || undefined }); feedback.done('Template removido.'); newTemplate(); await load() }
  catch (error) { feedback.fail(error) }
}

onMounted(async () => { try { instances.value = await listEngineInstances(); instanceId.value = instances.value[0]?.id || ''; await load() } catch (error) { feedback.fail(error) } })
watch(instanceId, () => { newTemplate(); load() })
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Template Studio" subtitle="Mensagens e interações em uma única superfície. O Studio usa os contratos canônicos do Engine; o Manager legado permanece desativado.">
      <template #actions><button class="btn-secondary" @click="newTemplate"><Plus :size="16"/> Novo</button><button class="btn-secondary" :disabled="loading || !instanceId" @click="load"><RefreshCw :size="16"/> Atualizar</button></template>
    </PageHeader>
    <InlineAlert :message="feedback.error.value" type="error" @dismiss="feedback.error.value=''"/><InlineAlert :message="feedback.success.value" type="success" @dismiss="feedback.success.value=''"/>
    <div class="card p-5"><label class="block max-w-xl"><span class="form-label">Instância</span><select v-model="instanceId" class="form-input"><option disabled value="">Selecione</option><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.alias }} · {{ item.provider }}</option></select></label></div>

    <div class="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_420px]">
      <aside class="card overflow-hidden"><div class="border-b border-slate-200 p-4"><p class="text-sm font-semibold text-slate-900">Templates</p><p class="text-xs text-slate-500">{{ templates.length }} item(ns)</p></div><div class="max-h-[720px] space-y-1 overflow-auto p-2"><button v-for="item in templates" :key="String(item.id || item.name)" class="w-full rounded-xl p-3 text-left hover:bg-slate-50" :class="selected===item && 'bg-blue-50'" @click="selectTemplate(item)"><p class="truncate text-sm font-semibold text-slate-900">{{ item.name }}</p><p class="mt-1 text-xs text-slate-500">{{ item.language || 'pt_BR' }} · {{ item.category || 'UTILITY' }}</p></button><p v-if="!templates.length" class="p-6 text-center text-sm text-slate-400">Nenhum template.</p></div></aside>

      <form class="card space-y-5 p-6" @submit.prevent="save">
        <div class="flex items-start gap-3"><FileCode2 :size="24" class="mt-1 text-blue-600"/><div><h2 class="font-semibold text-slate-950">Conteúdo e interações</h2><p class="text-sm text-slate-500">Botões ficam aqui, junto do conteúdo que eles complementam.</p></div></div>
        <div class="grid gap-4 md:grid-cols-3"><label class="md:col-span-2"><span class="form-label">Nome</span><input v-model.trim="form.name" class="form-input" required/></label><label><span class="form-label">Idioma</span><input v-model="form.language" class="form-input"/></label></div>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Categoria</span><select v-model="form.category" class="form-input"><option>UTILITY</option><option>MARKETING</option><option>AUTHENTICATION</option></select></label><label class="flex items-end gap-2 pb-3 text-sm text-slate-700"><input v-model="form.enabled" type="checkbox"/> Template habilitado</label></div>
        <label class="block"><span class="form-label">Mensagem</span><textarea v-model="form.body" class="form-input min-h-40 resize-y" placeholder="Olá {{customer.name}}!" required/></label>
        <label class="block"><span class="form-label">Rodapé</span><input v-model="form.footer" class="form-input" placeholder="Opcional"/></label>
        <div><div class="mb-3 flex items-center justify-between"><div><p class="form-label">Respostas rápidas</p><p class="text-xs text-slate-500">IDs estáveis, independentes do texto exibido.</p></div><button type="button" class="btn-secondary" @click="addQuickReply"><Plus :size="15"/> Resposta</button></div><div class="space-y-2"><div v-for="(button,index) in quickReplies" :key="index" class="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_1fr_auto]"><input v-model="button.id" class="form-input" placeholder="id_estavel"/><input v-model="button.text" class="form-input" placeholder="Texto"/><button type="button" class="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" @click="quickReplies.splice(index,1)"><Trash2 :size="16"/></button></div></div></div>
        <details class="rounded-xl border border-slate-200 p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Avançado: Actions / Policy</summary><div class="mt-4 grid gap-4 lg:grid-cols-2"><JsonEditor v-model="actionsPolicy" label="Actions / bindings" :rows="8"/><JsonEditor v-model="templatePolicy" label="Policy / Micro Apps" :rows="8"/></div></details>
        <div class="flex flex-wrap justify-end gap-2"><button v-if="selected" type="button" class="btn-secondary text-rose-600" @click="remove"><Trash2 :size="16"/> Excluir</button><button class="btn-primary" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar template' }}</button></div>
      </form>

      <aside class="space-y-5 xl:col-span-2 2xl:col-span-1">
        <div class="card space-y-4 p-5"><div class="flex items-center gap-2"><Eye :size="18" class="text-cyan-600"/><h2 class="font-semibold">Preview real</h2></div><JsonEditor v-model="variables" label="Objetos / variáveis de teste" :rows="7"/><button class="btn-secondary w-full" :disabled="!instanceId" @click="previewTemplate"><Eye :size="16"/> Gerar preview</button><pre v-if="preview" class="max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{{ JSON.stringify(preview,null,2) }}</pre></div>
        <div class="card space-y-3 p-5"><h2 class="font-semibold">Enviar teste</h2><input v-model="testNumber" class="form-input" placeholder="5575..."/><button class="btn-primary w-full" @click="sendTest"><Send :size="16"/> Enviar pelo provider</button></div>
        <div class="card p-5"><h2 class="font-semibold">Capabilities</h2><pre class="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600">{{ JSON.stringify(capabilities,null,2) }}</pre></div>
      </aside>
    </div>
  </section>
</template>
