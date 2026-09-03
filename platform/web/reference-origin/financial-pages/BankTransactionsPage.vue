<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { FileUp, Plus, RefreshCw } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Paginated } from '../types'
import PageHeader from '../components/PageHeader.vue'
import SectionTabs from '../components/SectionTabs.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'

interface Account {
  id: string
  company_id: string
  bank_code: string
  bank_name: string
  branch: string
  account: string
  is_active: boolean
}

interface BankTransaction {
  id: string
  bank_account_id: string
  external_id: string
  transaction_date: string
  posted_at?: string
  amount: string
  transaction_type: string
  description: string
  document_number?: string
  end_to_end_id?: string
  reconciliation_status: string
  created_at: string
}

interface StatementImport {
  id: string
  bank_account_id: string
  filename: string
  format: string
  sha256: string
  status: string
  imported_count: number
  duplicate_count: number
  error_count: number
  summary: Record<string, number>
  processed_at?: string
  created_at: string
}

const tab = ref('transactions')
const accounts = ref<Account[]>([])
const items = ref<BankTransaction[]>([])
const statements = ref<StatementImport[]>([])
const drawer = ref(false)
const importDrawer = ref(false)
const loading = ref(false)
const error = ref('')
const success = ref('')
const file = ref<File | null>(null)

const form = reactive({
  bank_account_id: '',
  external_id: '',
  transaction_date: new Date().toISOString().slice(0, 10),
  amount: '0',
  transaction_type: 'CREDIT',
  description: '',
  document_number: '',
  end_to_end_id: ''
})

const money = (value: string) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const accountName = (id: string) => {
  const account = accounts.value.find(item => item.id === id)
  return account ? `${account.bank_name} · ${account.branch}/${account.account}` : id.slice(0, 8)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [accountResponse, transactionResponse, statementResponse] = await Promise.all([
      api.get<ApiResponse<Account[]>>('/v1/bank-accounts'),
      api.get<Paginated<BankTransaction>>('/v1/bank-transactions', { params: { per_page: 100 } }),
      api.get<ApiResponse<StatementImport[]>>('/v1/bank-statements')
    ])
    accounts.value = accountResponse.data.data
    items.value = transactionResponse.data.data
    statements.value = statementResponse.data.data
  } catch (exception) {
    error.value = apiError(exception)
  } finally {
    loading.value = false
  }
}

function openTransaction() {
  Object.assign(form, {
    bank_account_id: accounts.value[0]?.id || '',
    external_id: `MANUAL-${Date.now()}`,
    transaction_date: new Date().toISOString().slice(0, 10),
    amount: '0',
    transaction_type: 'CREDIT',
    description: '',
    document_number: '',
    end_to_end_id: ''
  })
  drawer.value = true
}

function openImport() {
  form.bank_account_id = accounts.value[0]?.id || ''
  file.value = null
  importDrawer.value = true
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] || null
}

async function save() {
  error.value = ''
  try {
    await api.post('/v1/bank-transactions', {
      ...form,
      amount: Number(form.amount),
      document_number: form.document_number || null,
      end_to_end_id: form.end_to_end_id || null,
      raw_payload: { source: 'manual' }
    })
    drawer.value = false
    success.value = 'Transação registrada.'
    await load()
  } catch (exception) {
    error.value = apiError(exception)
  }
}

async function upload() {
  if (!file.value || !form.bank_account_id) return
  error.value = ''
  const data = new FormData()
  data.append('bank_account_id', form.bank_account_id)
  data.append('file', file.value)
  try {
    await api.post('/v1/bank-statements/import', data, { headers: { 'Content-Type': 'multipart/form-data' } })
    importDrawer.value = false
    success.value = 'Extrato processado com deduplicação.'
    await load()
  } catch (exception) {
    error.value = apiError(exception)
  }
}

onMounted(load)
</script>

<template>
  <PageHeader title="Extratos e transações bancárias" subtitle="Importação OFX/CSV, deduplicação e base da conciliação automática.">
    <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading && 'animate-spin'" /> Atualizar</button>
    <button class="btn-secondary" :disabled="!accounts.length" @click="openImport"><FileUp :size="18" /> Importar extrato</button>
    <button class="btn-primary" :disabled="!accounts.length" @click="openTransaction"><Plus :size="18" /> Transação manual</button>
  </PageHeader>

  <InlineAlert :message="error" @dismiss="error = ''" />
  <InlineAlert :message="success" type="success" @dismiss="success = ''" />

  <SectionTabs v-model="tab" :items="[
    { key: 'transactions', label: 'Transações', count: items.length },
    { key: 'imports', label: 'Importações', count: statements.length }
  ]" />

  <div v-if="tab === 'transactions'" class="table-wrap">
    <table class="table">
      <thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Identificadores</th><th>Valor</th><th>Conciliação</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.id" class="border-t border-slate-100">
          <td>{{ new Date(`${item.transaction_date}T00:00:00`).toLocaleDateString('pt-BR') }}</td>
          <td>{{ accountName(item.bank_account_id) }}</td>
          <td><p class="font-semibold">{{ item.description }}</p><p class="text-xs text-slate-400">{{ item.transaction_type }}</p></td>
          <td><p class="max-w-xs truncate font-mono text-xs">{{ item.external_id }}</p><p v-if="item.end_to_end_id" class="max-w-xs truncate text-xs text-slate-400">{{ item.end_to_end_id }}</p></td>
          <td class="font-bold" :class="Number(item.amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ money(item.amount) }}</td>
          <td><StatusBadge :status="item.reconciliation_status" /></td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!items.length" title="Nenhuma transação bancária" description="Importe um OFX/CSV ou registre um movimento manual." />
  </div>

  <div v-else class="table-wrap">
    <table class="table">
      <thead><tr><th>Arquivo</th><th>Conta</th><th>Formato</th><th>Processamento</th><th>Status</th></tr></thead>
      <tbody>
        <tr v-for="item in statements" :key="item.id" class="border-t border-slate-100">
          <td><p class="font-semibold">{{ item.filename }}</p><p class="font-mono text-xs text-slate-400">{{ item.sha256.slice(0, 16) }}…</p></td>
          <td>{{ accountName(item.bank_account_id) }}</td>
          <td>{{ item.format }}</td>
          <td>
            <strong>{{ item.imported_count }}</strong> importado(s)
            <p class="text-xs text-slate-400">{{ item.duplicate_count }} duplicado(s) · {{ item.error_count }} erro(s)</p>
          </td>
          <td><StatusBadge :status="item.status" /><p class="mt-1 text-xs text-slate-400">{{ item.processed_at ? new Date(item.processed_at).toLocaleString('pt-BR') : 'Aguardando' }}</p></td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-if="!statements.length" title="Nenhum extrato importado" />
  </div>

  <DrawerPanel :open="drawer" title="Transação bancária manual" size="lg" @close="drawer = false">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="save">
      <div><label class="label">Conta</label><select v-model="form.bank_account_id" class="select" required><option v-for="account in accounts" :key="account.id" :value="account.id">{{ accountName(account.id) }}</option></select></div>
      <div><label class="label">Data</label><input v-model="form.transaction_date" type="date" class="input" required /></div>
      <div><label class="label">Tipo</label><select v-model="form.transaction_type" class="select"><option>CREDIT</option><option>DEBIT</option><option>FEE</option><option>REFUND</option></select></div>
      <div><label class="label">Valor</label><input v-model="form.amount" type="number" step="0.01" class="input" required /></div>
      <div class="md:col-span-2"><label class="label">Descrição</label><input v-model="form.description" class="input" required /></div>
      <div><label class="label">ID externo</label><input v-model="form.external_id" class="input" required /></div>
      <div><label class="label">Documento</label><input v-model="form.document_number" class="input" /></div>
      <div class="md:col-span-2"><label class="label">EndToEndId</label><input v-model="form.end_to_end_id" class="input" /></div>
      <div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="drawer = false">Cancelar</button><button class="btn-primary">Salvar</button></div>
    </form>
  </DrawerPanel>

  <DrawerPanel :open="importDrawer" title="Importar extrato" size="md" @close="importDrawer = false">
    <form class="space-y-4" @submit.prevent="upload">
      <div><label class="label">Conta bancária</label><select v-model="form.bank_account_id" class="select" required><option v-for="account in accounts" :key="account.id" :value="account.id">{{ accountName(account.id) }}</option></select></div>
      <div><label class="label">Arquivo OFX ou CSV</label><input type="file" accept=".ofx,.csv,text/csv,application/x-ofx" class="input" required @change="onFileChange" /></div>
      <div class="rounded-xl bg-sky-50 p-3 text-xs text-sky-800">O SHA-256 do arquivo e o identificador externo por conta impedem importações duplicadas.</div>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="importDrawer = false">Cancelar</button><button class="btn-primary" :disabled="!file">Importar</button></div>
    </form>
  </DrawerPanel>
</template>
