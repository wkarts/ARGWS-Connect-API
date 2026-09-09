<script setup lang="ts">
import { computed, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { useRouter } from 'vue-router'
import { runtime } from '@/config/runtime'

const current=ref(''),next=ref(''),confirm=ref(''),message=ref(''),error=ref(''),busy=ref(false)
const session=useSessionStore(),ui=useUiStore(),router=useRouter()
const accountMode = computed(() => runtime.authMode === 'account')

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
      <PanelCard v-if="accountMode" title="Alterar senha">
        <div v-if="error" class="alert error">{{error}}</div><div v-if="message" class="alert success">{{message}}</div>
        <div class="form-stack"><label class="field"><span>Senha atual</span><input v-model="current" type="password"/></label><label class="field"><span>Nova senha</span><input v-model="next" type="password" minlength="12"/></label><label class="field"><span>Confirmar nova senha</span><input v-model="confirm" type="password"/></label><button class="btn primary" :disabled="busy" @click="change">Alterar senha</button></div>
      </PanelCard>
    </div>
  </AppShell>
</template>
