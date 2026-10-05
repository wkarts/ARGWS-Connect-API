<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import ManagerEmbeddingSettings from '@/components/ManagerEmbeddingSettings.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { useRouter } from 'vue-router'
import { runtime } from '@/config/runtime'

const current=ref(''),next=ref(''),confirm=ref(''),message=ref(''),error=ref(''),busy=ref(false)
const speechHealth=ref<any>(null),speechError=ref('')
const session=useSessionStore(),ui=useUiStore(),router=useRouter()
const accountMode = computed(() => runtime.authMode === 'account')

async function loadSpeechHealth() {
  speechError.value=''
  try { speechHealth.value=await connect.speechHealth() }
  catch(e) { speechError.value=friendlyError(e) }
}

async function change(){
  error.value='';message.value=''
  if(next.value!==confirm.value){error.value='As senhas não conferem.';return}
  busy.value=true
  try{
    await connect.changePassword(current.value,next.value)
    message.value='Senha alterada. Entre novamente.'
    await session.logout()
    setTimeout(()=>router.push('/login'),700)
  }catch(e){error.value=friendlyError(e)}finally{busy.value=false}
}

onMounted(loadSpeechHealth)
</script>
<template>
  <AppShell>
    <PageHeader title="Configurações" description="Preferências da sua conta e do uso diário."/>
    <div class="settings-grid">
      <PanelCard title="Aparência" description="Escolha como deseja visualizar o Connect|API.">
        <div class="appearance-choice">
          <button class="appearance-option" :class="{active:ui.theme==='light'}" @click="ui.setTheme('light')"><span class="appearance-preview light"></span><strong>Claro</strong><small>Padrão recomendado</small></button>
          <button class="appearance-option" :class="{active:ui.theme==='dark'}" @click="ui.setTheme('dark')"><span class="appearance-preview dark"></span><strong>Escuro</strong><small>Para ambientes com pouca luz</small></button>
        </div>
      </PanelCard>
      <ManagerEmbeddingSettings />
      <PanelCard title="Voz" description="Ditado nos campos e transcrição de áudio com processamento local.">
        <div v-if="speechError" class="alert error">{{ speechError }}</div>
        <div v-else-if="!speechHealth" class="muted-block">Consultando o serviço de voz...</div>
        <div v-else class="speech-settings">
          <div><span>Serviço</span><strong :class="speechHealth.enabled ? 'speech-ready' : 'speech-unavailable'">{{ speechHealth.enabled ? 'Habilitado' : 'Desabilitado' }}</strong></div>
          <div><span>Modelo local</span><strong>{{ speechHealth.model || 'Não configurado' }}</strong></div>
          <div><span>Worker de transcrição</span><strong>{{ speechHealth.workerReady ? 'Pronto' : 'Indisponível' }}</strong></div>
          <div><span>Worker de ditado</span><strong>{{ speechHealth.dictationWorkerReady ? 'Pronto' : 'Indisponível' }}</strong></div>
          <div><span>Fila de transcrição</span><strong>{{ Number(speechHealth.queuedJobs || 0) }}</strong></div>
          <div><span>Fila de ditado</span><strong>{{ Number(speechHealth.dictationQueuedJobs || 0) }}</strong></div>
          <small>A API instala o modelo em ./models e os workers reutilizam os arquivos desse volume após reinícios e atualizações.</small>
        </div>
      </PanelCard>
      <PanelCard v-if="accountMode" title="Alterar senha">
        <div v-if="error" class="alert error">{{error}}</div><div v-if="message" class="alert success">{{message}}</div>
        <div class="form-stack"><label class="field"><span>Senha atual</span><input v-model="current" type="password"/></label><label class="field"><span>Nova senha</span><input v-model="next" type="password" minlength="12"/></label><label class="field"><span>Confirmar nova senha</span><input v-model="confirm" type="password"/></label><button class="btn primary" :disabled="busy" @click="change">Alterar senha</button></div>
      </PanelCard>
    </div>
  </AppShell>
</template>

<style scoped>
.speech-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.speech-settings>div{display:grid;gap:4px}.speech-settings span,.speech-settings small{color:var(--muted);font-size:11px}.speech-settings strong{font-size:13px}.speech-settings .speech-ready{color:#16803c}.speech-settings .speech-unavailable{color:#a16207}.speech-settings small{grid-column:1/-1;line-height:1.5}@media(max-width:600px){.speech-settings{grid-template-columns:1fr}.speech-settings small{grid-column:auto}}
</style>
