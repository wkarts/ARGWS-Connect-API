<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import PanelCard from '@/components/PanelCard.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { InstanceConfigKey } from '@/types/domain'
const props = defineProps<{ instanceId: string; transport?: InstanceConfigKey; headerActions?: boolean }>()
const transports = [{ key: 'webhook', label: 'Webhook' }, { key: 'websocket', label: 'WebSocket' }, { key: 'rabbitmq', label: 'RabbitMQ' }, { key: 'nats', label: 'NATS' }, { key: 'sqs', label: 'SQS' }, { key: 'kafka', label: 'Kafka' }, { key: 'pusher', label: 'Pusher' }] as const
const events = [
  ['FINDHUB_DEVICES_UPDATED','Catálogo de dispositivos atualizado'], ['FINDHUB_LOCATION_UPDATED','Localização recebida'],
  ['FINDHUB_TRACKING_UPDATE','Rastreamento alterado'], ['FINDHUB_ERROR','Falha do canal'], ['CONNECTION_UPDATE','Conexão alterada'],
] as const
const selected = ref<InstanceConfigKey>(props.transport || 'webhook'), value = ref<any>({}), headers = ref('{}'), busy = ref(false), error = ref(''), feedback = ref('')
async function load() {
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    const raw = await connect.loadInstanceConfig(props.instanceId, selected.value)
    const row = raw?.[selected.value] ?? raw ?? {}
    value.value = { enabled: Boolean(row.enabled), events: Array.isArray(row.events) ? row.events.filter((e: string) => events.some(([key]) => key === e)) : [],
      ...(selected.value === 'webhook' ? { url: row.url || '', byEvents: row.webhookByEvents ?? row.byEvents ?? false, base64: false } : {}),
      ...(selected.value === 'pusher' ? { appId: row.appId || '', key: row.key || '', secret: row.secret || '', cluster: row.cluster || '', useTLS: true } : {}),
    }
    headers.value = JSON.stringify(row.headers || {}, null, 2)
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    if (value.value.enabled && !value.value.events.length) throw new Error('Selecione ao menos um evento do canal.')
    const payload = { ...value.value }
    if (selected.value === 'webhook') {
      if (payload.enabled && !/^https?:\/\//i.test(payload.url)) throw new Error('Informe uma URL HTTP ou HTTPS válida.')
      const parsed = JSON.parse(headers.value)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(v => typeof v !== 'string')) throw new Error('Cabeçalhos devem ser um objeto JSON de strings.')
      payload.headers = parsed
    }
    await connect.saveInstanceConfig(props.instanceId, selected.value, payload)
    feedback.value = 'Entrega de eventos atualizada.'
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
watch(() => props.transport, value => { if (value && transports.some(t => t.key === value)) { selected.value = value; void load() } })
defineExpose({ save, busy, ready: value })
onMounted(load)
</script>
<template>
  <PanelCard title="Entrega de eventos de localização" description="Utilize somente os transportes habilitados na sua instalação. Credenciais Google nunca fazem parte dos eventos.">
    <div class="form-stack">
      <label v-if="!transport" class="field"><span>Transporte</span><select class="select" v-model="selected" :disabled="busy" @change="load"><option v-for="item in transports" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
      <div v-if="error" class="alert error">{{ error }}</div><div v-if="feedback" class="alert success">{{ feedback }}</div>
      <label class="toggle-field"><input v-model="value.enabled" type="checkbox" :disabled="busy" /><span>Habilitar entrega neste transporte</span></label>
      <template v-if="selected==='webhook'"><label class="field"><span>Destino do Webhook</span><input v-model="value.url" type="url" placeholder="https://seu-sistema/webhooks/localizacao" /></label><label class="field"><span>Cabeçalhos (JSON)</span><textarea v-model="headers" rows="3" spellcheck="false"></textarea></label><label class="toggle-field"><input v-model="value.byEvents" type="checkbox" /><span>Adicionar o nome do evento ao caminho do destino</span></label></template>
      <template v-if="selected==='pusher'"><label v-for="key in ['appId','key','secret','cluster']" :key="key" class="field"><span>{{ key }}</span><input v-model="value[key]" :type="key==='secret' ? 'password' : 'text'" autocomplete="off" /></label></template>
      <div class="event-selector"><div class="event-selector-head"><div><strong>Eventos do Google Find Hub</strong><small>Selecione os eventos que serão enviados neste transporte.</small></div></div><div class="event-grid"><label v-for="[key,label] in events" :key="key" :class="['event-option',{active:value.events?.includes(key)}]"><input v-model="value.events" type="checkbox" :value="key" :disabled="busy" /><span>{{ label }}</span></label></div></div>
      <p class="muted">A entrega de localização pode transmitir dados sensíveis. Autorize somente destinos de sua confiança. O estado da autenticação é consultado pela API; esta tela não oferece eventos de autenticação que o backend não emite.</p>
      <div v-if="!headerActions" class="toolbar"><button class="btn primary" :disabled="busy" @click="save">{{ busy ? 'Aguarde…' : 'Salvar entrega de eventos' }}</button></div>
    </div>
  </PanelCard>
</template>
