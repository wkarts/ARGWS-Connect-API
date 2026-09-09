<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AuthShell from '@/layouts/AuthShell.vue'
import { useSessionStore } from '@/stores/session'
import { friendlyError } from '@/services/errors'
import { runtime } from '@/config/runtime'

const email = ref('')
const password = ref('')
const access = ref('')
const error = ref('')
const busy = ref(false)
const router = useRouter()
const session = useSessionStore()
const accessMode = computed(() => runtime.authMode === 'access-code')

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const result = accessMode.value
      ? await session.loginAccess(access.value)
      : await session.loginAccount(email.value, password.value)
    if (result === 'challenge') router.push('/confirmacao')
    else router.push('/')
  } catch (e) {
    error.value = friendlyError(e, accessMode.value ? 'Código de acesso inválido.' : 'E-mail ou senha inválidos.')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AuthShell>
    <div class="auth-title">
      <h1>Bem-vindo ao Connect|API</h1>
      <p>Entre para administrar sua comunicação em um só lugar.</p>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <form class="form-stack" @submit.prevent="submit">
      <template v-if="accessMode">
        <label class="field"><span>Código de acesso</span><input v-model="access" type="password" autocomplete="current-password" required autofocus /></label>
        <p class="field-hint">Use o código administrativo definido para esta instalação.</p>
      </template>
      <template v-else>
        <label class="field"><span>E-mail</span><input v-model="email" type="email" autocomplete="username" required /></label>
        <label class="field"><span>Senha</span><input v-model="password" type="password" autocomplete="current-password" required /></label>
      </template>
      <button class="btn primary full" :disabled="busy">{{ busy ? 'Entrando...' : 'Entrar' }}</button>
    </form>
  </AuthShell>
</template>
