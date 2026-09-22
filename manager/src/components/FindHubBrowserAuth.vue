<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import PanelCard from '@/components/PanelCard.vue'
import { connect } from '@/services/connect'
import { runtime } from '@/config/runtime'
import { FINDHUB_EXTENSION_ID } from '@/services/findhub-extension-id'
import { compatibleFindHubHelper, consumedFindHubAttempt } from '@/services/findhub-auth-state'
import { friendlyError } from '@/services/errors'
const props = defineProps<{ instanceId: string; initialEmail?: string }>()
const emit = defineEmits<{ connected: [] }>()
const email = ref(props.initialEmail || ''), busy = ref(false), stage = ref(''), error = ref(''), downloading = ref(false)
let port: any = null
let proof: { sessionId: string; bridgeToken: string } | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let deadline: ReturnType<typeof setTimeout> | null = null
let attempt = 0
let processing: 'exchange' | 'complete' | null = null
function closePort() {
  if (heartbeat) clearInterval(heartbeat)
  if (deadline) clearTimeout(deadline)
  heartbeat = null; deadline = null
  const previous = port; port = null
  try { previous?.disconnect() } catch { /* no active port */ }
}
async function cancel() {
  attempt++
  const pending = proof; proof = null
  try { port?.postMessage({ type: 'CANCEL', sessionId: pending?.sessionId }) } catch { /* closed */ }
  closePort(); busy.value = false; stage.value = ''; processing = null
  if (pending) {
    try { await connect.findHubBrowserAuth(props.instanceId, 'cancel', pending) }
    catch { /* Backend rejects cancellation during a final verification; status remains authoritative. */ }
  }
}
async function start() {
  if (busy.value || !email.value.trim()) return
  error.value = ''; stage.value = ''; busy.value = true
  const serial = ++attempt
  try {
    const chromeRuntime = (globalThis as any).chrome?.runtime
    if (!chromeRuntime?.connect) throw new Error('Instale a extensão de autenticação no Chrome/Edge do computador e recarregue esta página. O fluxo não é suportado neste navegador mobile.')
    port = chromeRuntime.connect(FINDHUB_EXTENSION_ID, { name: 'connect-findhub-auth-v1' })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Extensão não encontrada. Instale-a e recarregue a interface.')), 4000)
      port.onMessage.addListener((message: any) => {
        if (message.type !== 'PONG') return
        clearTimeout(timer)
        if (!compatibleFindHubHelper(message.version)) {
          reject(new Error('Atualize a extensão Find Hub Auth para 0.1.4 ou superior, recarregue-a na página de extensões e atualize o Manager.'))
        } else resolve()
      })
      port.onDisconnect.addListener(() => {
        void chromeRuntime.lastError
        clearTimeout(timer)
        reject(new Error('Extensão não encontrada ou permissão de acesso recusada.'))
        if (serial === attempt && proof) {
          if (!error.value) error.value = 'A vinculação foi encerrada. Consulte o estado da conta antes de tentar novamente.'
          void cancel()
        }
      })
      port.postMessage({ type: 'PING' })
    })
    stage.value = 'Preparando a identidade do receptor nos serviços Google…'
    const session = await connect.findHubBrowserAuth(props.instanceId, 'start', { email: email.value.trim() })
    if (serial !== attempt) {
      try { await connect.findHubBrowserAuth(props.instanceId, 'cancel', { sessionId: session.sessionId, bridgeToken: session.bridgeToken }) } catch { /* expired */ }
      return
    }
    proof = { sessionId: session.sessionId, bridgeToken: session.bridgeToken }
    deadline = setTimeout(() => { error.value = 'A vinculação expirou. Inicie novamente.'; void cancel() }, Math.max(1, Date.parse(session.expiresAt) - Date.now()))
    heartbeat = setInterval(() => { try { port?.postMessage({ type: 'PING' }) } catch { void cancel() } }, 15000)
    port.onMessage.addListener((message: any) => {
      if (serial !== attempt || !proof || (message.sessionId && message.sessionId !== proof.sessionId)) return
      void (async () => {
        if (message.type === 'ERROR') throw new Error(message.message || 'A vinculação foi interrompida.')
        if (message.type === 'WAITING_CONSENT') stage.value = 'Confirme a origem e autorize a vinculação na janela da extensão.'
        if (message.type === 'WAITING_USER') stage.value = 'Faça login diretamente no Google. Mantenha esta página aberta.'
        if (message.type === 'WAITING_VAULT_KEY') stage.value = 'Conclua o desbloqueio do Find Hub na página do Google.'
        if (message.type === 'OAUTH_TOKEN') {
          if (processing) return
          processing = 'exchange'
          stage.value = 'Validando a conta Google…'
          const response = await connect.findHubBrowserAuth(props.instanceId, 'exchange', { ...proof, oauthToken: message.oauthToken })
          if (serial !== attempt || !proof) return
          port?.postMessage({ type: 'UNLOCK', sessionId: proof.sessionId, unlockUrl: response.unlockUrl })
        }
        if (message.type === 'VAULT_KEYS') {
          if (processing !== 'exchange') return
          processing = 'complete'
          stage.value = 'Validando a chave, a conexão e o catálogo de dispositivos…'
          const response = await connect.findHubBrowserAuth(props.instanceId, 'complete', { ...proof, vaultKeys: message.vaultKeys })
          if (serial !== attempt || !proof) return
          if (response.connected !== true) throw new Error('O backend não confirmou uma conexão válida.')
          const sessionId = proof.sessionId; proof = null; attempt++
          port?.postMessage({ type: 'DONE', sessionId }); closePort(); busy.value = false
          processing = null
          stage.value = 'Conta conectada e validada.'; emit('connected')
        }
      })().catch(async (e) => {
        if (serial !== attempt) return
        error.value = friendlyError(e)
        if (consumedFindHubAttempt(e)) proof = null
        await cancel()
      })
    })
    port.postMessage({ type: 'BEGIN', sessionId: proof.sessionId, email: email.value.trim(), apiOrigin: new URL(runtime.apiBaseUrl).origin })
  } catch (e) { error.value = friendlyError(e); await cancel() }
}
async function download() {
  downloading.value = true; error.value = ''
  try { await connect.findHubDownloadHelper(props.instanceId) }
  catch (e) { error.value = friendlyError(e) }
  finally { downloading.value = false }
}
onBeforeUnmount(() => { void cancel() })
</script>
<template>
  <PanelCard title="Conectar conta Google" description="Você faz login diretamente no Google. A Connect|API valida e protege as credenciais recebidas.">
    <div class="form-stack">
      <div class="alert">Autenticação assistida por extensão própria, para Chrome/Edge no computador. É uma alternativa experimental ao fluxo puramente web; não funciona em qualquer navegador mobile e ainda exige homologação com sua conta. Nenhum aplicativo é instalado no smartphone que será localizado.</div>
      <details><summary>Preparar o navegador uma única vez</summary><p>Obtenha a extensão desta instalação, extraia o ZIP e abra a página de extensões do navegador. Ative o modo de desenvolvedor, escolha “Carregar sem compactação” e selecione a pasta extraída. Para atualizar, substitua os arquivos da pasta já carregada e clique em “Recarregar” na extensão. Confirme a versão 0.1.4 e recarregue a interface. Durante a vinculação, confira os destinos na janela da extensão antes de autorizar.</p><p>O protocolo privado pode produzir credenciais Google de alcance amplo. Use somente sua própria instalação confiável. Senha, PIN e confirmações são informados exclusivamente nas páginas Google.</p><button class="btn ghost" :disabled="downloading || busy" @click="download">{{ downloading ? 'Preparando…' : 'Obter extensão de autenticação' }}</button><p><a class="btn ghost" href="https://github.com/wkarts/ARGWS-Connect-API/releases?q=findhub" target="_blank" rel="noopener noreferrer">Instalador Windows e versões publicadas</a></p><p>O instalador prepara/atualiza os arquivos. O navegador ainda exige Carregar sem compactação ou Recarregar; nenhuma permissão é concedida silenciosamente. Escolha a distribuição correspondente ao seu canal e à versão da API.</p></details>
      <label class="field"><span>Conta Google a vincular</span><input v-model="email" type="email" maxlength="320" autocomplete="email" :disabled="busy" placeholder="sua-conta@gmail.com" /></label>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <p v-if="stage" role="status">{{ stage }}</p>
      <div class="toolbar"><button class="btn primary" :disabled="busy || !email.trim()" @click="start">{{ busy ? 'Aguardando vinculação…' : 'Conectar conta Google' }}</button><button v-if="busy" class="btn ghost" @click="cancel">Cancelar</button></div>
      <p class="muted">A mesma sequência está disponível na API para frontends externos. Você não precisa copiar identificadores nem tokens internos. Fechar esta página interrompe a tentativa, exceto uma verificação final já aceita pelo servidor.</p>
    </div>
  </PanelCard>
</template>
