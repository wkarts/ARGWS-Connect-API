<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ManagerStorageOverview } from '@/types/domain'

const ALL = ''
const overview = ref<ManagerStorageOverview | null>(null)
const detail = ref<ManagerStorageOverview | null>(null)
const selectedInstance = ref(ALL)
const loading = ref(false)
const detailLoading = ref(false)
const cleanupLoading = ref(false)
const error = ref('')
const feedback = ref('')
const olderThanDays = ref(1)
const preview = ref<any>(null)
const confirmPhrase = ref('')
const modalOpen = ref(false)

const displayed = computed(() => detail.value || overview.value)
const selectedName = computed(() => {
  if (!selectedInstance.value) return 'Todos os containers e instâncias'
  return overview.value?.instances.find((item) => item.id === selectedInstance.value)?.name || selectedInstance.value
})
const scopeLabel = computed(() => (selectedInstance.value ? 'instância selecionada' : 'bucket completo'))
const canClean = computed(() => Boolean(displayed.value?.enabled && displayed.value?.cleanup.supportedResources.some((item) => item.safe)))
const cleanupReady = computed(() => confirmPhrase.value.trim().toUpperCase() === 'LIMPAR STATUS')

function bytes(value: unknown) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)))
  return `${(size / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

function percent(value: number, total: number) {
  if (!total || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, (value / total) * 100))
}

function stamp(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

async function reload() {
  loading.value = true
  error.value = ''
  feedback.value = ''
  try {
    overview.value = await connect.storageOverview()
    if (!selectedInstance.value) detail.value = null
    else detail.value = await connect.storageOverview(selectedInstance.value)
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível consultar o armazenamento MinIO.')
  } finally {
    loading.value = false
  }
}

async function selectInstance(value: string) {
  selectedInstance.value = value
  detail.value = null
  if (!value) return
  detailLoading.value = true
  error.value = ''
  try {
    detail.value = await connect.storageOverview(value)
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível consultar o armazenamento da instância.')
  } finally {
    detailLoading.value = false
  }
}

async function prepareCleanup() {
  cleanupLoading.value = true
  error.value = ''
  feedback.value = ''
  try {
    preview.value = await connect.storageCleanupPreview({
      scope: selectedInstance.value ? 'instance' : 'global',
      ...(selectedInstance.value ? { instanceId: selectedInstance.value } : {}),
      resource: 'status-broadcast',
      olderThanDays: Math.max(0, Math.min(3650, Number(olderThanDays.value) || 0)),
      limit: 500,
    })
    confirmPhrase.value = ''
    modalOpen.value = true
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível preparar a limpeza segura.')
  } finally {
    cleanupLoading.value = false
  }
}

async function executeCleanup() {
  if (!preview.value?.planId || !cleanupReady.value) return
  cleanupLoading.value = true
  error.value = ''
  try {
    const result = await connect.storageCleanup({ planId: preview.value.planId, confirm: true })
    modalOpen.value = false
    feedback.value = `${result.removed || 0} registro(s) de status/broadcast removido(s), liberando ${bytes(result.freedBytes)}.`
    preview.value = null
    await reload()
  } catch (cause) {
    error.value = friendlyError(cause, 'A limpeza não foi concluída. Nenhum item com falha foi removido do banco.')
  } finally {
    cleanupLoading.value = false
  }
}

onMounted(reload)
</script>

<template>
  <AppShell>
    <PageHeader title="Armazenamento MinIO" description="Visão do bucket da aplicação e uso de mídia por instância, com limpeza protegida por prévia.">
      <span v-if="displayed" class="storage-updated">Atualizado {{ stamp(displayed.generatedAt) }}</span>
      <button class="btn ghost" :disabled="loading" @click="reload"><AppIcon name="refresh" :size="16" />{{ loading ? 'Atualizando…' : 'Atualizar' }}</button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>
    <div v-if="loading && !displayed" class="cards-skeleton"></div>

    <template v-else-if="displayed">
      <div v-if="!displayed.enabled" class="storage-warning"><AppIcon name="warning" :size="18" /><div><strong>MinIO desabilitado</strong><p>A aplicação não consegue medir nem limpar objetos enquanto S3_ENABLED estiver desativado.</p></div></div>

      <section class="storage-toolbar" aria-label="Escopo do armazenamento">
        <label class="field"><span>Escopo</span><select class="select" :value="selectedInstance" @change="selectInstance(($event.target as HTMLSelectElement).value)"><option value="">Bucket completo / todas as instâncias</option><option v-for="item in overview?.instances || []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <div class="storage-scope"><AppIcon name="database" :size="18" /><div><strong>{{ selectedName }}</strong><small>{{ displayed.bucket || 'Bucket indisponível' }} · prefixo gerenciado {{ displayed.managedPrefix }}</small></div></div>
        <button class="btn danger" :disabled="cleanupLoading || !canClean" @click="prepareCleanup"><AppIcon name="audit" :size="16" />{{ cleanupLoading ? 'Preparando…' : 'Limpar status/broadcast' }}</button>
      </section>

      <div class="metric-grid storage-metrics">
        <div class="metric-card"><div class="metric-head"><span class="metric-icon"><AppIcon name="database" :size="18" /></span><span class="metric-hint">{{ scopeLabel }}</span></div><strong class="metric-number">{{ bytes(displayed.totalBytes) }}</strong><span class="metric-title">Uso total MinIO</span></div>
        <div class="metric-card"><div class="metric-head"><span class="metric-icon accent-cyan"><AppIcon name="folder" :size="18" /></span><span class="metric-hint">{{ displayed.objectCount }} objetos</span></div><strong class="metric-number">{{ bytes(displayed.managedBytes) }}</strong><span class="metric-title">Mídia gerenciada</span></div>
        <div class="metric-card"><div class="metric-head"><span class="metric-icon accent-violet"><AppIcon name="warning" :size="18" /></span><span class="metric-hint">não referenciados</span></div><strong class="metric-number">{{ bytes(displayed.untrackedBytes) }}</strong><span class="metric-title">Objetos não referenciados</span></div>
        <div class="metric-card"><div class="metric-head"><span class="metric-icon accent-green"><AppIcon name="check" :size="18" /></span><span class="metric-hint">integridade</span></div><strong class="metric-number">{{ displayed.missingObjectCount }}</strong><span class="metric-title">Mídias sem objeto</span></div>
      </div>

      <div class="storage-grid">
        <PanelCard title="Uso por recurso" description="Somente Status/broadcast aparece como limpeza segura; os demais recursos podem ter dependências externas.">
          <div v-if="!displayed.resources.length" class="empty-storage"><AppIcon name="database" :size="22" /><strong>Nenhuma mídia registrada</strong><span>O bucket pode estar vazio ou o banco ainda não possui mídias.</span></div>
          <div v-for="resource in displayed.resources" :key="resource.key" class="resource-row">
            <div class="resource-head"><div><strong>{{ resource.label }}</strong><small>{{ resource.mediaCount }} registro(s) · {{ resource.objectCount }} objeto(s)</small></div><strong>{{ bytes(resource.bytes) }}</strong></div>
            <div class="usage-track"><i :style="{ width: `${percent(resource.bytes, displayed.managedBytes)}%` }"></i></div>
            <small v-if="resource.note" class="resource-note">{{ resource.note }}</small>
            <span v-else class="resource-safe"><AppIcon name="check" :size="12" /> Limpeza protegida disponível</span>
          </div>
        </PanelCard>

        <PanelCard title="Integridade e política" description="O relatório nunca toca em sessões ou serviços externos.">
          <div class="policy-list"><div><span>Prefixo proprietário</span><strong>{{ displayed.managedPrefix }}</strong></div><div><span>Objetos não referenciados</span><strong>{{ displayed.untrackedObjectCount }} · {{ bytes(displayed.untrackedBytes) }}</strong></div><div><span>Limpeza suportada</span><strong>Status/broadcast expirado</strong></div></div>
          <p class="policy-copy">{{ displayed.cleanup.policy }}</p>
          <label class="field cleanup-age"><span>Considerar status com mais de (dias)</span><input v-model.number="olderThanDays" type="number" min="0" max="3650" /></label>
          <p v-if="displayed.truncated" class="storage-note">A leitura atingiu o limite de segurança da varredura. O total exibido é parcial; reduza o volume antes de executar qualquer limpeza.</p>
        </PanelCard>
      </div>

      <PanelCard title="Uso por instância" description="Selecione uma instância para abrir o relatório individual sem sair desta tela.">
        <div v-if="detailLoading" class="loading-line">Consultando o escopo individual…</div>
        <div v-else class="instance-usage-table"><div class="instance-usage-head"><span>Instância</span><span>Mídias no banco</span><span>Objetos</span><span>Uso</span><span>Sem objeto</span><span></span></div><button v-for="item in overview?.instances || []" :key="item.id" type="button" class="instance-usage-row" @click="selectInstance(item.id)"><strong>{{ item.name }}</strong><span>{{ item.databaseMediaCount }}</span><span>{{ item.objectCount }}</span><span>{{ bytes(item.bytes) }}</span><span>{{ item.missingObjectCount }}</span><AppIcon name="chevron" :size="16" /></button></div>
      </PanelCard>
    </template>

    <AppModal v-if="modalOpen && preview" :open="modalOpen" title="Confirmar limpeza protegida" subtitle="A operação é limitada ao recurso escolhido e será revalidada no servidor antes de cada exclusão." @close="modalOpen = false">
      <div class="cleanup-modal"><div class="storage-warning"><AppIcon name="warning" :size="18" /><div><strong>Status/broadcast</strong><p>{{ preview.count }} registro(s) selecionado(s), potencialmente liberando {{ bytes(preview.bytes) }}. Objetos de outros recursos não serão tocados.</p></div></div><ul class="cleanup-list"><li v-for="item in preview.candidates.slice(0, 8)" :key="item.messageId"><span>{{ item.instanceName }}</span><small>{{ item.timestamp ? stamp(item.timestamp) : 'sem data' }} · {{ bytes(item.bytes) }}</small></li></ul><p v-if="preview.candidates.length > 8" class="muted-block">+ {{ preview.candidates.length - 8 }} item(ns) no plano.</p><label class="field"><span>Digite LIMPAR STATUS para confirmar</span><input v-model="confirmPhrase" autocomplete="off" spellcheck="false" /></label></div>
      <template #footer><button class="btn ghost" :disabled="cleanupLoading" @click="modalOpen = false">Cancelar</button><button class="btn danger" :disabled="cleanupLoading || !cleanupReady" @click="executeCleanup">{{ cleanupLoading ? 'Removendo…' : 'Confirmar limpeza' }}</button></template>
    </AppModal>
  </AppShell>
</template>

<style scoped>
.storage-updated{align-self:center;color:var(--muted);font-size:11px;white-space:nowrap}.storage-warning{display:flex;gap:11px;align-items:flex-start;padding:14px 15px;margin-bottom:16px;border:1px solid color-mix(in srgb,var(--warning) 30%,var(--border));border-radius:var(--radius);background:var(--warning-soft);color:var(--warning)}.storage-warning>div{display:grid;gap:3px}.storage-warning p{margin:0;color:var(--muted);font-size:11px;line-height:1.45}.storage-toolbar{display:grid;grid-template-columns:minmax(210px,300px) minmax(0,1fr) auto;gap:14px;align-items:end;margin-bottom:16px;padding:14px 15px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.storage-toolbar .field{display:grid;gap:5px}.storage-toolbar .field>span{font-size:11px;font-weight:700;color:var(--muted)}.storage-scope{display:flex;align-items:center;gap:10px;min-width:0;min-height:40px;color:var(--primary)}.storage-scope>div{display:grid;gap:2px;min-width:0}.storage-scope strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--text)}.storage-scope small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px}.storage-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.storage-metrics .metric-card{min-height:126px}.storage-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:16px;margin-bottom:16px}.resource-row{padding:11px 0;border-bottom:1px solid var(--border)}.resource-row:last-child{border-bottom:0}.resource-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.resource-head>div{display:grid;gap:3px;min-width:0}.resource-head strong{font-size:12px}.resource-head small,.resource-note,.resource-safe{color:var(--muted);font-size:10px}.usage-track{height:8px;margin:8px 0 5px;overflow:hidden;border-radius:99px;background:var(--surface-2)}.usage-track i{display:block;height:100%;min-width:2px;border-radius:inherit;background:linear-gradient(90deg,var(--primary),#70b6ff)}.resource-safe{display:inline-flex;align-items:center;gap:4px;color:var(--success)}.policy-list{display:grid}.policy-list>div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)}.policy-list span{color:var(--muted);font-size:11px}.policy-list strong{font-size:11px;text-align:right}.policy-copy{margin:13px 0;color:var(--muted);font-size:11px;line-height:1.5}.cleanup-age{display:grid;gap:5px}.cleanup-age span{font-size:11px;font-weight:700;color:var(--muted)}.storage-note{margin:12px 0 0;padding:10px;border-radius:9px;background:var(--warning-soft);color:var(--warning);font-size:10px;line-height:1.45}.empty-storage{display:grid;justify-items:center;gap:6px;padding:28px 10px;text-align:center;color:var(--muted)}.empty-storage strong{color:var(--text);font-size:13px}.empty-storage span{font-size:11px}.instance-usage-table{overflow:auto}.instance-usage-head,.instance-usage-row{display:grid;grid-template-columns:minmax(180px,1.8fr .8fr .7fr 1fr .7fr 24px);gap:12px;align-items:center;min-width:680px}.instance-usage-head{padding:0 12px 8px;color:var(--muted);font-size:10px;font-weight:700}.instance-usage-row{width:100%;padding:12px;border:0;border-top:1px solid var(--border);background:transparent;text-align:left;color:var(--text);font-size:11px}.instance-usage-row:hover{background:var(--primary-soft)}.instance-usage-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.instance-usage-row span{color:var(--muted)}.instance-usage-row svg{color:var(--primary)}.loading-line{padding:20px;color:var(--muted);font-size:12px}.cleanup-modal{display:grid;gap:14px}.cleanup-list{display:grid;gap:6px;max-height:180px;overflow:auto;margin:0;padding:0;list-style:none}.cleanup-list li{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:11px}.cleanup-list small{color:var(--muted)}
@media(max-width:1000px){.storage-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.storage-toolbar{grid-template-columns:1fr 1fr}.storage-toolbar .btn{grid-column:1/-1;justify-self:start}.storage-grid{grid-template-columns:1fr}}
@media(max-width:650px){.storage-updated{display:none}.storage-toolbar{grid-template-columns:1fr}.storage-metrics{grid-template-columns:1fr 1fr}.storage-toolbar .btn{width:100%}.storage-metrics .metric-number{font-size:22px}.storage-grid{gap:12px}.panel-card{padding:14px}}
@media(max-width:430px){.storage-metrics{grid-template-columns:1fr}.storage-metrics .metric-card{min-height:108px}}
</style>
