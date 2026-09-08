<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem, ContactItem } from '@/types/domain'

const instances = ref<ConnectionItem[]>([])
const selected = ref('')
const contacts = ref<ContactItem[]>([])
const query = ref('')
const loading = ref(false)
const error = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return contacts.value
  return contacts.value.filter((item) => `${item.name} ${item.number || ''}`.toLowerCase().includes(q))
})

async function loadContacts() {
  contacts.value = []
  error.value = ''
  if (!selected.value) return
  loading.value = true
  try { contacts.value = await connect.contacts(selected.value) }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

onMounted(async () => {
  instances.value = await connect.connections().catch(() => [])
  selected.value = instances.value[0]?.id || ''
  await loadContacts()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Contatos" description="Centralize pessoas e informações de contato."/>
    <div class="toolbar split-toolbar">
      <select v-model="selected" class="select" @change="loadContacts">
        <option v-for="i in instances" :key="i.id" :value="i.id">{{ i.name }}</option>
      </select>
      <div class="search-box"><AppIcon name="search" :size="17"/><input v-model="query" placeholder="Buscar contato..."/></div>
      <button class="btn ghost" @click="loadContacts"><AppIcon name="refresh" :size="17"/>Atualizar</button>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-else-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!selected" icon="users" title="Nenhuma instância disponível" description="Cadastre uma instância para consultar os contatos."/>
    <EmptyState v-else-if="!filtered.length" icon="users" title="Nenhum contato encontrado" description="Os contatos desta instância aparecerão aqui."/>
    <div v-else class="contact-grid">
      <article v-for="item in filtered" :key="item.id" class="contact-card">
        <span class="avatar contact-avatar"><img v-if="item.avatar" :src="item.avatar" alt=""/><template v-else>{{ item.name.slice(0,1).toUpperCase() }}</template></span>
        <div><strong>{{ item.name }}</strong><span>{{ item.number || 'Número não informado' }}</span></div>
      </article>
    </div>
  </AppShell>
</template>
