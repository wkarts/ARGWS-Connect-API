<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppModal from '@/components/AppModal.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem } from '@/types/domain'

const items = ref<ConnectionItem[]>([])
const query = ref('')
const error = ref('')
const feedback = ref('')
const loading = ref(true)
const creating = ref(false)
const createOpen = ref(false)
const router = useRouter()

const form = ref({
  name: '',
  mode: 'WHATSAPP-BAILEYS',
  number: '',
  businessId: '',
})

const filtered = computed(() => items.value.filter((i) =>
  `${i.name} ${i.profileName || ''} ${i.number || ''} ${i.provider || ''}`.toLowerCase().includes(query.value.toLowerCase()),
))

async function load() {
  loading.value = true
  error.value = ''
  try { items.value = await connect.connections() }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

function secureToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes).map((v) => v.toString(16).padStart(2, '0')).join('')
}

function openCreate() {
  feedback.value = ''
  form.value = { name: '', mode: 'WHATSAPP-BAILEYS', number: '', businessId: '' }
  createOpen.value = true
}

async function create() {
  feedback.value = ''
  if (!form.value.name.trim()) return
  creating.value = true
  try {
    await connect.createConnection({
      instanceName: form.value.name.trim(),
      integration: form.value.mode,
      token: secureToken(),
      number: form.value.number.replace(/\D/g, ''),
      businessId: form.value.businessId.trim(),
    })
    createOpen.value = false
    feedback.value = 'Instância criada com sucesso.'
    await load()
  } catch (e) {
    feedback.value = friendlyError(e)
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader title="Instâncias" description="Acompanhe e administre suas conexões.">
      <button class="btn primary" @click="openCreate"><AppIcon name="plus" :size="17"/>Nova instância</button>
    </PageHeader>

    <div class="toolbar">
      <div class="search-box"><AppIcon name="search" :size="17"/><input v-model="query" placeholder="Buscar por nome, número ou provider..."/></div>
      <button class="btn ghost" @click="load"><AppIcon name="refresh" :size="17"/>Atualizar</button>
    </div>

    <div v-if="feedback" class="alert" :class="feedback.includes('sucesso') ? 'success' : 'error'">{{ feedback }}</div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-else-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!filtered.length" icon="radio" title="Nenhuma instância encontrada" description="Quando houver conexões cadastradas, elas aparecerão aqui."/>

    <div v-else class="instance-grid">
      <article v-for="item in filtered" :key="item.id" class="instance-card" @click="router.push(`/instancias/${encodeURIComponent(item.id)}`)">
        <div class="instance-card-head">
          <div class="instance-avatar"><img v-if="item.avatar" :src="item.avatar" alt=""/><AppIcon v-else name="radio"/></div>
          <div><strong>{{ item.name }}</strong><span>{{ item.profileName || item.channel }}<template v-if="item.provider"> • {{ item.provider }}</template></span></div>
          <StatusPill :status="item.status"/>
        </div>
        <div class="instance-number">{{ item.number || 'Número não informado' }}</div>
        <div class="instance-stats">
          <div><b>{{ item.counts.contacts.toLocaleString('pt-BR') }}</b><span>Contatos</span></div>
          <div><b>{{ item.counts.conversations.toLocaleString('pt-BR') }}</b><span>Conversas</span></div>
          <div><b>{{ item.counts.messages.toLocaleString('pt-BR') }}</b><span>Mensagens</span></div>
        </div>
        <div class="card-link">Abrir <AppIcon name="arrow" :size="15"/></div>
      </article>
    </div>

    <AppModal :open="createOpen" title="Nova instância" subtitle="Configure uma nova conexão de comunicação." @close="createOpen=false">
      <form class="form-stack" @submit.prevent="create">
        <div v-if="feedback && !feedback.includes('sucesso')" class="alert error">{{ feedback }}</div>
        <label class="field"><span>Nome</span><input v-model="form.name" required autofocus placeholder="Ex.: Atendimento Comercial"/></label>
        <label class="field"><span>Provider</span>
          <select v-model="form.mode" class="select">
            <option value="WHATSAPP-BAILEYS">WhatsApp — Baileys</option>
            <option value="WHATSAPP-ZAPO">WhatsApp — ZAPO</option>
            <option value="WHATSAPP-BUSINESS">WhatsApp Business / Cloud API</option>
          </select>
          <small>Escolha a tecnologia de conexão usada por esta instância.</small>
        </label>
        <label class="field"><span>Número</span><input v-model="form.number" inputmode="numeric" placeholder="5575999999999"/><small>Opcional para Baileys e ZAPO. Informe DDI, DDD e número.</small></label>
        <label v-if="form.mode==='WHATSAPP-BUSINESS'" class="field"><span>Identificador da conta empresarial</span><input v-model="form.businessId"/></label>
      </form>
      <template #footer>
        <button class="btn ghost" :disabled="creating" @click="createOpen=false">Cancelar</button>
        <button class="btn primary" :disabled="creating || !form.name.trim()" @click="create">{{ creating ? 'Criando...' : 'Criar instância' }}</button>
      </template>
    </AppModal>
  </AppShell>
</template>
