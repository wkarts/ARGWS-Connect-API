<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import StatusPill from '@/components/StatusPill.vue'
import AppModal from '@/components/AppModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'

const route = useRoute()
const router = useRouter()
const data = ref<any>(null)
const error = ref('')
const feedback = ref('')
const busy = ref(false)
const id = String(route.params.id)
const qrOpen = ref(false)
const pairOpen = ref(false)
const qrImage = ref('')
const pairCode = ref('')
const pairNumber = ref('')
let watchTimer: number | undefined

const connected = computed(() => String(data.value?.connectionStatus || data.value?.status || '').toLowerCase() === 'open')

async function load() {
  error.value = ''
  try { data.value = await connect.connection(id) }
  catch (e) { error.value = friendlyError(e) }
}

function stopWatch() {
  if (watchTimer) window.clearInterval(watchTimer)
  watchTimer = undefined
}

function watchConnection() {
  stopWatch()
  let attempts = 0
  watchTimer = window.setInterval(async () => {
    attempts += 1
    try {
      await load()
      if (connected.value) {
        qrOpen.value = false
        pairOpen.value = false
        feedback.value = 'Conexão realizada com sucesso.'
        stopWatch()
      } else if (attempts >= 60) stopWatch()
    } catch { /* ainda conectando */ }
  }, 1500)
}

async function restart() {
  busy.value = true; feedback.value = ''; error.value = ''
  try { await connect.restartConnection(id); feedback.value = 'Instância reiniciada.'; await load() }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function disconnect() {
  if (!window.confirm('Desconectar esta instância agora?')) return
  busy.value = true; feedback.value = ''; error.value = ''
  try { await connect.disconnectConnection(id); feedback.value = 'Instância desconectada.'; await load() }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function remove() {
  if (!window.confirm('Excluir definitivamente esta instância e os dados associados?')) return
  busy.value = true; error.value = ''
  try { await connect.removeConnection(id); router.push('/instancias') }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

function extractQr(result: any) {
  return String(result?.base64 || result?.qrcode?.base64 || '')
}
function extractPair(result: any) {
  return String(result?.pairingCode || result?.qrcode?.pairingCode || result?.code || '')
}

async function showQr() {
  busy.value = true; error.value = ''; feedback.value = ''; qrImage.value = ''
  try {
    const result = await connect.connectConnection(id, { pairing: false })
    const image = extractQr(result)
    if (!image.startsWith('data:image')) throw new Error('O QR Code ainda não ficou disponível. Tente novamente em alguns segundos.')
    qrImage.value = image
    qrOpen.value = true
    watchConnection()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function showPair() {
  busy.value = true; error.value = ''; feedback.value = ''; pairCode.value = ''
  try {
    const number = (pairNumber.value || data.value?.number || '').replace(/\D/g, '')
    if (!number) {
      pairOpen.value = true
      return
    }
    const result = await connect.connectConnection(id, { pairing: true, number })
    const code = extractPair(result)
    if (!code) throw new Error('O código ainda não ficou disponível. Tente novamente em alguns segundos.')
    pairCode.value = code
    pairOpen.value = true
    watchConnection()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function copyPair() {
  if (pairCode.value) await navigator.clipboard.writeText(pairCode.value)
}

onMounted(async () => { await load(); pairNumber.value = data.value?.number || '' })
onBeforeUnmount(stopWatch)
</script>

<template>
  <AppShell>
    <PageHeader :title="data?.name || data?.instanceName || 'Instância'" description="Informações e ações da conexão.">
      <button class="btn ghost" :disabled="busy" @click="load"><AppIcon name="refresh" :size="16"/>Atualizar</button>
      <button class="btn ghost" :disabled="busy" @click="restart">Reiniciar</button>
      <button class="btn danger" :disabled="busy || !connected" @click="disconnect">Desconectar</button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>
    <div v-if="!data" class="skeleton-page"></div>

    <template v-else>
      <PanelCard v-if="!connected" title="Conectar WhatsApp" description="Escolha como deseja vincular esta instância.">
        <div class="connect-choice-grid">
          <button class="connect-choice" :disabled="busy" @click="showQr">
            <span class="connect-choice-icon"><AppIcon name="radio" :size="24"/></span>
            <strong>QR Code</strong>
            <small>Escaneie pelo celular para conectar.</small>
          </button>
          <button class="connect-choice" :disabled="busy" @click="showPair">
            <span class="connect-choice-icon"><AppIcon name="hash" :size="24"/></span>
            <strong>Código de pareamento</strong>
            <small>Use um código numérico no celular.</small>
          </button>
        </div>
      </PanelCard>

      <div class="detail-grid top-gap">
        <PanelCard title="Situação atual">
          <div class="detail-list">
            <div><span>Status</span><StatusPill :status="data.connectionStatus || data.status"/></div>
            <div><span>Nome</span><strong>{{ data.name || data.instanceName || '—' }}</strong></div>
            <div><span>Número</span><strong>{{ data.number || data.ownerJid?.split('@')?.[0] || '—' }}</strong></div>
            <div><span>Última atualização</span><strong>{{ data.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-BR') : '—' }}</strong></div>
          </div>
        </PanelCard>
        <PanelCard title="Resumo">
          <div class="summary-tiles">
            <div><b>{{ data._count?.Contact || 0 }}</b><span>Contatos</span></div>
            <div><b>{{ data._count?.Chat || 0 }}</b><span>Conversas</span></div>
            <div><b>{{ data._count?.Message || 0 }}</b><span>Mensagens</span></div>
          </div>
        </PanelCard>
      </div>

      <div class="danger-zone">
        <div><strong>Excluir instância</strong><p>Esta ação remove definitivamente a instância e seus dados associados.</p></div>
        <button class="btn danger" :disabled="busy" @click="remove">Excluir instância</button>
      </div>
    </template>

    <AppModal :open="qrOpen" title="Conectar por QR Code" subtitle="Abra o WhatsApp no celular e escaneie o código." @close="qrOpen=false; stopWatch()">
      <div class="connection-auth-modal">
        <div class="qr-connect-box"><img v-if="qrImage" :src="qrImage" alt="QR Code para conexão"/></div>
        <div class="connection-help"><span class="pulse-dot"></span><strong>Aguardando conexão</strong><p>O código é atualizado pela própria conexão. Esta janela será fechada automaticamente quando o vínculo for concluído.</p></div>
      </div>
    </AppModal>

    <AppModal :open="pairOpen" title="Código de pareamento" subtitle="Vincule a instância usando o código no seu celular." @close="pairOpen=false; stopWatch()">
      <div class="form-stack">
        <label v-if="!pairCode" class="field"><span>Número do WhatsApp</span><input v-model="pairNumber" inputmode="numeric" placeholder="5575999999999"/><small>Informe DDI, DDD e número.</small></label>
        <button v-if="!pairCode" class="btn primary full" :disabled="busy || !pairNumber.replace(/\D/g,'')" @click="showPair">Gerar código</button>
        <template v-else>
          <div class="pair-code-card"><small>Seu código</small><strong>{{ pairCode }}</strong></div>
          <button class="btn ghost full" @click="copyPair"><AppIcon name="copy" :size="16"/>Copiar código</button>
          <div class="connection-help"><span class="pulse-dot"></span><strong>Aguardando conexão</strong><p>Conclua o pareamento no celular. A tela será atualizada automaticamente.</p></div>
        </template>
      </div>
    </AppModal>
  </AppShell>
</template>
