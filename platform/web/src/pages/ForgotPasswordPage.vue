<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { brand } from '../config/brand'

interface MessageResponse {
  success: boolean
  message: string
}

const email = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await api.post<MessageResponse>('/control/v1/auth/forgot-password', {
      email: email.value,
    })
    message.value = response.data.message
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
          <p class="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Control Plane</p>
          <h1 class="mt-3 text-3xl font-semibold tracking-[-.03em] text-slate-950">Recuperar senha</h1>
          <p class="mt-3 text-sm leading-6 text-slate-500">
            Informe o e-mail do seu usuário. Enviaremos um link individual e temporário para definir uma nova senha.
          </p>
        </div>

        <div v-if="message" role="status" class="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
          <div class="flex gap-3">
            <CheckCircle2 class="mt-0.5 shrink-0" :size="21" />
            <div>
              <p class="font-semibold">Solicitação recebida</p>
              <p class="mt-1 text-sm leading-6">{{ message }}</p>
            </div>
          </div>
        </div>

        <form v-else class="space-y-5" @submit.prevent="submit">
          <div>
            <label for="password-recovery-email" class="label">E-mail</label>
            <div class="relative mt-1.5">
              <Mail class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" :size="19" />
              <input
                id="password-recovery-email"
                v-model.trim="email"
                type="email"
                required
                autocomplete="email"
                class="input h-12 pl-11"
                placeholder="seu@email.com"
              />
            </div>
          </div>

          <p v-if="error" role="alert" class="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {{ error }}
          </p>

          <button class="btn-primary h-12 w-full text-sm font-semibold" :disabled="loading">
            {{ loading ? 'Enviando instruções…' : 'Enviar instruções' }}
          </button>
        </form>

        <div class="mt-7 flex flex-col gap-3 border-t border-slate-100 pt-6 text-sm text-slate-500">
          <RouterLink to="/login" class="inline-flex items-center gap-2 font-semibold text-blue-700 hover:text-blue-800">
            <ArrowLeft :size="17" /> Voltar ao acesso
          </RouterLink>
          <p class="flex items-start gap-2 text-xs leading-5">
            <ShieldCheck class="mt-0.5 shrink-0" :size="15" />
            Por segurança, a resposta é a mesma mesmo quando o e-mail não está cadastrado.
          </p>
        </div>
      </section>
    </div>
  </main>
</template>
