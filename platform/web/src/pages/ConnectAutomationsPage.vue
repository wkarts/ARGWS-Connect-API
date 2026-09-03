<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Play, Plus, RefreshCw, Trash2, Workflow } from 'lucide-vue-next'
import {
  createEngineRecipe,
  deleteEngineRecipe,
  engineActions,
  engineRecipes,
  executeEngineRecipe,
  listEngineInstances,
  type EngineInstance,
} from '../api/connectEngine'
import InlineAlert from '../components/InlineAlert.vue'
import JsonEditor from '../components/JsonEditor.vue'
import PageHeader from '../components/PageHeader.vue'
import { appConfirm } from '../composables/useAppDialog'
import { useFeedback } from '../composables/useFeedback'

interface Step { id: string; action: string; input: Record<string, unknown>; continueOnError: boolean }
const feedback = useFeedback()
const instances = ref<EngineInstance[]>([])
const instanceId = ref('')
const rawRecipes = ref<Record<string, unknown>>({})
const rawActions = ref<Record<string, unknown>>({})
const selectedRecipe = ref('')
const executionInput = ref<Record<string, unknown>>({})
const executionResult = ref<unknown>(null)
const loading = ref(false)
const saving = ref(false)

const form = reactive({ recipeKey: '', name: '', description: '', confirmation: 'NONE', enabled: true })
const steps = ref<Step[]>([{ id: 'step-1', action: '', input: {}, continueOnError: false }])

function firstArray(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  for (const key of keys) {
    const found = firstArray(object[key], keys)
    if (found.length) return found
  }
  return []
}
const recipes = computed(() => firstArray(rawRecipes.value, ['recipes','data','records','items']))
const actions = computed(() => firstArray(rawActions.value, ['actions','data','records','items']))

function addStep() { steps.value.push({ id: `step-${steps.value.length + 1}`, action: '', input: {}, continueOnError: false }) }
function removeStep(index: number) { if (steps.value.length > 1) steps.value.splice(index, 1) }

async function load() {
  if (!instanceId.value) return
  loading.value = true; feedback.clear()
  try {
    const [recipesPayload, actionsPayload] = await Promise.all([engineRecipes(instanceId.value), engineActions(instanceId.value)])
    rawRecipes.value = recipesPayload; rawActions.value = actionsPayload
    if (!selectedRecipe.value && recipes.value[0]) selectedRecipe.value = String(recipes.value[0].recipeKey || '')
  } catch (error) { feedback.fail(error) }
  finally { loading.value = false }
}

async function save() {
  if (!instanceId.value) return feedback.fail(new Error('Selecione uma instância.'))
  if (!form.recipeKey || !form.name || steps.value.some((step) => !step.action)) return feedback.fail(new Error('Preencha chave, nome e todas as Actions da sequência.'))
  saving.value = true; feedback.clear()
  try {
    await createEngineRecipe(instanceId.value, {
      recipeKey: form.recipeKey,
      name: form.name,
      description: form.description || undefined,
      confirmation: form.confirmation,
      enabled: form.enabled,
      version: 1,
      steps: steps.value,
    })
    selectedRecipe.value = form.recipeKey
    feedback.done('Automação salva no Recipe Engine.')
    await load()
  } catch (error) { feedback.fail(error) }
  finally { saving.value = false }
}

async function execute(dryRun = true) {
  if (!instanceId.value || !selectedRecipe.value) return feedback.fail(new Error('Selecione uma automação.'))
  executionResult.value = null; feedback.clear()
  try {
    executionResult.value = await executeEngineRecipe(instanceId.value, { recipeKey: selectedRecipe.value, input: executionInput.value, dryRun, confirmed: false })
    feedback.done(dryRun ? 'Simulação concluída.' : 'Automação enviada ao Engine.')
  } catch (error) { feedback.fail(error) }
}

async function remove(recipeKey: string) {
  if (!instanceId.value) return
  const confirmed = await appConfirm({ title: 'Excluir automação', message: `Excluir a automação ${recipeKey}?`, confirmLabel: 'Excluir automação', cancelLabel: 'Cancelar', tone: 'danger' })
  if (!confirmed) return
  try { await deleteEngineRecipe(instanceId.value, recipeKey); feedback.done('Automação removida.'); await load() }
  catch (error) { feedback.fail(error) }
}

onMounted(async () => { try { instances.value = await listEngineInstances(); instanceId.value = instances.value[0]?.id || ''; await load() } catch (error) { feedback.fail(error) } })
watch(instanceId, load)
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Automation Studio" subtitle="Orquestre Actions em uma definição declarativa. Sem canvas obrigatório: a automação é o contrato; uma visão gráfica pode ser adicionada depois.">
      <template #actions><button class="btn-secondary" :disabled="loading || !instanceId" @click="load"><RefreshCw :size="16"/> Atualizar</button></template>
    </PageHeader>
    <InlineAlert :message="feedback.error.value" type="error" @dismiss="feedback.error.value=''"/>
    <InlineAlert :message="feedback.success.value" type="success" @dismiss="feedback.success.value=''"/>
    <div class="card p-5"><label class="block max-w-xl"><span class="form-label">Instância</span><select v-model="instanceId" class="form-input"><option disabled value="">Selecione</option><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.alias }} · {{ item.provider }}</option></select></label></div>

    <div class="grid gap-5 2xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,.75fr)]">
      <form class="card space-y-6 p-6" @submit.prevent="save">
        <div class="flex items-start gap-3"><div class="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><Workflow :size="20"/></div><div><h2 class="font-semibold text-slate-950">Definição declarativa</h2><p class="text-sm text-slate-500">Execução atual: manual/API/evento que invoque a Recipe. O contrato não depende de um Flow Builder.</p></div></div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-4"><p class="text-xs font-bold uppercase tracking-wider text-slate-500">Quando</p><p class="mt-1 text-sm font-semibold text-slate-900">Invocada por API, Template Interaction ou evento integrado</p><p class="mt-1 text-xs text-slate-500">Triggers adicionais serão adapters sobre a mesma Recipe, sem alterar a definição.</p></div>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Chave</span><input v-model.trim="form.recipeKey" class="form-input" placeholder="customer.onboarding" required/></label><label><span class="form-label">Nome</span><input v-model.trim="form.name" class="form-input" placeholder="Onboarding do cliente" required/></label></div>
        <label class="block"><span class="form-label">Descrição</span><input v-model="form.description" class="form-input" /></label>
        <div><div class="mb-3 flex items-center justify-between"><div><p class="text-xs font-bold uppercase tracking-wider text-slate-500">Fazer</p><p class="text-sm text-slate-600">Passos executados em ordem pelo Recipe Engine.</p></div><button type="button" class="btn-secondary" @click="addStep"><Plus :size="16"/> Passo</button></div><div class="space-y-3"><div v-for="(step,index) in steps" :key="index" class="rounded-xl border border-slate-200 p-4"><div class="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_auto]"><label><span class="form-label">ID</span><input v-model="step.id" class="form-input"/></label><label><span class="form-label">Action</span><select v-model="step.action" class="form-input"><option disabled value="">Selecione</option><option v-for="action in actions" :key="String(action.actionKey)" :value="String(action.actionKey)">{{ action.name || action.actionKey }}</option></select></label><button type="button" class="mt-6 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" @click="removeStep(index)"><Trash2 :size="16"/></button></div><div class="mt-3"><JsonEditor v-model="step.input" label="Input deste passo" :rows="4"/></div><label class="mt-2 flex items-center gap-2 text-xs text-slate-600"><input v-model="step.continueOnError" type="checkbox"/> continuar se este passo falhar</label></div></div></div>
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Confirmação</span><select v-model="form.confirmation" class="form-input"><option>NONE</option><option>CONFIRM</option><option>STRONG</option></select></label><label class="flex items-end gap-2 pb-3 text-sm text-slate-700"><input v-model="form.enabled" type="checkbox"/> Automação habilitada</label></div>
        <div class="flex justify-end"><button class="btn-primary" :disabled="saving"><Workflow :size="16"/> {{ saving ? 'Salvando...' : 'Salvar automação' }}</button></div>
      </form>

      <div class="space-y-5">
        <div class="card p-5"><h2 class="font-semibold text-slate-950">Automações</h2><p class="mt-1 text-sm text-slate-500">{{ recipes.length }} Recipe(s) nesta instância.</p><div class="mt-4 max-h-72 space-y-2 overflow-auto"><div v-for="recipe in recipes" :key="String(recipe.recipeKey)" class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"><button class="min-w-0 flex-1 text-left" @click="selectedRecipe=String(recipe.recipeKey)"><p class="truncate text-sm font-semibold">{{ recipe.name || recipe.recipeKey }}</p><p class="truncate text-xs text-slate-500">{{ recipe.recipeKey }}</p></button><button class="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" @click="remove(String(recipe.recipeKey))"><Trash2 :size="16"/></button></div><p v-if="!recipes.length" class="py-6 text-center text-sm text-slate-400">Nenhuma automação cadastrada.</p></div></div>
        <div class="card space-y-4 p-5"><div class="flex items-center gap-2"><Play :size="18" class="text-emerald-600"/><h2 class="font-semibold">Simular / executar</h2></div><select v-model="selectedRecipe" class="form-input"><option disabled value="">Selecione uma automação</option><option v-for="recipe in recipes" :key="String(recipe.recipeKey)" :value="String(recipe.recipeKey)">{{ recipe.name || recipe.recipeKey }}</option></select><JsonEditor v-model="executionInput" label="Input" :rows="6"/><div class="grid grid-cols-2 gap-2"><button class="btn-secondary" @click="execute(true)">Dry-run</button><button class="btn-primary" @click="execute(false)">Executar</button></div><pre v-if="executionResult" class="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{{ JSON.stringify(executionResult,null,2) }}</pre></div>
      </div>
    </div>
  </section>
</template>
