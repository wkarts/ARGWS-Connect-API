<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PanelCard from '@/components/PanelCard.vue'
import { runtime } from '@/config/runtime'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ManagerEmbeddingSettings } from '@/types/domain'

const supported = computed(() => runtime.compatibility === 'current')
const settings = ref<ManagerEmbeddingSettings | null>(null)
const enabled = ref(false)
const originsText = ref('')
const busy = ref(false)
const error = ref('')
const message = ref('')
const probeBusy = ref(false)
const probe = ref<{ status: number; frameAncestors: string; xFrameOptions: string; embedding: string } | null>(null)

function apply(value: ManagerEmbeddingSettings) {
  settings.value = value
  enabled.value = Boolean(value.enabled)
  originsText.value = (value.allowedOrigins || []).join('\n')
}

async function load() {
  if (!supported.value) return
  error.value = ''
  try {
    apply(await connect.embeddingSettings())
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function save() {
  if (!settings.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    const allowedOrigins = originsText.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    const updated = await connect.saveEmbeddingSettings({
      version: settings.value.version,
      enabled: enabled.value,
      allowedOrigins,
    })
    apply(updated)
    message.value = 'Origens de iframe atualizadas. A política já passa a valer nas novas respostas da aplicação.'
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function verifyPublicResponse() {
  probeBusy.value = true
  probe.value = null
  error.value = ''
  try {
    const response = await fetch('/manager/login', { method: 'HEAD', cache: 'no-store', credentials: 'omit' })
    const csp = response.headers.get('content-security-policy') || ''
    const frameAncestors = csp
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.toLowerCase().startsWith('frame-ancestors')) || ''
    probe.value = {
      status: response.status,
      frameAncestors,
      xFrameOptions: response.headers.get('x-frame-options') || '',
      embedding: response.headers.get('x-connect-manager-embedding') || '',
    }
  } catch (e) {
    error.value = 'Não foi possível verificar a resposta pública: ' + friendlyError(e)
  } finally {
    probeBusy.value = false
  }
}

onMounted(load)
</script>

<template>
  <PanelCard
    v-if="supported"
    title="Incorporação em iframe"
    description="Autorize exatamente quais Hubs, portais ou sistemas podem exibir esta interface dentro de um iframe."
  >
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="message" class="alert success">{{ message }}</div>

    <div v-if="settings" class="form-stack">
      <div v-if="settings.source === 'environment' && settings.allowAnyOrigin" class="alert">
        O bootstrap atual do ambiente permite qualquer origem. Salve uma lista abaixo para que o cadastro no banco passe a ser a política oficial.
      </div>

      <label class="toggle-row">
        <input v-model="enabled" type="checkbox" />
        <span>
          <strong>Permitir incorporação</strong>
          <small>Quando desativado, a aplicação responde com <code>frame-ancestors 'none'</code>.</small>
        </span>
      </label>

      <label class="field">
        <span>Origens autorizadas — uma por linha</span>
        <textarea
          v-model="originsText"
          rows="5"
          spellcheck="false"
          placeholder="https://hub-dev.argws.com.br&#10;https://hub.argws.com.br"
        ></textarea>
        <small>Cadastre somente a origem HTTPS, sem caminho, query, credenciais ou curinga. Máximo de 12 origens.</small>
      </label>

      <div class="embedding-meta">
        <span><strong>Fonte:</strong> {{ settings.source === 'database' ? 'Cadastro da aplicação' : 'Bootstrap do ambiente' }}</span>
        <span><strong>Política efetiva:</strong> <code>{{ settings.effectiveFrameAncestors }}</code></span>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="busy" @click="save">
          {{ busy ? 'Salvando…' : 'Salvar origens autorizadas' }}
        </button>
        <button class="btn ghost" :disabled="probeBusy" @click="verifyPublicResponse">
          {{ probeBusy ? 'Verificando…' : 'Verificar resposta pública' }}
        </button>
      </div>

      <div v-if="probe" class="probe-box">
        <strong>Resposta pública da aplicação</strong>
        <span>HTTP {{ probe.status }}</span>
        <span>CSP: <code>{{ probe.frameAncestors || 'sem frame-ancestors' }}</code></span>
        <span>X-Frame-Options: <code>{{ probe.xFrameOptions || 'ausente' }}</code></span>
        <span>Embedding: <code>{{ probe.embedding || 'não informado' }}</code></span>
        <small v-if="probe.xFrameOptions">
          Existe X-Frame-Options na resposta final. Se a aplicação já estiver atualizada, confira o CloudPanel/Nginx/CDN que publica este domínio.
        </small>
      </div>
    </div>
    <div v-else-if="!error" class="muted">Carregando configuração de incorporação…</div>
  </PanelCard>
</template>

<style scoped>
.toggle-row{display:flex;align-items:flex-start;gap:12px}.toggle-row input{margin-top:4px}.toggle-row span{display:flex;flex-direction:column;gap:4px}.embedding-meta{display:grid;gap:8px}.actions{display:flex;gap:10px;flex-wrap:wrap}.probe-box{display:grid;gap:6px;padding:14px;border:1px solid var(--border);border-radius:12px}.probe-box code,.embedding-meta code{overflow-wrap:anywhere}
</style>
