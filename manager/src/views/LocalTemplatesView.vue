<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppModal from '@/components/AppModal.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { instanceTokenSupported } from '@/services/instance-token'
import { archiveLocalTemplate, listLocalTemplates, saveLocalTemplate, type LocalTemplate } from '@/services/local-templates'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id))
let requestSequence = 0
const instance = ref<any>(null)
const records = ref<LocalTemplate[]>([])
const busy = ref(false)
const error = ref('')
const feedback = ref('')
const search = ref('')
const editor = ref(false)
const selected = ref<LocalTemplate | null>(null)
const archive = ref<LocalTemplate | null>(null)
const name = ref('')
const language = ref('pt_BR')
const header = ref('')
const body = ref('')
const footer = ref('')
const enabled = ref(true)
const available = computed(() => instanceTokenSupported() && ['WHATSAPP-ZAPO', 'WHATSAPP-BAILEYS'].includes(instance.value?.integration || instance.value?.provider))
const instanceName = computed(() => String(instance.value?.name || instance.value?.instanceName || ''))
const instanceId = computed(() => String(instance.value?.id || instance.value?.instanceId || id.value))
const filtered = computed(() => records.value.filter(item => `${item.name} ${item.language}`.toLowerCase().includes(search.value.toLowerCase())))
const preview = computed(() => [header.value, body.value, footer.value].filter(value => value.trim()).join('\n\n'))

async function refresh() {
  const sequence = ++requestSequence
  const target = id.value
  busy.value = true
  error.value = ''
  try {
    const next = await connect.connection(target)
    const supported = instanceTokenSupported() && ['WHATSAPP-ZAPO', 'WHATSAPP-BAILEYS'].includes(next?.integration || next?.provider)
    const nextRecords = supported
      ? await listLocalTemplates(String(next?.id || next?.instanceId || target), String(next?.name || next?.instanceName || ''))
      : []
    if (sequence !== requestSequence || target !== id.value) return
    instance.value = next
    records.value = nextRecords
  } catch (e) { if (sequence === requestSequence) error.value = friendlyError(e) }
  finally { if (sequence === requestSequence) busy.value = false }
}

function edit(item: LocalTemplate | null = null) {
  selected.value = item
  name.value = item?.name || ''
  language.value = item?.language || 'pt_BR'
  header.value = item?.components.find(c => c.type === 'HEADER')?.text || ''
  body.value = item?.components.find(c => c.type === 'BODY')?.text || ''
  footer.value = item?.components.find(c => c.type === 'FOOTER')?.text || ''
  enabled.value = item?.enabled ?? true
  error.value = ''
  editor.value = true
}

async function save() {
  busy.value = true
  error.value = ''; feedback.value = ''
  try {
    const components = [
      ...(header.value.trim() ? [{ type: 'HEADER', format: 'TEXT', text: header.value }] : []),
      { type: 'BODY', text: body.value },
      ...(footer.value.trim() ? [{ type: 'FOOTER', text: footer.value }] : []),
    ]
    await saveLocalTemplate(instanceId.value, instanceName.value, {
      name: name.value, language: language.value, components, enabled: enabled.value,
      ...(selected.value ? { version: selected.value.version } : {}),
    }, Boolean(selected.value))
    editor.value = false
    feedback.value = 'Modelo salvo. Reconcilie a caixa no HUB para atualizar o catálogo.'
    await refresh()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function toggle(item: LocalTemplate) {
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    await saveLocalTemplate(instanceId.value, instanceName.value, {
      name: item.name, language: item.language, version: item.version, enabled: !item.enabled,
    }, true)
    feedback.value = item.enabled ? 'Modelo desabilitado. Novos envios serão bloqueados.' : 'Modelo habilitado. Reconcilie a caixa no HUB.'
    await refresh()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function confirmArchive() {
  if (!archive.value) return
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    await archiveLocalTemplate(instanceId.value, instanceName.value, archive.value)
    archive.value = null
    feedback.value = 'Modelo arquivado. Ele não será recriado pela sincronização.'
    await refresh()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

watch(id, () => {
  instance.value = null; records.value = []
  editor.value = false; archive.value = null; selected.value = null
  error.value = ''; feedback.value = ''
  void refresh()
}, { immediate: true })
</script>

<template>
  <AppShell>
    <PageHeader title="Modelos de mensagem" :description="instanceName || 'Modelos vinculados a esta instância.'">
      <button class="btn ghost" @click="router.push(`/instancias/${encodeURIComponent(id)}`)">Voltar à instância</button>
      <button class="btn ghost" :disabled="busy" @click="refresh">Atualizar</button>
      <button v-if="available" class="btn primary" :disabled="busy" @click="edit()">Novo modelo</button>
    </PageHeader>
    <div v-if="error && !editor && !archive" class="alert error" role="alert">{{ error }}</div>
    <div v-if="feedback" class="alert success" role="status">{{ feedback }}</div>
    <PanelCard v-if="available" title="Catálogo desta instância" description="Modelos locais da Connect|API. São enviados como texto a partir do conteúdo cadastrado; não são templates aprovados pela Meta.">
      <div class="catalog-tools"><input v-model="search" type="search" placeholder="Buscar por nome ou idioma" aria-label="Buscar modelos" /></div>
      <div class="catalog-scroll">
        <table class="catalog-table">
          <thead><tr><th>Modelo</th><th>Idioma</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>
            <tr v-for="item in filtered" :key="item.id">
              <td><strong>{{ item.name }}</strong><p>{{ item.components.find(c => c.type === 'BODY')?.text }}</p></td>
              <td>{{ item.language }}</td><td>{{ item.enabled ? 'Disponível' : 'Desabilitado' }}</td>
              <td><div class="catalog-actions"><button class="btn ghost" :disabled="busy" @click="edit(item)">Editar</button><button class="btn ghost" :disabled="busy" @click="toggle(item)">{{ item.enabled ? 'Desabilitar' : 'Habilitar' }}</button><button class="btn danger" :disabled="busy" @click="archive = item; error = ''">Arquivar</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="4">{{ busy ? 'Carregando modelos…' : 'Nenhum modelo encontrado.' }}</td></tr>
          </tbody>
        </table>
      </div>
    </PanelCard>
    <div v-else-if="instance" class="alert">Modelos locais estão disponíveis para conexões ZAPO e Baileys no acesso direto à Connect|API. O catálogo oficial da Meta permanece separado.</div>

    <AppModal :open="editor" :title="selected ? 'Editar modelo' : 'Novo modelo'" :dismissible="!busy" wide @close="editor = false">
      <form class="template-form" @submit.prevent="save">
        <div v-if="error" class="alert error" role="alert">{{ error }}</div>
        <label>Nome<input v-model="name" required pattern="[a-z][a-z0-9_]{0,63}" maxlength="64" :disabled="Boolean(selected) || busy" placeholder="confirmacao_atendimento" /></label>
        <label>Idioma<input v-model="language" required maxlength="16" :disabled="Boolean(selected) || busy" placeholder="pt_BR" /></label>
        <label>Cabeçalho opcional<input v-model="header" maxlength="60" :disabled="busy" /></label>
        <label>Mensagem<textarea v-model="body" rows="5" required maxlength="4096" :disabled="busy" /></label>
        <p v-pre>Na mensagem, use {{1}}, {{2}} e assim por diante, sem pular posições. Cabeçalho e rodapé são textos fixos.</p>
        <label>Rodapé opcional<input v-model="footer" maxlength="60" :disabled="busy" /></label>
        <label class="enabled-field"><input v-model="enabled" type="checkbox" :disabled="busy" /> Disponível para envio</label>
        <div><strong>Prévia</strong><pre class="template-preview">{{ preview || 'Escreva a mensagem para visualizar.' }}</pre></div>
        <p>Até 4096 caracteres no conjunto. A seleção de modelos para abrir conversas continua sendo administrada em cada caixa do HUB.</p>
        <button class="btn primary" :disabled="busy || !body.trim() || preview.length > 4096" type="submit">{{ busy ? 'Salvando…' : 'Salvar modelo' }}</button>
      </form>
    </AppModal>
    <AppModal :open="Boolean(archive)" title="Arquivar modelo" :dismissible="!busy" @close="archive = null">
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <p>Arquivar <strong>{{ archive?.name }}</strong>? Novos envios serão bloqueados e o modelo sairá do catálogo. O nome e o idioma ficam reservados; a sincronização não recria o cadastro.</p>
      <template #footer><button class="btn ghost" :disabled="busy" @click="archive = null">Cancelar</button><button class="btn danger" :disabled="busy" @click="confirmArchive">Arquivar</button></template>
    </AppModal>
  </AppShell>
</template>

<style scoped>
.catalog-tools { padding: 1rem; }
.catalog-scroll { overflow-x: auto; }
.catalog-table { width: 100%; border-collapse: collapse; text-align: left; }
.catalog-table th, .catalog-table td { padding: 1rem; vertical-align: top; border-bottom: 1px solid var(--border); }
.catalog-table p { max-width: 32rem; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: .4rem; }
.catalog-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.template-form { display: grid; gap: 1rem; }
.template-form label { display: grid; gap: .4rem; }
.template-form .enabled-field { display: flex; align-items: center; }
.template-form .enabled-field input { width: auto; }
.template-preview { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; padding: 1rem; border: 1px solid var(--border); border-radius: .5rem; }
</style>
