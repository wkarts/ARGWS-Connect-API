<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Braces, FlaskConical, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import {
  createEngineAction,
  deleteEngineAction,
  engineActions,
  executeEngineAction,
  listEngineInstances,
  type EngineInstance,
} from '../api/connectEngine'
import InlineAlert from '../components/InlineAlert.vue'
import JsonEditor from '../components/JsonEditor.vue'
import PageHeader from '../components/PageHeader.vue'
import { appConfirm } from '../composables/useAppDialog'
import { useFeedback } from '../composables/useFeedback'

const feedback = useFeedback()
const instances = ref<EngineInstance[]>([])
const instanceId = ref('')
const raw = ref<Record<string, unknown>>({})
const result = ref<unknown>(null)
const loading = ref(false)
const creating = ref(false)
const testInput = ref<Record<string, unknown>>({})
const selectedAction = ref('')

const form = reactive({
  actionKey: '',
  name: '',
  description: '',
  method: 'GET',
  baseUrl: 'https://api.example.com',
  path: '/',
  credentialRef: '',
  timeoutMs: 10000,
  confirmation: 'NONE',
  allowPrivateNetwork: false,
  headers: {} as Record<string, string>,
  requestTemplate: {} as Record<string, unknown>,
  outputMapping: {} as Record<string, unknown>,
})

function firstArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  for (const key of ['actions', 'data', 'records', 'items']) {
    const found = firstArray(object[key])
    if (found.length) return found
  }
  return []
}
const actions = computed(() => firstArray(raw.value))

async function load() {
  if (!instanceId.value) return
  loading.value = true
  feedback.clear()
  try {
    raw.value = await engineActions(instanceId.value)
    if (!selectedAction.value && actions.value[0]) selectedAction.value = String(actions.value[0].actionKey || '')
  } catch (error) { feedback.fail(error) }
  finally { loading.value = false }
}

async function createAction() {
  if (!instanceId.value) return feedback.fail(new Error('Selecione uma instância.'))
  if (!form.actionKey || !form.name || !form.baseUrl) return feedback.fail(new Error('Preencha chave, nome e URL base.'))
  creating.value = true
  feedback.clear()
  try {
    await createEngineAction(instanceId.value, {
      ...form,
      credentialRef: form.credentialRef || undefined,
      description: form.description || undefined,
    })
    feedback.done('Integração registrada no Action Registry do Engine.')
    selectedAction.value = form.actionKey
    await load()
  } catch (error) { feedback.fail(error) }
  finally { creating.value = false }
}

async function testAction(dryRun = true) {
  if (!instanceId.value || !selectedAction.value) return feedback.fail(new Error('Selecione uma Action.'))
  feedback.clear(); result.value = null
  try {
    result.value = await executeEngineAction(instanceId.value, {
      actionKey: selectedAction.value,
      input: testInput.value,
      dryRun,
      confirmed: false,
    })
    feedback.done(dryRun ? 'Dry-run concluído.' : 'Execução enviada ao Engine.')
  } catch (error) { feedback.fail(error) }
}

async function remove(actionKey: string) {
  if (!instanceId.value) return
  const confirmed = await appConfirm({ title: 'Excluir integração', message: `Excluir a Action ${actionKey}?`, confirmLabel: 'Excluir Action', cancelLabel: 'Cancelar', tone: 'danger' })
  if (!confirmed) return
  try { await deleteEngineAction(instanceId.value, actionKey); feedback.done('Action removida.'); await load() }
  catch (error) { feedback.fail(error) }
}

onMounted(async () => {
  try { instances.value = await listEngineInstances(); instanceId.value = instances.value[0]?.id || ''; await load() }
  catch (error) { feedback.fail(error) }
})
watch(instanceId, load)
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Integration Studio" subtitle="Configure REST/HTTP visualmente. Credenciais permanecem no servidor por referência; o Engine executa e a Platform governa.">
      <template #actions><button class="btn-secondary" :disabled="loading || !instanceId" @click="load"><RefreshCw :size="16"/> Atualizar</button></template>
    </PageHeader>
    <InlineAlert :message="feedback.error.value" type="error" @dismiss="feedback.error.value=''" />
    <InlineAlert :message="feedback.success.value" type="success" @dismiss="feedback.success.value=''" />

    <div class="card p-5">
      <label class="block max-w-xl"><span class="form-label">Instância</span><select v-model="instanceId" class="form-input"><option disabled value="">Selecione</option><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.alias }} · {{ item.provider }}</option></select></label>
    </div>

    <div class="grid gap-5 2xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,.75fr)]">
      <form class="card space-y-5 p-6" @submit.prevent="createAction">
        <div class="flex items-start gap-3"><div class="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Plus :size="20"/></div><div><h2 class="font-semibold text-slate-950">Nova integração REST</h2><p class="text-sm text-slate-500">Transforma a configuração em uma Action canônica reutilizável.</p></div></div>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Chave</span><input v-model.trim="form.actionKey" class="form-input" placeholder="erp.customer.lookup" required /></label><label><span class="form-label">Nome</span><input v-model.trim="form.name" class="form-input" placeholder="Consultar cliente" required /></label></div>
        <label class="block"><span class="form-label">Descrição</span><input v-model="form.description" class="form-input" placeholder="Finalidade desta integração" /></label>
        <div class="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)]"><label><span class="form-label">Método</span><select v-model="form.method" class="form-input"><option v-for="method in ['GET','POST','PUT','PATCH','DELETE']" :key="method">{{ method }}</option></select></label><label><span class="form-label">URL base</span><input v-model.trim="form.baseUrl" class="form-input" placeholder="https://erp.example.com" required /></label></div>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Path</span><input v-model="form.path" class="form-input" placeholder="/api/customers/{{customer.id}}" /></label><label><span class="form-label">Credential Ref</span><input v-model="form.credentialRef" class="form-input" placeholder="erp.production" /></label></div>
        <div class="grid gap-5 lg:grid-cols-2"><JsonEditor v-model="form.headers" label="Headers (sem segredos)" :rows="7" hint="Use Credential Ref para segredos."/><JsonEditor v-model="form.requestTemplate" label="Request Template" :rows="7" /></div>
        <JsonEditor v-model="form.outputMapping" label="Output Mapping" :rows="6" hint="Mapeie paths do retorno para variáveis reutilizáveis." />
        <div class="grid gap-4 md:grid-cols-3"><label><span class="form-label">Timeout (ms)</span><input v-model.number="form.timeoutMs" type="number" min="100" max="120000" class="form-input" /></label><label><span class="form-label">Confirmação</span><select v-model="form.confirmation" class="form-input"><option>NONE</option><option>CONFIRM</option><option>STRONG</option></select></label><label class="flex items-end gap-2 pb-3 text-sm text-slate-700"><input v-model="form.allowPrivateNetwork" type="checkbox"/> Permitir rede privada</label></div>
        <div class="flex justify-end"><button class="btn-primary" :disabled="creating"><Braces :size="16"/> {{ creating ? 'Salvando...' : 'Salvar Action' }}</button></div>
      </form>

      <div class="space-y-5">
        <div class="card p-5"><h2 class="font-semibold text-slate-950">Action Registry</h2><p class="mt-1 text-sm text-slate-500">{{ actions.length }} integração(ões) encontradas.</p><div class="mt-4 max-h-72 space-y-2 overflow-auto"><div v-for="action in actions" :key="String(action.actionKey)" class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><button class="min-w-0 flex-1 text-left" @click="selectedAction=String(action.actionKey)"><p class="truncate text-sm font-semibold text-slate-900">{{ action.name || action.actionKey }}</p><p class="truncate text-xs text-slate-500">{{ action.method }} · {{ action.actionKey }}</p></button><button class="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" @click="remove(String(action.actionKey))"><Trash2 :size="16"/></button></div><p v-if="!actions.length" class="py-6 text-center text-sm text-slate-400">Nenhuma Action cadastrada.</p></div></div>
        <div class="card space-y-4 p-5"><div class="flex items-center gap-2"><FlaskConical :size="18" class="text-cyan-600"/><h2 class="font-semibold text-slate-950">Testar integração</h2></div><label><span class="form-label">Action</span><select v-model="selectedAction" class="form-input"><option disabled value="">Selecione</option><option v-for="action in actions" :key="String(action.actionKey)" :value="String(action.actionKey)">{{ action.name || action.actionKey }}</option></select></label><JsonEditor v-model="testInput" label="Input de teste" :rows="6"/><div class="grid grid-cols-2 gap-2"><button class="btn-secondary" @click="testAction(true)">Dry-run</button><button class="btn-primary" @click="testAction(false)">Executar</button></div><pre v-if="result" class="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{{ JSON.stringify(result,null,2) }}</pre></div>
      </div>
    </div>
  </section>
</template>
