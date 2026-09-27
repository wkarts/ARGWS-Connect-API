<script setup lang="ts">
import { computed, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import PanelCard from '@/components/PanelCard.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'

const props = defineProps<{
  instanceId: string
  devices: any[]
  connected: boolean
  inventory: any
  timeoutMs?: number
}>()

const busy = ref(false)
const deviceBusy = ref<Record<string, string>>({})
const feedback = ref('')
const error = ref('')
const query = ref('')
const statusFilter = ref('all')
const catalog = ref<'spot' | 'android' | 'auto' | 'fastpair' | 'supervised'>('spot')

const artifacts = computed<any[]>(() => props.inventory?.artifacts || [])
const schemas = computed<any[]>(() => props.inventory?.schemas || [])
const summary = computed(() => props.inventory?.summary || {})
const filteredArtifacts = computed(() => {
  const term = query.value.trim().toLowerCase()
  return artifacts.value.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) return false
    if (!term) return true
    return [item.key, item.family, item.protocol, item.kind, item.transport, item.endpoint, ...(item.messages || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

const effectiveTimeout = () => Math.min(120000, Math.max(1000, Number(props.timeoutMs ?? 30000)))
const statusLabel = (value: string) =>
  ({
    live: 'Live · exportação/captura disponível',
    'internal-live': 'Live interno · usado pelo runtime',
    'request-template': 'Request template · não executa operação mutável',
    'reference-only': 'Referência · sem captura ativa',
  })[value] || value

function safeName(value: any) {
  return (
    String(value || 'protocol')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96) || 'protocol'
  )
}
function downloadJson(fileName: string, value: any) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
function clearMessages() {
  error.value = ''
  feedback.value = ''
}
async function run(task: () => Promise<void>, ok: string) {
  if (busy.value) return
  busy.value = true
  clearMessages()
  try {
    await task()
    feedback.value = ok
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}
async function runDevice(device: any, key: string, task: () => Promise<void>, ok: string) {
  if (deviceBusy.value[device.id]) return
  deviceBusy.value = { ...deviceBusy.value, [device.id]: key }
  clearMessages()
  try {
    await task()
    feedback.value = ok
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    const next = { ...deviceBusy.value }
    delete next[device.id]
    deviceBusy.value = next
  }
}
function downloadDescriptor(item: any) {
  downloadJson(`findhub-protocol-${safeName(item.key)}.json`, item)
}
function downloadSchema(schema: any) {
  downloadJson(`findhub-schema-${safeName(schema.key)}.json`, schema)
}
function downloadSchemaCatalog() {
  downloadJson('findhub-protocol-schema-catalog.json', {
    version: 1,
    summary: summary.value,
    schemas: schemas.value,
  })
}
async function downloadEverything() {
  await run(
    () => connect.findHubCaptureProtocolArchive(props.instanceId, effectiveTimeout()),
    'Pacote completo do Protocol Lab baixado em ZIP.',
  )
}
async function downloadInventory() {
  await run(
    () => connect.findHubDownloadProtocolInventory(props.instanceId),
    'Inventário completo baixado em JSON.',
  )
}
async function downloadDeviceArchive(device: any) {
  await runDevice(
    device,
    'zip',
    () => connect.findHubCaptureProtocolArchive(props.instanceId, effectiveTimeout(), [device.id]),
    `ZIP do Protocol Lab baixado para ${device.name}.`,
  )
}
async function captureDeviceUpdate(device: any) {
  await runDevice(
    device,
    'device-update',
    () => connect.findHubCaptureDeviceUpdate(props.instanceId, device.id, effectiveTimeout()),
    `DeviceUpdate bruto baixado para ${device.name}.`,
  )
}
async function captureDeviceRequest(device: any, action: 'locate' | 'sound-start' | 'sound-stop') {
  await runDevice(
    device,
    action,
    () => connect.findHubCaptureActionRequest(props.instanceId, device.id, action),
    `Request ${action} baixado para ${device.name}.`,
  )
}
async function captureCatalog(requestOnly: boolean) {
  await run(
    () =>
      requestOnly
        ? connect.findHubCaptureCatalogRequest(props.instanceId, catalog.value)
        : connect.findHubCaptureCatalog(props.instanceId, catalog.value),
    `${requestOnly ? 'Request' : 'Response'} DevicesList ${catalog.value.toUpperCase()} baixado.`,
  )
}
async function captureEidInfo(requestOnly: boolean) {
  await run(
    () => connect.findHubCaptureEidInfo(props.instanceId, requestOnly),
    `${requestOnly ? 'Request' : 'Response'} GetEidInfo baixado.`,
  )
}
async function captureSecurityUnlock() {
  await run(
    () => connect.findHubCaptureSecurityUnlockRequest(props.instanceId),
    'Request finder_hw baixado.',
  )
}
</script>

<template>
  <div class="protocol-lab-stack">
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>

    <PanelCard title="Protocol Lab" description="Área isolada de desenvolvimento e análise forense do Google Find Hub. Nada desta tela ocupa a ficha operacional dos dispositivos.">
      <div class="summary-tiles">
        <div><b>{{ summary.protocols ?? artifacts.length }}</b><span>Superfícies conhecidas</span></div>
        <div><b>{{ summary.protobufMessages ?? 0 }}</b><span>Mensagens protobuf</span></div>
        <div><b>{{ summary.protobufEnums ?? 0 }}</b><span>Enums protobuf</span></div>
        <div><b>{{ summary.families ?? 0 }}</b><span>Famílias</span></div>
      </div>
      <div class="toolbar top-gap">
        <button class="btn primary" :disabled="busy || !connected" @click="downloadEverything">Baixar tudo em ZIP</button>
        <button class="btn ghost" :disabled="busy" @click="downloadInventory">Inventário completo JSON</button>
        <button class="btn ghost" :disabled="busy" @click="downloadSchemaCatalog">Catálogo protobuf JSON</button>
      </div>
      <div class="alert top-gap">Os arquivos do Protocol Lab podem conter dados sensíveis, IDs canônicos, e-mails, registration IDs FCM e material criptográfico cifrado. Use somente em desenvolvimento/diagnóstico e não publique o ZIP.</div>
    </PanelCard>

    <PanelCard title="Por dispositivo" description="Baixe somente o material de um aparelho, sem misturar os demais devices da conta.">
      <EmptyState v-if="!devices.length" icon="location" title="Nenhum dispositivo disponível" description="Sincronize os dispositivos da conta antes de capturar artefatos por device." />
      <div v-else class="protocol-device-grid">
        <article v-for="device in devices" :key="device.id" class="protocol-device-card">
          <div>
            <strong>{{ device.name }}</strong>
            <small>{{ device.manufacturer || 'Fabricante não informado' }} · {{ device.model || device.deviceType || 'Modelo não informado' }}</small>
          </div>
          <div class="toolbar">
            <button class="btn primary" :disabled="!connected || !!deviceBusy[device.id]" @click="downloadDeviceArchive(device)">ZIP deste device</button>
            <button class="btn ghost" :disabled="!connected || !!deviceBusy[device.id] || device.locateSupported===false" @click="captureDeviceUpdate(device)">DeviceUpdate .pb</button>
            <button class="btn ghost" :disabled="!connected || !!deviceBusy[device.id] || device.locateSupported===false" @click="captureDeviceRequest(device,'locate')">Request Locate .pb</button>
            <button class="btn ghost" :disabled="!connected || !!deviceBusy[device.id] || device.locateSupported===false" @click="captureDeviceRequest(device,'sound-start')">Request Sound Start</button>
            <button class="btn ghost" :disabled="!connected || !!deviceBusy[device.id] || device.locateSupported===false" @click="captureDeviceRequest(device,'sound-stop')">Request Sound Stop</button>
          </div>
          <small v-if="deviceBusy[device.id]" class="muted">Gerando {{ deviceBusy[device.id] }}…</small>
          <small v-else-if="device.locateSupported===false" class="muted">O Google ainda não forneceu canonical action ID para este device.</small>
        </article>
      </div>
    </PanelCard>

    <PanelCard title="Por protocolo" description="Cada superfície possui um descritor individual. Protocolos com captura comprovada oferecem também o arquivo bruto correspondente.">
      <div class="protocol-filters">
        <label class="field"><span>Pesquisar</span><input v-model="query" type="search" placeholder="Nova, MCS, FCM, Spot, EID, Check-in…" /></label>
        <label class="field"><span>Estado</span><select v-model="statusFilter" class="select"><option value="all">Todos</option><option value="live">Live</option><option value="internal-live">Live interno</option><option value="request-template">Request template</option><option value="reference-only">Reference-only</option></select></label>
      </div>
      <div class="findhub-table top-gap">
        <table>
          <thead><tr><th>Família</th><th>Protocolo</th><th>Estado</th><th>Transporte / endpoint</th><th>Arquivo</th></tr></thead>
          <tbody>
            <tr v-for="item in filteredArtifacts" :key="item.key">
              <td><strong>{{ item.family }}</strong><small>{{ item.kind }}</small></td>
              <td><strong>{{ item.protocol }}</strong><small>{{ item.key }}<template v-if="item.messages?.length"> · {{ item.messages.join(' · ') }}</template></small></td>
              <td>{{ statusLabel(item.status) }}</td>
              <td><span>{{ item.transport || 'Não especificado' }}</span><small v-if="item.endpoint">{{ item.endpoint }}</small></td>
              <td>
                <div class="protocol-actions">
                  <button class="btn ghost" @click="downloadDescriptor(item)">Descritor JSON</button>
                  <template v-if="item.key==='nova.devices-list'">
                    <select v-model="catalog" class="select compact"><option value="spot">SPOT</option><option value="android">ANDROID</option><option value="auto">AUTO</option><option value="fastpair">FASTPAIR</option><option value="supervised">SUPERVISED</option></select>
                    <button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog(true)">Request .pb</button>
                    <button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog(false)">Response .pb</button>
                  </template>
                  <template v-else-if="item.key==='spot.get-eid-info'">
                    <button class="btn ghost" :disabled="busy || !connected" @click="captureEidInfo(true)">Request .pb</button>
                    <button class="btn ghost" :disabled="busy || !connected" @click="captureEidInfo(false)">Response .pb</button>
                  </template>
                  <template v-else-if="item.key==='security-domain.finder-hw'">
                    <button class="btn ghost" :disabled="busy || !connected" @click="captureSecurityUnlock">Request .pb</button>
                  </template>
                  <small v-else-if="['nova.execute-action.locate','nova.execute-action.sound-start','nova.execute-action.sound-stop','fcm.device-update'].includes(item.key)" class="muted">Arquivo bruto disponível em “Por dispositivo”.</small>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PanelCard>

    <PanelCard title="Schemas protobuf" description="Catálogo completo de mensagens e enums conhecidos nas referências utilizadas pela Connect|API.">
      <div class="findhub-table">
        <table>
          <thead><tr><th>Schema</th><th>Mensagens</th><th>Enums</th><th>Proveniência</th><th>Arquivo</th></tr></thead>
          <tbody>
            <tr v-for="schema in schemas" :key="schema.key">
              <td><strong>{{ schema.key }}</strong><small>{{ schema.source }}</small></td>
              <td>{{ schema.messages.join(' · ') }}</td>
              <td>{{ schema.enums.length ? schema.enums.join(' · ') : '—' }}</td>
              <td>{{ schema.provenance }}</td>
              <td><button class="btn ghost" @click="downloadSchema(schema)">JSON</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PanelCard>
  </div>
</template>

<style scoped>
.protocol-lab-stack{display:grid;gap:18px}.protocol-device-grid{display:grid;gap:12px}.protocol-device-card{border:1px solid var(--border);border-radius:14px;padding:16px;display:grid;gap:12px}.protocol-device-card>div:first-child{display:flex;flex-direction:column;gap:4px}.protocol-filters{display:grid;grid-template-columns:minmax(240px,2fr) minmax(180px,1fr);gap:12px}.findhub-table{overflow:auto}.findhub-table table{width:100%;border-collapse:collapse}.findhub-table td,.findhub-table th{text-align:left;padding:12px;border-bottom:1px solid var(--border);vertical-align:top}.findhub-table td>small,.findhub-table strong+small{display:block;margin-top:4px}.protocol-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.select.compact{width:auto;min-width:120px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top-gap{margin-top:14px}@media(max-width:800px){.protocol-filters{grid-template-columns:1fr}.protocol-actions{min-width:240px}}
</style>
