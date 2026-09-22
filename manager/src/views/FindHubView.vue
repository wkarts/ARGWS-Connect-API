<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import PanelCard from '@/components/PanelCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusPill from '@/components/StatusPill.vue'
import AppShell from '@/layouts/AppShell.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'

const route = useRoute()
const id = String(route.params.id)
const instance = ref<any>(null)
const auth = ref<any>(null)
const devices = ref<any[]>([])
const email = ref('')
const authSession = ref<any>(null)
const busy = ref(false)
const error = ref('')
const feedback = ref('')

const connected = computed(() => auth.value?.ready === true || auth.value?.state === 'READY')

async function load() {
  error.value = ''
  try {
    instance.value = await connect.connection(id)
    auth.value = await connect.findHubAuthStatus(id)
    if (connected.value) devices.value = await connect.findHubDevices(id)
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function startAuth() {
  if (!email.value.trim()) return
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    authSession.value = await connect.findHubAuthStart(id, email.value.trim())
    feedback.value = 'Sessão de vinculação criada. Entregue os dados abaixo ao Credential Provider autorizado.'
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function refreshDevices() {
  busy.value = true
  error.value = ''
  try {
    devices.value = await connect.findHubRefreshDevices(id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function locate(device: any) {
  device.locating = true
  error.value = ''
  try {
    device.lastPosition = await connect.findHubLocate(id, device.id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    device.locating = false
  }
}

async function toggleTracking(device: any) {
  device.busy = true
  error.value = ''
  try {
    if (device.trackingEnabled) await connect.findHubStopTracking(id, device.id)
    else await connect.findHubStartTracking(id, device.id, device.trackingIntervalSeconds || 60)
    devices.value = await connect.findHubDevices(id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    device.busy = false
  }
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value)
  feedback.value = 'Copiado.'
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader
      title="Google Find Hub"
      description="Dispositivos e localização da conta Google vinculada a esta instância."
    >
      <button class="btn ghost" :disabled="busy" @click="load">
        <AppIcon name="refresh" :size="16"/>Atualizar
      </button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>

    <PanelCard
      v-if="!connected"
      title="Vincular conta Google"
      description="A Connect|API cria a sessão, mas não coleta senha nem cookies do navegador."
    >
      <div class="form-stack">
        <label class="field">
          <span>Conta Google</span>
          <input v-model="email" type="email" placeholder="voce@gmail.com" autocomplete="email"/>
        </label>
        <button class="btn primary" :disabled="busy || !email.trim()" @click="startAuth">
          Criar sessão de vinculação
        </button>

        <div v-if="authSession" class="muted-block">
          <strong>Credential Provider</strong>
          <p>A autenticação do usuário acontece fora do backend. Um provider autorizado deve concluir esta sessão pelo endpoint público <code>/findhub/auth/import/:instanceName</code>.</p>
          <div class="detail-list">
            <div>
              <span>Session ID</span>
              <button class="card-link" @click="copy(authSession.sessionId)">{{ authSession.sessionId }}</button>
            </div>
            <div>
              <span>Bridge token</span>
              <button class="card-link" @click="copy(authSession.bridgeToken)">Copiar token temporário</button>
            </div>
            <div>
              <span>Expira</span>
              <strong>{{ new Date(authSession.expiresAt).toLocaleString('pt-BR') }}</strong>
            </div>
          </div>
        </div>
      </div>
    </PanelCard>

    <template v-else>
      <div class="provider-hero">
        <div class="provider-hero-icon"><AppIcon name="radio" :size="24"/></div>
        <div>
          <span>Conta</span>
          <strong>{{ auth?.email || 'Google Find Hub' }}</strong>
          <small>Conectada · {{ devices.length }} dispositivo(s)</small>
        </div>
        <StatusPill status="connected"/>
      </div>

      <PanelCard
        class="top-gap"
        title="Dispositivos"
        description="Todos os dispositivos retornados pela conta vinculada."
      >
        <div class="toolbar">
          <button class="btn ghost" :disabled="busy" @click="refreshDevices">
            <AppIcon name="refresh" :size="16"/>Sincronizar dispositivos
          </button>
        </div>

        <div class="instance-grid top-gap">
          <article v-for="device in devices" :key="device.id" class="instance-card">
            <div class="instance-card-head">
              <div class="instance-avatar">
                <img v-if="device.imageUrl" :src="device.imageUrl" alt=""/>
                <AppIcon v-else name="radio"/>
              </div>
              <div>
                <strong>{{ device.name }}</strong>
                <span>{{ [device.manufacturer, device.model].filter(Boolean).join(' · ') || device.deviceType }}</span>
              </div>
              <StatusPill :status="device.trackingEnabled ? 'ok' : 'attention'"/>
            </div>

            <div class="detail-list">
              <div><span>Tipo</span><strong>{{ device.deviceType }}</strong></div>
              <div><span>Tracking</span><strong>{{ device.trackingEnabled ? `${device.trackingIntervalSeconds}s` : 'Desativado' }}</strong></div>
              <div><span>Última posição</span><strong>{{ device.lastLocationAt ? new Date(device.lastLocationAt).toLocaleString('pt-BR') : '—' }}</strong></div>
            </div>

            <div v-if="device.lastPosition" class="muted-block">
              {{ device.lastPosition.latitude }}, {{ device.lastPosition.longitude }}
              · precisão {{ device.lastPosition.accuracy ?? '—' }} m
            </div>

            <footer class="instance-card-actions">
              <button class="btn ghost" :disabled="device.locating" @click="locate(device)">
                {{ device.locating ? 'Localizando...' : 'Localizar agora' }}
              </button>
              <button
                class="btn"
                :class="device.trackingEnabled ? 'danger' : 'primary'"
                :disabled="device.busy"
                @click="toggleTracking(device)"
              >
                {{ device.trackingEnabled ? 'Parar tracking' : 'Iniciar tracking' }}
              </button>
            </footer>
          </article>
        </div>
      </PanelCard>
    </template>
  </AppShell>
</template>
