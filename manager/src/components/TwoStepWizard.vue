<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { useSessionStore } from '@/stores/session'

const props = withDefaults(defineProps<{ open: boolean; required?: boolean }>(), { required: false })
const emit = defineEmits<{ close: []; complete: [] }>()
const session = useSessionStore()
const step = ref(1), password = ref(''), code = ref(''), secret = ref(''), uri = ref(''), qr = ref(''), recovery = ref<string[]>([]), error = ref(''), busy = ref(false)
const canClose = computed(() => !props.required && step.value !== 3)
watch(() => props.open, (v) => { if(v){ step.value=1; password.value=''; code.value=''; error.value=''; recovery.value=[] } })
async function start(){ error.value=''; busy.value=true; try{ const r:any=await connect.beginTwoStep(password.value); secret.value=r.secret; uri.value=r.otpauthUri; qr.value=await QRCode.toDataURL(uri.value,{width:280,margin:2,errorCorrectionLevel:'M'}); step.value=2 }catch(e){ error.value=friendlyError(e) }finally{ busy.value=false } }
async function confirm(){ error.value=''; busy.value=true; try{ const r=await connect.confirmTwoStep(code.value); session.session=r.session; recovery.value=r.recoveryCodes; step.value=3 }catch(e){ error.value=friendlyError(e) }finally{ busy.value=false } }
async function copy(text:string){ await navigator.clipboard.writeText(text).catch(()=>null) }
function done(){ emit('complete'); emit('close') }
</script>
<template>
  <AppModal :open="open" title="Ativar verificação em duas etapas" :subtitle="required ? 'Conclua a proteção da sua conta para continuar.' : 'Adicione uma camada extra de proteção ao seu acesso.'" :wide="true" :dismissible="canClose" @close="emit('close')">
    <div class="wizard-steps"><div v-for="n in 3" :key="n" :class="{active:step===n,done:step>n}"><span>{{ step>n?'✓':n }}</span><b>{{ ['Confirmar identidade','Vincular aplicativo','Salvar recuperação'][n-1] }}</b></div></div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="step===1" class="wizard-panel"><div class="wizard-intro"><span><AppIcon name="shield" :size="26"/></span><div><h3>Confirme sua identidade</h3><p>Digite sua senha atual para iniciar a configuração com segurança.</p></div></div><label class="field"><span>Senha atual</span><input v-model="password" type="password" autocomplete="current-password" @keyup.enter="start" /></label></div>
    <div v-else-if="step===2" class="wizard-grid"><div class="qr-column"><h3>Escaneie o QR Code</h3><p>Abra seu aplicativo autenticador e adicione uma nova conta.</p><div class="qr-box"><img v-if="qr" :src="qr" alt="QR Code para configurar a proteção da conta" /></div></div><div class="verify-column"><ol class="steps-list"><li><span>1</span><p>Abra o aplicativo autenticador no celular.</p></li><li><span>2</span><p>Escolha adicionar uma nova conta e escaneie o código.</p></li><li><span>3</span><p>Digite abaixo o código de 6 dígitos exibido no aplicativo.</p></li></ol><details class="manual-key"><summary>Não consegue escanear? Usar chave manual</summary><div><code>{{ secret }}</code><button class="btn ghost compact" @click="copy(secret)"><AppIcon name="copy" :size="16"/>Copiar</button></div></details><label class="field"><span>Código de 6 dígitos</span><input v-model="code" class="otp-input" inputmode="numeric" maxlength="6" placeholder="000000" @input="code=code.replace(/\D/g,'').slice(0,6)" @keyup.enter="confirm"/></label></div></div>
    <div v-else class="recovery-step"><span class="success-orb"><AppIcon name="check" :size="30"/></span><h3>Proteção ativada com sucesso</h3><p>Guarde os códigos abaixo em local seguro. Cada código pode ser usado uma única vez.</p><div class="recovery-grid"><code v-for="item in recovery" :key="item">{{ item }}</code></div><button class="btn ghost" @click="copy(recovery.join('\n'))"><AppIcon name="copy" :size="17"/>Copiar todos</button></div>
    <template #footer><button v-if="step===1 && canClose" class="btn ghost" @click="emit('close')">Cancelar</button><button v-if="step===1" class="btn primary" :disabled="busy || !password" @click="start">{{ busy?'Validando...':'Continuar' }}<AppIcon name="arrow" :size="17"/></button><button v-if="step===2" class="btn ghost" @click="step=1">Voltar</button><button v-if="step===2" class="btn primary" :disabled="busy || code.length!==6" @click="confirm">{{ busy?'Verificando...':'Verificar e ativar' }}<AppIcon name="arrow" :size="17"/></button><button v-if="step===3" class="btn primary" @click="done">Concluí</button></template>
  </AppModal>
</template>
