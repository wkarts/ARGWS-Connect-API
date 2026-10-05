<script setup lang="ts">
import { computed, ref } from 'vue'
import AppModal from './AppModal.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { featureEnabled } from '@/config/runtime'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ instanceId: string; instanceName: string; provider: string; connected: boolean }>()
const emit = defineEmits<{ close: []; published: [] }>()
const session = useSessionStore()
const type = ref<'text' | 'image' | 'video' | 'audio'>('text')
const content = ref('')
const caption = ref('')
const backgroundColor = ref('#1d4ed8')
const font = ref(1)
const allContacts = ref(false)
const recipients = ref('')
const file = ref<File | null>(null)
const error = ref('')
const feedback = ref('')
const busy = ref(false)

const mayPublish = computed(() => featureEnabled('statusPublish', true) && session.hasPermission('messages.send'))
const recipientList = computed(() => [...new Set(recipients.value.split(/[\s,;\n]+/u).map((item) => item.replace(/\D/g, '')).filter(Boolean))])
const fileAccept = computed(() => type.value === 'image' ? 'image/*' : type.value === 'video' ? 'video/*' : type.value === 'audio' ? 'audio/*' : '')
const canSend = computed(() => {
  if (!mayPublish.value || !props.connected || busy.value) return false
  if (type.value === 'text' && !content.value.trim()) return false
  if (type.value !== 'text' && !file.value) return false
  if (!allContacts.value && !recipientList.value.some((item) => /^\d{8,15}$/u.test(item))) return false
  return true
})

function chooseFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] || null
  error.value = ''
}

function close() {
  if (!busy.value) emit('close')
}

async function publish() {
  if (!canSend.value) return
  if (allContacts.value && !window.confirm('Publicar este Status para todos os contatos cadastrados?')) return
  error.value = ''
  feedback.value = ''
  busy.value = true
  try {
    await connect.sendStatus(props.instanceId, {
      type: type.value,
      content: type.value === 'text' ? content.value.trim() : '',
      caption: caption.value.trim() || undefined,
      backgroundColor: backgroundColor.value,
      font: font.value,
      allContacts: allContacts.value,
      statusJidList: allContacts.value ? undefined : recipientList.value.filter((item) => /^\d{8,15}$/u.test(item)),
    }, file.value || undefined)
    feedback.value = 'Status enviado para o provider. A entrega depende da conexão e das regras do WhatsApp.'
    emit('published')
    content.value = ''
    caption.value = ''
    file.value = null
  } catch (cause) {
    error.value = friendlyError(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppModal :open="true" title="Publicar Status do WhatsApp" :subtitle="instanceName" :dismissible="!busy" @close="close">
    <form class="form-stack" aria-label="Publicar Status do WhatsApp" @submit.prevent="publish">
      <p class="status-notice">A publicação é uma ação separada da criação da instância. Grupos e broadcast permanecem desativados por padrão.</p>
      <div v-if="!connected" class="alert error">A instância precisa estar conectada.</div>
      <div v-if="!mayPublish" class="alert error">Seu perfil não tem permissão para publicar Status nesta instalação.</div>
      <div v-if="provider === 'WHATSAPP-BUSINESS'" class="alert error">Este provider não publica Status pelo Connect|API.</div>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <div v-if="feedback" class="alert success" role="status">{{ feedback }}</div>
      <label class="field"><span>Tipo de Status</span><select v-model="type" class="select" :disabled="busy"><option value="text">Texto</option><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option></select></label>
      <label v-if="type === 'text'" class="field"><span>Texto</span><textarea v-model="content" rows="5" maxlength="4096" :disabled="busy" placeholder="Escreva o Status"/><small>{{ content.length }}/4096</small></label>
      <label v-else class="field"><span>Arquivo</span><input type="file" :accept="fileAccept" :disabled="busy" @change="chooseFile"/><small v-if="file">{{ file.name }}</small><small v-else>Selecione um arquivo compatível com o tipo escolhido.</small></label>
      <label v-if="type !== 'text'" class="field"><span>Legenda (opcional)</span><input v-model="caption" maxlength="1024" :disabled="busy" placeholder="Legenda do Status"/></label>
      <div v-if="type === 'text'" class="field-grid two">
        <label class="field"><span>Cor de fundo</span><input v-model="backgroundColor" type="color" :disabled="busy"/></label>
        <label class="field"><span>Fonte</span><select v-model.number="font" class="select" :disabled="busy"><option v-for="value in 6" :key="value - 1" :value="value - 1">Fonte {{ value }}</option></select></label>
      </div>
      <label class="toggle-field"><input v-model="allContacts" type="checkbox" :disabled="busy"/><span><strong>Publicar para todos os contatos</strong><small>Deixe desmarcado para informar somente números específicos.</small></span></label>
      <label v-if="!allContacts" class="field"><span>Números autorizados</span><textarea v-model="recipients" rows="3" :disabled="busy" placeholder="5575999999999, um por linha ou separados por vírgula"/><small>Use DDI + DDD + número. Nenhum número é adivinhado.</small></label>
    </form>
    <template #footer><button class="btn ghost" :disabled="busy" @click="close">Fechar</button><button class="btn primary" :disabled="!canSend" @click="publish">{{ busy ? 'Publicando...' : 'Publicar Status' }}</button></template>
  </AppModal>
</template>

<style scoped>
.status-notice { margin:0; color:var(--muted,#64748b); font-size:13px; line-height:1.5 }
textarea { width:100%; resize:vertical; min-height:80px }
input[type='color'] { width:100%; padding:4px; min-height:40px }
</style>
