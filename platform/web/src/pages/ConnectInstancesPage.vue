<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Cable, CirclePlus, Link2, RefreshCw, RotateCcw, Trash2 } from 'lucide-vue-next'
import {
  connectEngineInstance, createEngineInstance, deleteEngineInstance,
  listEngineInstances, restartEngineInstance, type EngineInstance
} from '../api/connectEngine'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ModalDialog from '../components/ModalDialog.vue'
import { appConfirm } from '../composables/useAppDialog'
import { useFeedback } from '../composables/useFeedback'

const feedback = useFeedback()
const loading = ref(false)
const creating = ref(false)
const modal = ref(false)
const items = ref<EngineInstance[]>([])
const form = ref({ alias: '', integration: 'WHATSAPP-BAILEYS', qrcode: true, number: '' })

const onlineCount = computed(() => items.value.filter(item => String(item.state || '').toLowerCase().includes('open')).length)

async function load() {
  loading.value = true
  try { items.value = await listEngineInstances() }
  catch (error) { feedback.fail(error) }
  finally { loading.value = false }
}

async function create() {
  creating.value = true
  try {
    await createEngineInstance({ ...form.value, number: form.value.number || undefined })
    modal.value = false
    form.value = { alias: '', integration: 'WHATSAPP-BAILEYS', qrcode: true, number: '' }
    feedback.done('Instância criada no Connect|API Engine.')
    await load()
  } catch (error) { feedback.fail(error) }
  finally { creating.value = false }
}

async function connect(item: EngineInstance) {
  try { await connectEngineInstance(item.id); feedback.done('Conexão solicitada.'); await load() }
  catch (error) { feedback.fail(error) }
}
async function restart(item: EngineInstance) {
  try { await restartEngineInstance(item.id); feedback.done('Reinício solicitado.'); await load() }
  catch (error) { feedback.fail(error) }
}
async function remove(item: EngineInstance) {
  const confirmed = await appConfirm({ title: 'Excluir instância', message: `Excluir a instância ${item.alias}? Esta ação remove também a instância correspondente no Engine.`, confirmLabel: 'Excluir instância', cancelLabel: 'Cancelar', tone: 'danger' })
  if (!confirmed) return
  try { await deleteEngineInstance(item.id); feedback.done('Instância removida.'); await load() }
  catch (error) { feedback.fail(error) }
}

onMounted(load)
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Instâncias" subtitle="Lifecycle e conectividade das instâncias isoladas deste tenant.">
      <template #actions>
        <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="16" /> Atualizar</button>
        <button class="btn-primary" @click="modal=true"><CirclePlus :size="16" /> Nova instância</button>
      </template>
    </PageHeader>
    <InlineAlert :message="feedback.error.value" type="error" @dismiss="feedback.error.value=''" />
    <InlineAlert :message="feedback.success.value" type="success" @dismiss="feedback.success.value=''" />

    <div class="grid gap-4 sm:grid-cols-3">
      <div class="card p-5"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Total</p><p class="mt-2 text-3xl font-bold text-slate-950">{{ items.length }}</p></div>
      <div class="card p-5"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Online</p><p class="mt-2 text-3xl font-bold text-emerald-600">{{ onlineCount }}</p></div>
      <div class="card p-5"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Engine</p><p class="mt-2 text-sm font-semibold text-slate-800">Node/TypeScript canônico</p><p class="mt-1 text-xs text-slate-500">A Platform controla; o Engine executa.</p></div>
    </div>

    <div class="card overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-sm text-slate-500">Carregando instâncias...</div>
      <div v-else-if="!items.length" class="p-10 text-center">
        <Cable class="mx-auto text-slate-300" :size="34" />
        <h2 class="mt-3 font-semibold text-slate-900">Nenhuma instância vinculada</h2>
        <p class="mt-1 text-sm text-slate-500">Crie a primeira conexão deste tenant sem expor a chave global do Engine.</p>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500"><tr><th class="px-5 py-3">Instância</th><th class="px-5 py-3">Provider</th><th class="px-5 py-3">Estado</th><th class="px-5 py-3">Engine ID</th><th class="px-5 py-3 text-right">Ações</th></tr></thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="item in items" :key="item.id" class="hover:bg-slate-50/60">
              <td class="px-5 py-4"><p class="font-semibold text-slate-900">{{ item.alias }}</p><p class="mt-0.5 text-xs text-slate-500">{{ item.created_at || '—' }}</p></td>
              <td class="px-5 py-4 text-slate-600">{{ item.provider }}</td>
              <td class="px-5 py-4"><StatusBadge :status="item.state || item.status || 'UNKNOWN'" /></td>
              <td class="px-5 py-4 font-mono text-xs text-slate-500">{{ item.instance_name }}</td>
              <td class="px-5 py-4"><div class="flex justify-end gap-2"><button class="icon-btn" title="Conectar" @click="connect(item)"><Link2 :size="16" /></button><button class="icon-btn" title="Reiniciar" @click="restart(item)"><RotateCcw :size="16" /></button><button class="icon-btn text-rose-600" title="Excluir" @click="remove(item)"><Trash2 :size="16" /></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ModalDialog v-model="modal" title="Nova instância" description="A Platform cria o binding e provisiona a instância correspondente no Connect|API Engine.">
      <form class="space-y-4" @submit.prevent="create">
        <label class="block"><span class="form-label">Identificador amigável</span><input v-model="form.alias" class="form-input" placeholder="atendimento" required /></label>
        <label class="block"><span class="form-label">Provider</span><select v-model="form.integration" class="form-input"><option>WHATSAPP-BAILEYS</option><option>WHATSAPP-BUSINESS</option><option>CONNECT</option></select></label>
        <label class="block"><span class="form-label">Número (opcional)</span><input v-model="form.number" class="form-input" placeholder="5575..." /></label>
        <label class="flex items-center gap-2 text-sm text-slate-700"><input v-model="form.qrcode" type="checkbox" /> Habilitar pareamento/QR quando suportado</label>
        <div class="flex justify-end gap-2 pt-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary" :disabled="creating">{{ creating ? 'Criando...' : 'Criar instância' }}</button></div>
      </form>
    </ModalDialog>
  </section>
</template>
