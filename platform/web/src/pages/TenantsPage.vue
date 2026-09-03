<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, RefreshCw, Search } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Paginated, Tenant } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'

interface ProvisionCreated {
  tenant_id: string
  job_id: string
  status: string
  provisional_domain: string
}

const router = useRouter()
const tenants = ref<Tenant[]>([])
const loading = ref(false)
const creating = ref(false)
const error = ref('')
const modal = ref(false)
const query = ref('')
const form = reactive({ name: '', slug: '', legal_document: '', admin_name: '', admin_email: '', admin_password: '', initial_company_name: '', initial_company_tax_id: '', plan_code: 'ENTERPRISE', timezone: 'America/Bahia' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    tenants.value = (await api.get<Paginated<Tenant>>('/control/v1/tenants', { params: { q: query.value || undefined, per_page: 100 } })).data.data
  } catch (e) {
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}

async function create() {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    const response = await api.post<ApiResponse<ProvisionCreated>>('/control/v1/tenants', form)
    const created = response.data.data
    modal.value = false
    Object.assign(form, { name:'',slug:'',legal_document:'',admin_name:'',admin_email:'',admin_password:'',initial_company_name:'',initial_company_tax_id:'',plan_code:'ENTERPRISE',timezone:'America/Bahia' })
    await router.push({ path: '/provisioning', query: { job: created.job_id, tenant: created.tenant_id } })
  } catch (e) {
    error.value = apiError(e)
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <PageHeader title="Tenants" subtitle="Crie, acompanhe e governe ambientes isolados.">
    <button class="btn-primary" @click="modal = true"><Plus :size="17" /> Novo tenant</button>
  </PageHeader>

  <div class="mb-4 flex flex-col gap-2 sm:flex-row">
    <div class="relative w-full max-w-md flex-1"><Search class="absolute left-3 top-2.5 text-slate-400" :size="17" /><input v-model="query" class="input pl-9" placeholder="Nome ou slug" @keyup.enter="load" /></div>
    <button class="btn-secondary self-start sm:self-auto" :disabled="loading" @click="load"><RefreshCw :size="17" :class="loading && 'animate-spin'" /> <span class="sm:hidden">Atualizar</span></button>
  </div>

  <p v-if="error" class="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>

  <div class="table-wrap"><table class="table"><thead><tr><th>Tenant</th><th>Plano</th><th>Domínio principal</th><th>Status</th><th>Criado</th></tr></thead><tbody><tr v-for="item in tenants" :key="item.id" class="border-t border-slate-100 hover:bg-slate-50"><td><RouterLink :to="`/tenants/${item.id}`" class="font-semibold text-teal-700 hover:underline">{{ item.name }}</RouterLink><p class="text-xs text-slate-400">{{ item.slug }}</p></td><td>{{ item.plan_code }}</td><td class="max-w-[260px] truncate">{{ item.domains.find(d => d.is_primary)?.hostname || '—' }}</td><td><StatusBadge :status="item.status" /></td><td>{{ new Date(item.created_at).toLocaleDateString('pt-BR') }}</td></tr><tr v-if="!tenants.length"><td colspan="5" class="py-10 text-center text-slate-400">Nenhum tenant encontrado.</td></tr></tbody></table></div>

  <ModalDialog :open="modal" title="Provisionar novo tenant" size="xl" @close="!creating && (modal = false)">
    <form class="grid gap-3 md:grid-cols-2" @submit.prevent="create">
      <div><label class="label">Nome</label><input v-model="form.name" class="input" required /></div>
      <div><label class="label">Slug opcional</label><input v-model="form.slug" class="input" placeholder="gerado automaticamente" /></div>
      <div><label class="label">Documento</label><input v-model="form.legal_document" class="input" /></div>
      <div><label class="label">Plano</label><select v-model="form.plan_code" class="select"><option>ENTERPRISE</option><option>BUSINESS</option><option>PROFESSIONAL</option><option>STARTER</option></select></div>
      <div class="border-t pt-3 md:col-span-2"><p class="text-sm font-semibold">Empresa inicial</p></div>
      <div><label class="label">Razão social</label><input v-model="form.initial_company_name" class="input" required /></div>
      <div><label class="label">CNPJ/CPF</label><input v-model="form.initial_company_tax_id" class="input" required /></div>
      <div class="border-t pt-3 md:col-span-2"><p class="text-sm font-semibold">Administrador do tenant</p></div>
      <div><label class="label">Nome</label><input v-model="form.admin_name" class="input" required /></div>
      <div><label class="label">E-mail</label><input v-model="form.admin_email" type="email" class="input" required /></div>
      <div><label class="label">Senha inicial</label><input v-model="form.admin_password" type="password" minlength="12" class="input" required /></div>
      <div><label class="label">Timezone</label><input v-model="form.timezone" class="input" /></div>
      <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end md:col-span-2">
        <button type="button" class="btn-secondary" :disabled="creating" @click="modal=false">Cancelar</button>
        <button class="btn-primary" :disabled="creating"><RefreshCw v-if="creating" :size="16" class="animate-spin" /><span>{{ creating ? 'Criando ambiente…' : 'Provisionar ambiente' }}</span></button>
      </div>
    </form>
  </ModalDialog>
</template>
