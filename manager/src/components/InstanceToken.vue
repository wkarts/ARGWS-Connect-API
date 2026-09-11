<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useSessionStore } from '@/stores/session'
import { copyInstanceToken, instanceTokenSupported, readInstanceToken } from '@/services/instance-token'

const props = defineProps<{ instanceId: string; instanceName: string }>()
const session = useSessionStore()
const allowed = computed(() => instanceTokenSupported() && session.authenticated && session.hasPermission('instances.read'))
const token = ref('')
const busy = ref(false)
const copied = ref(false)
const error = ref('')
const visible = computed(() => Boolean(token.value))
let sequence = 0
let pending: AbortController | null = null
let hideTimer: ReturnType<typeof setTimeout> | undefined
let feedbackTimer: ReturnType<typeof setTimeout> | undefined

function hide() {
  sequence++
  pending?.abort()
  pending = null
  clearTimeout(hideTimer)
  clearTimeout(feedbackTimer)
  token.value = ''
  busy.value = false
  copied.value = false
  error.value = ''
}

async function act(action: 'show' | 'copy') {
  if (!allowed.value || busy.value) return
  if (action === 'show' && visible.value) { hide(); return }
  const generation = ++sequence
  pending?.abort()
  const controller = new AbortController()
  pending = controller
  error.value = ''
  copied.value = false
  clearTimeout(feedbackTimer)
  busy.value = true
  try {
    const value = await readInstanceToken(props.instanceId, controller.signal)
    if (generation !== sequence || !allowed.value) return
    if (action === 'copy') {
      await copyInstanceToken(value)
      if (generation !== sequence || !allowed.value) return
      copied.value = true
      feedbackTimer = setTimeout(() => { copied.value = false }, 2500)
    } else {
      token.value = value
      clearTimeout(hideTimer)
      hideTimer = setTimeout(hide, 30000)
    }
  } catch (cause) {
    if (generation === sequence && allowed.value) {
      error.value = cause instanceof Error ? cause.message : 'Não foi possível acessar o token.'
    }
  } finally {
    if (generation === sequence) { busy.value = false; pending = null }
  }
}

function visibilityChanged() { if (document.hidden) hide() }
watch(() => [props.instanceId, allowed.value, session.account?.id], hide, { flush: 'sync' })
onMounted(() => {
  document.addEventListener('visibilitychange', visibilityChanged)
  window.addEventListener('blur', hide)
})
onBeforeUnmount(() => {
  hide()
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('blur', hide)
})
</script>

<template>
  <div v-if="allowed" class="instance-token" @click.stop @keydown.stop @keydown.esc="hide">
    <div class="instance-token-row" :aria-busy="busy">
      <span class="instance-token-label">Token</span>
      <code v-if="visible" class="instance-token-value" :aria-label="`Token da instância ${instanceName}`">{{ token }}</code>
      <span v-else class="instance-token-mask" aria-label="Token oculto">••••••••••••</span>
      <button type="button" class="instance-token-button" :disabled="busy" :title="visible ? 'Ocultar token' : 'Mostrar token'" :aria-label="`${visible ? 'Ocultar' : 'Mostrar'} token de ${instanceName}`" :aria-pressed="visible" @click.stop="act('show')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          <path v-if="visible" d="m3 3 18 18" />
        </svg>
      </button>
      <button type="button" class="instance-token-button" :class="{ 'is-copied': copied }" :disabled="busy" :title="copied ? 'Token copiado' : 'Copiar token'" :aria-label="`${copied ? 'Token copiado' : 'Copiar token'} de ${instanceName}`" @click.stop="act('copy')"><AppIcon :name="copied ? 'check' : 'copy'" :size="16" /></button>
    </div>
    <span class="instance-token-feedback" :class="{ 'has-error': error }" role="status" aria-live="polite">{{ error || (copied ? 'Token copiado.' : busy ? 'Consultando token...' : '') }}</span>
  </div>
</template>

<style scoped>
.instance-token { margin: 0 0 12px; min-width: 0; cursor: default; }
.instance-token-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 6px 3px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.instance-token-label { flex: 0 0 auto; color: var(--muted); font-size: 11px; }
.instance-token-value, .instance-token-mask { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); font-size: 11px; }
.instance-token-value { color: var(--text); user-select: all; }
.instance-token-mask { letter-spacing: 2px; user-select: none; }
.instance-token-button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 30px; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.instance-token-button:hover:not(:disabled) { background: var(--primary-soft); color: var(--primary); }
.instance-token-button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.instance-token-button:disabled { opacity: .5; cursor: wait; }
.instance-token-button.is-copied { color: var(--success); }
.instance-token-feedback { display: block; color: var(--muted); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.instance-token-feedback:not(:empty) { padding-top: 4px; }
.instance-token-feedback.has-error { color: var(--danger); }
</style>
