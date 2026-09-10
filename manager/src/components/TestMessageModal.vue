<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppModal from './AppModal.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { featureEnabled, runtime } from '@/config/runtime'
import { useSessionStore } from '@/stores/session'
import { testMessageDestination, testMessageText } from '@/services/test-message-input'
import type { ContactItem } from '@/types/domain'

const props = defineProps<{ instanceId: string; instanceName: string; provider: string; connected: boolean }>()
const emit = defineEmits<{ close: [] }>()
const session = useSessionStore()
const mode = ref<'number' | 'contact'>('number')
const number = ref(''), text = ref(''), query = ref(''), error = ref(''), feedback = ref('')
const contacts = ref<ContactItem[]>([]), selectedId = ref(''), page = ref(1)
const hasMore = ref(false), loading = ref(false), busy = ref(false)
const fields = ref<HTMLElement | null>(null)
let active = true, generation = 0
const maySend = computed(() => featureEnabled('instanceTestMessage', true) && session.hasPermission('messages.send'))
const maySelect = computed(() => featureEnabled('testMessageContacts', false) && session.hasPermission('messages.read') && runtime.compatibility === 'current')
const selected = computed(() => contacts.value.find(item => item.id === selectedId.value))
const filtered = computed(() => contacts.value.filter(item => `${item.name} ${item.number || ''}`.toLocaleLowerCase('pt-BR').includes(query.value.toLocaleLowerCase('pt-BR'))))
const destination = computed(() => {
  try { return mode.value === 'contact' && !selected.value ? '' : testMessageDestination(number.value, mode.value === 'contact' ? selected.value : undefined, props.provider) } catch { return '' }
})
const recipientLabel = computed(() => mode.value === 'contact' ? (selected.value?.number || selected.value?.name || '') : destination.value)
const canSend = computed(() => maySend.value && props.connected && !busy.value && !loading.value && Boolean(destination.value && text.value.trim()) && text.value.length <= 4096)
function close() { if (!busy.value) emit('close') }
function changeMode(value: 'number' | 'contact') {
  if (busy.value || (value === 'contact' && !maySelect.value)) return
  generation++; mode.value = value; selectedId.value = ''; contacts.value = []; page.value = 1
  hasMore.value = false; loading.value = false; error.value = ''; feedback.value = ''; query.value = ''
}
async function loadContacts(nextPage = 1) {
  if (!maySelect.value || busy.value || loading.value) return
  const sequence = ++generation
  loading.value = true; error.value = ''
  try {
    const result = await connect.testMessageContacts(props.instanceId, nextPage)
    if (!active || generation !== sequence || mode.value !== 'contact') return
    contacts.value = result.items.filter(item => {
      try { testMessageDestination('', item, props.provider); return true } catch { return false }
    })
    page.value = nextPage; hasMore.value = result.hasMore; selectedId.value = ''
  } catch (e) { if (active && generation === sequence) error.value = friendlyError(e) }
  finally { if (active && generation === sequence) loading.value = false }
}
async function send() {
  if (busy.value || !maySend.value || !props.connected) return
  error.value = ''; feedback.value = ''
  let target: string, body: string
  try {
    if (mode.value === 'contact' && (!maySelect.value || !selected.value)) throw new Error('Selecione um contato antes de enviar.')
    target = testMessageDestination(number.value, mode.value === 'contact' ? selected.value : undefined, props.provider)
    body = testMessageText(text.value)
  } catch (e) { error.value = friendlyError(e); return }
  busy.value = true
  try {
    await connect.sendText(props.instanceId, target, body)
    if (!active) return
    text.value = ''; feedback.value = 'Envio solicitado com sucesso. A entrega depende da conexão e das regras do WhatsApp.'
  } catch (e) {
    if (active) error.value = `${friendlyError(e)} Não houve reenvio automático; confira o destinatário antes de tentar novamente.`
  } finally { if (active) busy.value = false }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close() }
}
onMounted(async () => { document.addEventListener('keydown', keydown); await nextTick(); fields.value?.querySelector('input')?.focus() })
onBeforeUnmount(() => {
  active = false; generation++; contacts.value = []; selectedId.value = ''; number.value = ''; text.value = ''
  document.removeEventListener('keydown', keydown)
})
</script>
<template>
  <AppModal :open="true" title="Enviar mensagem de teste" :subtitle="instanceName" :dismissible="!busy" @close="close">
    <form ref="fields" class="form-stack" aria-label="Enviar mensagem de teste" @submit.prevent="send">
      <p class="test-notice">Envio pontual para um destinatário. Este formulário não carrega conversas nem histórico de mensagens.</p>
      <div v-if="!connected" class="alert error">A instância precisa estar conectada.</div>
      <div v-if="!maySend" class="alert error">Envio de teste indisponível nesta instalação.</div>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <div v-if="feedback" class="alert success" role="status">{{ feedback }}</div>
      <div v-if="maySelect" class="test-modes" role="group" aria-label="Escolher destinatário">
        <button type="button" :class="['btn', mode === 'number' ? 'primary' : 'ghost']" :disabled="busy" @click="changeMode('number')">Digitar número</button>
        <button type="button" :class="['btn', mode === 'contact' ? 'primary' : 'ghost']" :disabled="busy" @click="changeMode('contact')">Selecionar contato</button>
      </div>
      <label v-if="mode === 'number'" class="field"><span>Telefone do destinatário</span><input v-model="number" :disabled="busy" inputmode="tel" autocomplete="off" maxlength="40" placeholder="Código do país, DDD e número" /><small>Exemplo: 55 + DDD + número. Nenhum código do país é acrescentado automaticamente.</small></label>
      <template v-else>
        <button class="btn ghost" type="button" :disabled="busy || loading" @click="loadContacts(1)">{{ loading ? 'Carregando...' : 'Carregar contatos' }}</button>
        <small>A agenda é consultada somente após esta ação, em páginas de até 50 registros. Nenhuma prévia de conversa é carregada.</small>
        <label class="field"><span>Filtrar esta página</span><input v-model="query" :disabled="busy || loading" autocomplete="off" placeholder="Nome ou telefone" /></label>
        <label class="field"><span>Contato</span><select v-model="selectedId" class="select" :disabled="busy || loading"><option value="">Selecione um contato</option><option v-for="item in filtered" :key="item.id" :value="item.id">{{ item.name }}{{ item.number ? ` — ${item.number}` : ' — telefone não disponível' }}</option></select></label>
        <div class="test-modes"><button v-if="page > 1" type="button" class="btn ghost compact" :disabled="busy || loading" @click="loadContacts(page - 1)">Página anterior</button><button v-if="hasMore" type="button" class="btn ghost compact" :disabled="busy || loading" @click="loadContacts(page + 1)">Próxima página</button></div>
      </template>
      <label class="field"><span>Mensagem</span><textarea v-model="text" rows="4" maxlength="4096" :disabled="busy" placeholder="Digite a mensagem de teste" /><small>{{ text.length }}/4096</small></label>
      <p v-if="recipientLabel" class="test-recipient">Destinatário: <strong>{{ recipientLabel }}</strong></p>
      <p v-if="provider === 'WHATSAPP-BUSINESS'" class="test-notice">O envio oficial continua sujeito à janela de atendimento e às regras da Meta. Este formulário não contorna essas restrições.</p>
    </form>
    <template #footer><button class="btn ghost" :disabled="busy" @click="close">Fechar</button><button class="btn primary" :disabled="!canSend" @click="send">{{ busy ? 'Enviando...' : 'Enviar mensagem' }}</button></template>
  </AppModal>
</template>
<style scoped>
.test-modes { display:flex; gap:8px; flex-wrap:wrap }
.test-notice { margin:0; font-size:13px; color:var(--muted,#64748b); line-height:1.5 }
.test-recipient { overflow-wrap:anywhere }
textarea { width:100%; resize:vertical; min-height:90px }
@media(max-width:540px) { .test-modes .btn { flex:1 } }
</style>
