<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { brand } from '../config/brand'

interface MessageResponse {
  success: boolean
  message: string
}

const route = useRoute()
const token = computed(() => String(route.query.token || '').trim())
const password = ref('')
const passwordConfirmation = ref('')
const showPassword = ref(false)
const showConfirmation = ref(false)
const loading = ref(false)
const error = ref('')
const message = ref('')

async function submit() {
  error.value = ''
  message.value = ''
  if (!token.value) {
    error.value = 'O link de recuperação não contém um token válido.'
    return
  }
  if (password.value.length < 12) {
    error.value = 'A nova senha precisa ter ao menos 12 caracteres.'
    return
  }
  if (password.value !== passwordConfirmation.value) {
    error.value = 'A confirmação da senha não confere.'
    return
  }

  loading.value = true
  try {
    const response = await api.post<MessageResponse>('/control/v1/auth/reset-password', {
      token: token.value,
      password: password.value,
      password_confirmation: passwordConfirmation.value,
    })
    message.value = response.data.message
    password.value = ''
    passwordConfirmation.value = ''
  } catch (exception) {
    error.value = apiError(exception)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="min-h-screen bg-slate-50 px-5 py-8 sm:px-8">
    <div class="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
      <section class="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-10">
        <img
          v-if="brand.platformLogoLight"
          :src="brand.platformLogoLight"
          :alt="brand.productName"
          class="mb-9 max-h-11 w-auto max-w-[240px]"
        />

        <div class="mb-8">
          <p class="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-blue-600">
            <KeyRound :size="16" /> Control Plane
          </p>
          <h1 class="mt-3 text-3xl font-semibold tracking-[-.03em] text-slate-950">Definir nova senha</h1>
          <p class="mt-3 text-sm leading-6 text-slate-500">
            Crie uma senha forte e exclusiva. Ao concluir, as renovações de sessão anteriores serão revogadas; acessos já emitidos expiram no prazo normal.
          </p>
        </div>

        <div v-if="message" role="status" class="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
          <div class="flex gap-3">
            <CheckCircle2 class="mt-0.5 shrink-0" :size="21" />
            <div>
              <p class="font-semibold">Senha atualizada</p>
              <p class="mt-1 text-sm leading-6">{{ message }}</p>
              <RouterLink to="/login" class="mt-4 inline-flex font-semibold text-emerald-900 underline underline-offset-4">
                Entrar no Control Plane
              </RouterLink>
            </div>
          </div>
        </div>

        <form v-else class="space-y-5" @submit.prevent="submit">
          <div>
            <label for="new-password" class="label">Nova senha</label>
            <div class="relative mt-1.5">
              <LockKeyhole class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" :size="19" />
              <input
                id="new-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                minlength="12"
                autocomplete="new-password"
                class="input h-12 pl-11 pr-12"
                placeholder="Mínimo de 12 caracteres"
              />
              <button
                type="button"
                class="absolute right-2.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
                aria-label="Exibir ou ocultar nova senha"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" :size="19" />
                <Eye v-else :size="19" />
              </button>
            </div>
          </div>

          <div>
            <label for="new-password-confirmation" class="label">Confirmar nova senha</label>
            <div class="relative mt-1.5">
              <ShieldCheck class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" :size="19" />
              <input
                id="new-password-confirmation"
                v-model="passwordConfirmation"
                :type="showConfirmation ? 'text' : 'password'"
                required
                minlength="12"
                autocomplete="new-password"
                class="input h-12 pl-11 pr-12"
                placeholder="Repita a nova senha"
              />
              <button
                type="button"
                class="absolute right-2.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
                aria-label="Exibir ou ocultar confirmação"
                @click="showConfirmation = !showConfirmation"
              >
                <EyeOff v-if="showConfirmation" :size="19" />
                <Eye v-else :size="19" />
              </button>
            </div>
          </div>

          <p v-if="error" role="alert" class="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {{ error }}
          </p>

          <button class="btn-primary h-12 w-full text-sm font-semibold" :disabled="loading || !token">
            {{ loading ? 'Alterando senha…' : 'Alterar senha' }}
          </button>
        </form>

        <RouterLink to="/login" class="mt-7 inline-flex items-center gap-2 border-t border-slate-100 pt-6 text-sm font-semibold text-blue-700 hover:text-blue-800">
          <ArrowLeft :size="17" /> Voltar ao acesso
        </RouterLink>
      </section>
    </div>
  </main>
</template>
