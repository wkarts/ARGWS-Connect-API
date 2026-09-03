<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { MessageSquare, Send } from 'lucide-vue-next'
import { listEngineInstances, sendEngineText, type EngineInstance } from '../api/connectEngine'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import { useFeedback } from '../composables/useFeedback'

const feedback = useFeedback()
const instances = ref<EngineInstance[]>([])
const instanceId = ref('')
const number = ref('')
const text = ref('Olá! Esta mensagem foi enviada pela Connect|API Platform.')
const sending = ref(false)

onMounted(async () => {
  try { instances.value = await listEngineInstances(); instanceId.value = instances.value[0]?.id || '' }
  catch (error) { feedback.fail(error) }
})

async function send() {
  if (!instanceId.value) return feedback.fail(new Error('Selecione uma instância.'))
  sending.value = true
  try {
    await sendEngineText(instanceId.value, { number: number.value, text: text.value })
    feedback.done('Mensagem entregue ao Connect|API Engine.')
  } catch (error) { feedback.fail(error) }
  finally { sending.value = false }
}
</script>

<template>
  <section class="space-y-5">
    <PageHeader title="Mensagens" subtitle="Envio e testes operacionais pelo Engine canônico." />
    <InlineAlert :message="feedback.error.value" type="error" @dismiss="feedback.error.value=''" />
    <InlineAlert :message="feedback.success.value" type="success" @dismiss="feedback.success.value=''" />
    <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form class="card space-y-5 p-6" @submit.prevent="send">
        <div class="grid gap-4 md:grid-cols-2"><label><span class="form-label">Instância</span><select v-model="instanceId" class="form-input" required><option disabled value="">Selecione</option><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.alias }} · {{ item.provider }}</option></select></label><label><span class="form-label">WhatsApp / destinatário</span><input v-model="number" class="form-input" placeholder="5575..." required /></label></div>
        <label class="block"><span class="form-label">Mensagem</span><textarea v-model="text" class="form-input min-h-44 resize-y" required /></label>
        <div class="flex justify-end"><button class="btn-primary" :disabled="sending"><Send :size="16" /> {{ sending ? 'Enviando...' : 'Enviar pelo Engine' }}</button></div>
      </form>
      <aside class="card p-5"><MessageSquare class="text-blue-600" :size="24" /><h2 class="mt-3 font-semibold text-slate-900">API-first</h2><p class="mt-2 text-sm leading-6 text-slate-500">O browser conversa apenas com a Platform API. A chave global do Engine permanece server-side e o binding garante o escopo do tenant.</p></aside>
    </div>
  </section>
</template>
