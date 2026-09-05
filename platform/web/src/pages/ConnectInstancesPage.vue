<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Cable, CirclePlus, Import, Link2, RefreshCw, RotateCcw, Trash2, Unlink } from 'lucide-vue-next'
import {
  adoptEngineInstance,
  connectEngineInstance,
  createEngineInstance,
  deleteEngineInstance,
  detachEngineInstance,
  discoverEngineInstances,
  listEngineInstances,
  restartEngineInstance,
  reconcileEngineInstance,
  type PairingResponse,
  type EngineInstance,
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
const adopting = ref(false)
const modal = ref(false)
const adoptModal = ref(false)
const items = ref<EngineInstance[]>([])
const adoptedNames = ref<Set<string>>(new Set())
const form = ref({ alias: '', integration: 'WHATSAPP-BAILEYS', qrcode: true, number: '' })
const adoptForm = ref({ instance_name: '', alias: '', instance_token: '' })
const pairingModal = ref(false)
const pairingItem = ref<EngineInstance | null>(null)
const pairing = ref<PairingResponse | null>(null)
const pairingNumber = ref('')
const pairingLoading = ref(false)
const pairingError = ref('')
let pairingSequence = 0
watch(pairingModal, (open) => {
  if (!open) { pairingSequence++; pairing.value = null; pairingNumber.value = ''; pairingItem.value = null; pairingError.value = ''; pairingLoading.value = false }
})
watch(adoptModal, (open) => { if (!open) adoptForm.value.instance_token = '' })
const qrImage = computed(() => {
  const value = pairing.value?.base64
  return value && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null
})

const onlineCount = computed(() => items.value.filter(item => String(item.state || '').toLowerCase().includes('open')).length)

function isAdopted(item: EngineInstance) {
  return item.origin === 'ADOPTED_EXISTING' || item.status === 'ADOPTED' || adoptedNames.value.has(item.instance_name)
}

async function load() {
  loading.value = true
  try {
    const [listed, discovery] = await Promise.allSettled([listEngineInstances(), discoverEngineInstances()])
    if (listed.status === 'fulfilled') items.value = listed.value
    else throw listed.reason
    if (discovery.status === 'fulfilled') adoptedNames.value = new Set(discovery.value.adopted.map(item => item.instance_name))
  } catch (error) { feedback.fail(error) }
  finally { loading.value = false }
}

async function create() {
  creating.value = true
  try {
    const wantsPairing = form.value.qrcode && form.value.integration === 'WHATSAPP-BAILEYS'
    const created = await createEngineInstance({ ...form.value, number: form.value.number || undefined })
    modal.value = false
    form.value = { alias: '', integration: 'WHATSAPP-BAILEYS', qrcode: true, number: '' }
    feedback.done('Criação registrada. O pareamento é uma etapa independente.')
    await load()
    const item = items.value.find(value => value.id === created.id)
    if (item && wantsPairing && item.status === 'CREATED') { pairingNumber.value = ''; await connect(item) }
  } catch (error) { feedback.fail(error) }
  finally { creating.value = false; await load() }
}

function openAdopt() {
  adoptForm.value = { instance_name: '', alias: '', instance_token: '' }
  adoptModal.value = true
}

async function adopt() {
  if (!adoptForm.value.instance_name || !adoptForm.value.alias) return
  adopting.value = true
  try {
    await adoptEngineInstance({ ...adoptForm.value })
    adoptModal.value = false
    feedback.done('Instância existente vinculada à Platform sem recriar ou desconectar a sessão.')
    await load()
  } catch (error) { feedback.fail(error) }
  finally { adopting.value = false }
}

async function connect(item: EngineInstance) {
  pairingItem.value = item
  pairing.value = null
  pairingModal.value = true
  await refreshPairing()
}

async function refreshPairing() {
  if (!pairingItem.value || pairingLoading.value) return
  const sequence = ++pairingSequence
  pairingLoading.value = true
  pairingError.value = ''
  pairing.value = null
  try {
    const result = await connectEngineInstance(pairingItem.value.id, pairingNumber.value || undefined)
    if (sequence === pairingSequence && pairingModal.value) pairing.value = result
  } catch (error: any) {
    if (sequence === pairingSequence) pairingError.value = error?.response?.data?.error?.message || 'Não foi possível obter o pareamento. A instância continua registrada.'
  } finally { if (sequence === pairingSequence) pairingLoading.value = false }
}

async function reconcile(item: EngineInstance) {
  try { await reconcileEngineInstance(item.id); feedback.done('Criação verificada. Atualize o estado ou solicite o pareamento.') }
  catch (error) { feedback.fail(error) }
  finally { await load() }
}

async function restart(item: EngineInstance) {
  try { await restartEngineInstance(item.id); feedback.done('Reinício solicitado.'); await load() }
  catch (error) { feedback.fail(error) }
}

async function remove(item: EngineInstance) {
  if (isAdopted(item)) {
    const confirmed = await appConfirm({
      title: 'Desvincular instância',
      message: `Desvincular ${item.alias} da Platform? A instância ${item.instance_name} continuará existindo e conectada no Connect|API Engine.`,
      confirmLabel: 'Desvincular',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    })
    if (!confirmed) return
    try {
      await detachEngineInstance(item.id)
      feedback.done('Binding removido. A instância do Engine foi preservada.')
      await load()
    } catch (error) { feedback.fail(error) }
    return
  }

  const confirmed = await appConfirm({
    title: 'Excluir instância',
    message: `Excluir a instância ${item.alias}? Esta instância foi criada pela Platform e a operação remove também a correspondente no Engine.`,
    confirmLabel: 'Excluir instância',
    cancelLabel: 'Cancelar',
    tone: 'danger',
  })
  if (!confirmed) return
  try { await deleteEngineInstance(item.id); feedback.done('Instância removida.'); await load() }
  catch (error) { feedback.fail(error) }
}

onMounted(load)
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Instâncias" subtitle="Criação, conexão e pareamento das instâncias deste ambiente.">
      <template #actions>
        <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="16" /> Atualizar</button>
        <button class="btn-secondary" @click="openAdopt"><Import :size="16" /> Adotar existente</button>
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
        <p class="mt-1 text-sm text-slate-500">Crie uma instância nova ou adote uma que já esteja rodando no Connect|API Engine.</p>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500"><tr><th class="px-5 py-3">Instância</th><th class="px-5 py-3">Provider</th><th class="px-5 py-3">Origem</th><th class="px-5 py-3">Estado</th><th class="px-5 py-3">Engine ID</th><th class="px-5 py-3 text-right">Ações</th></tr></thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="item in items" :key="item.id" class="hover:bg-slate-50/60">
              <td class="px-5 py-4"><p class="font-semibold text-slate-900">{{ item.alias }}</p><p class="mt-0.5 text-xs text-slate-500">{{ item.created_at || '—' }}</p></td>
              <td class="px-5 py-4 text-slate-600">{{ item.provider }}</td>
              <td class="px-5 py-4"><span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="isAdopted(item) ? 'bg-blue-50 text-blue-700' : 'bg-blue-50 text-blue-700'">{{ isAdopted(item) ? 'Adotada' : 'Platform' }}</span></td>
              <td class="px-5 py-4"><StatusBadge :status="item.state || item.status || 'UNKNOWN'" /><p v-if="item.last_error" class="mt-1 max-w-xs text-xs text-rose-600">{{ item.last_error }}</p></td>
              <td class="px-5 py-4 font-mono text-xs text-slate-500">{{ item.instance_name }}</td>
              <td class="px-5 py-4"><div class="flex justify-end gap-2"><button v-if="['CREATING', 'CREATE_PENDING'].includes(item.status)" class="btn-secondary" @click="reconcile(item)">Verificar criação</button><button v-else-if="item.provider === 'WHATSAPP-BAILEYS'" class="icon-btn" title="Conectar" @click="connect(item)"><Link2 :size="16" /></button><button class="icon-btn" title="Reiniciar" @click="restart(item)"><RotateCcw :size="16" /></button><button class="icon-btn" :class="isAdopted(item) ? 'text-amber-600' : 'text-rose-600'" :title="isAdopted(item) ? 'Desvincular da Platform' : 'Excluir instância'" @click="remove(item)"><Unlink v-if="isAdopted(item)" :size="16" /><Trash2 v-else :size="16" /></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ModalDialog v-model="modal" title="Nova instância" description="A instância é registrada primeiro; QR Code ou código são solicitados em uma etapa separada.">
      <form class="space-y-4" @submit.prevent="create">
        <label class="block"><span class="form-label">Identificador amigável</span><input v-model="form.alias" class="form-input" placeholder="atendimento" required /></label>
        <label class="block"><span class="form-label">Provider</span><select v-model="form.integration" class="form-input"><option>WHATSAPP-BAILEYS</option><option>WHATSAPP-BUSINESS</option><option>CONNECT</option></select></label>
        <label class="block"><span class="form-label">Número (opcional)</span><input v-model="form.number" class="form-input" placeholder="5575..." /></label>
        <label class="flex items-center gap-2 text-sm text-slate-700"><input v-model="form.qrcode" type="checkbox" /> Habilitar pareamento/QR quando suportado</label>
        <div class="flex justify-end gap-2 pt-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary" :disabled="creating">{{ creating ? 'Criando...' : 'Criar instância' }}</button></div>
      </form>
    </ModalDialog>

    <ModalDialog v-model="adoptModal" title="Adotar instância existente" description="Cria somente o vínculo de governança. Não recria a instância, não solicita QR e não altera a sessão WhatsApp existente.">
      <form class="space-y-4" @submit.prevent="adopt">
        <label class="block"><span class="form-label">Nome exato da instância no Engine</span><input v-model="adoptForm.instance_name" class="form-input" required /></label>
        <label class="block"><span class="form-label">Chave individual da instância</span><input v-model="adoptForm.instance_token" type="password" autocomplete="off" class="form-input" required minlength="12" /><span class="mt-1 block text-xs text-slate-500">Comprovação de acesso. Não utilize a chave global da plataforma.</span></label>
        <label class="block"><span class="form-label">Identificador neste ambiente</span><input v-model="adoptForm.alias" class="form-input" required placeholder="atendimento" /></label>
        <div class="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><strong>Adoção não destrutiva:</strong> o Connect|API Engine continua com o mesmo banco, arquivos de sessão, JID, contatos, mensagens e conexão. A Platform passa apenas a governar esta instância.</div>
        <div class="flex justify-end gap-2 pt-2"><button type="button" class="btn-secondary" @click="adoptModal=false">Cancelar</button><button class="btn-primary" :disabled="adopting">{{ adopting ? 'Vinculando...' : 'Adotar sem recriar' }}</button></div>
      </form>
    </ModalDialog>
    <ModalDialog v-model="pairingModal" title="Conectar WhatsApp" description="No celular, abra Dispositivos conectados. A instância permanece registrada mesmo sem pareamento.">
      <div class="space-y-4">
        <label class="block"><span class="form-label">Telefone com país e DDD (somente para código)</span><input v-model="pairingNumber" class="form-input" inputmode="tel" placeholder="Deixe vazio para QR Code" /></label>
        <button class="btn-primary" :disabled="pairingLoading" @click="refreshPairing">{{ pairingLoading ? 'Aguardando WhatsApp...' : 'Obter / atualizar pareamento' }}</button>
        <p v-if="pairingError" role="alert" class="text-sm text-rose-600">{{ pairingError }}</p>
        <img v-if="qrImage" :src="qrImage" alt="QR Code para conectar WhatsApp" class="mx-auto h-64 w-64 object-contain" />
        <p v-if="pairing?.pairing_code" class="text-center font-mono text-3xl font-bold tracking-widest">{{ pairing.pairing_code }}</p>
        <p v-if="pairing?.state === 'open'" class="text-center text-emerald-700">WhatsApp conectado.</p>
        <p v-else-if="pairing?.pending" class="text-sm text-slate-600">O WhatsApp ainda está preparando a conexão. Aguarde alguns segundos e atualize o pareamento.</p>
        <p class="text-xs text-slate-500">O QR Code e o código são temporários. Não compartilhe este conteúdo.</p>
      </div>
    </ModalDialog>

  </section>
</template>
