<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import FindHubMap from '@/components/FindHubMap.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppShell from '@/layouts/AppShell.vue'
import { friendlyError } from '@/services/errors'
import { connect } from '@/services/connect'

const overview = ref<{ server: any; devices: any[]; positions: any[]; refreshedAt: string } | null>(null)
const selected = ref('')
const error = ref('')
const busy = ref(false)
let refreshTimer: number | null = null

const positions = computed(() => new Map((overview.value?.positions || []).map((position: any) => [String(position.deviceId), position])))
const devices = computed(() => (overview.value?.devices || []).map((device: any) => ({
  ...device,
  position: positions.value.get(String(device.id)) || null,
})))
const device = computed(() => devices.value.find((item: any) => String(item.id) === selected.value) || devices.value[0] || null)
const onlineCount = computed(() => devices.value.filter((item: any) => item.status === 'online').length)
const positionedCount = computed(() => devices.value.filter((item: any) => item.position).length)
const serverName = computed(() => String(overview.value?.server?.server || overview.value?.server?.version || 'Traccar interno'))

function stamp(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

function coordinate(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(6) : '—'
}

function status(item: any) {
  if (item?.status === 'online') return 'Online'
  if (item?.status === 'offline') return 'Offline'
  return item?.status ? String(item.status) : 'Sem estado'
}

async function reload() {
  busy.value = true
  error.value = ''
  try {
    const next = await connect.traccarOverview()
    overview.value = next
    if (!devices.value.some((item: any) => String(item.id) === selected.value)) {
      selected.value = String(devices.value[0]?.id || '')
    }
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível consultar o Traccar interno.')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void reload()
  refreshTimer = window.setInterval(() => void reload(), 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <AppShell>
    <PageHeader
      title="Traccar"
      description="Monitoramento interno da frota, já autenticado pela sua sessão atual do painel."
    >
      <button class="btn ghost" :disabled="busy" @click="reload">
        <AppIcon name="refresh" :size="16" />{{ busy ? 'Atualizando…' : 'Atualizar' }}
      </button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-else-if="!overview" class="loading">Consultando o Traccar interno…</div>
    <template v-else>
      <div class="summary-tiles">
        <div><b>{{ devices.length }}</b><span>Dispositivos</span></div>
        <div><b>{{ onlineCount }}</b><span>Online</span></div>
        <div><b>{{ positionedCount }}</b><span>Com posição</span></div>
        <div><b>{{ stamp(overview.refreshedAt) }}</b><span>Última atualização</span></div>
      </div>

      <div class="traccar-grid">
        <section class="panel fleet-panel">
          <div class="panel-heading">
            <div><h2>Frota</h2><p>{{ serverName }}</p></div>
          </div>
          <div v-if="!devices.length" class="empty">Nenhum dispositivo cadastrado no Traccar.</div>
          <button
            v-for="item in devices"
            :key="item.id"
            class="device-row"
            :class="{ active: String(item.id) === String(device?.id) }"
            type="button"
            @click="selected = String(item.id)"
          >
            <span class="dot" :class="item.status === 'online' ? 'online' : 'offline'"></span>
            <span><strong>{{ item.name || `Dispositivo ${item.id}` }}</strong><small>{{ status(item) }} · {{ stamp(item.position?.fixTime || item.position?.deviceTime) }}</small></span>
            <AppIcon name="chevron" :size="16" />
          </button>
        </section>

        <section class="panel map-panel">
          <div class="panel-heading"><div><h2>{{ device?.name || 'Selecione um dispositivo' }}</h2><p>{{ status(device) }}</p></div></div>
          <FindHubMap :position="device?.position" :device-name="device?.name" />
          <dl v-if="device?.position" class="position-details">
            <div><dt>Latitude</dt><dd>{{ coordinate(device.position.latitude) }}</dd></div>
            <div><dt>Longitude</dt><dd>{{ coordinate(device.position.longitude) }}</dd></div>
            <div><dt>Velocidade</dt><dd>{{ Number(device.position.speed || 0).toFixed(1) }} kn</dd></div>
            <div><dt>Recebida em</dt><dd>{{ stamp(device.position.serverTime || device.position.fixTime || device.position.deviceTime) }}</dd></div>
          </dl>
        </section>
      </div>

      <p class="muted footnote">A tela usa somente a API interna do Traccar. A senha administrativa e a sessão dele permanecem no servidor; não há novo domínio, porta ou login no navegador.</p>
    </template>
  </AppShell>
</template>

<style scoped>
.loading{padding:32px;color:var(--muted,#64748b)}
.traccar-grid{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(0,1.6fr);gap:18px;margin-top:18px}
.panel{border:1px solid var(--border,#dbe4ef);border-radius:14px;background:var(--surface,#fff);overflow:hidden}
.panel-heading{padding:18px;border-bottom:1px solid var(--border,#dbe4ef)}
.panel-heading h2{margin:0;font-size:16px}.panel-heading p{margin:5px 0 0;color:var(--muted,#64748b);font-size:13px}
.device-row{display:flex;width:100%;gap:11px;align-items:center;padding:14px 16px;border:0;border-bottom:1px solid var(--border,#dbe4ef);background:transparent;color:inherit;text-align:left;cursor:pointer}
.device-row:hover,.device-row.active{background:var(--surface-2,#f7f9fc)}.device-row>span:nth-child(2){display:grid;gap:3px;flex:1;min-width:0}.device-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-row small{color:var(--muted,#64748b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:9px;height:9px;border-radius:99px;flex:0 0 auto}.dot.online{background:#16a34a}.dot.offline{background:#94a3b8}
.empty{padding:26px 18px;color:var(--muted,#64748b)}
.map-panel :deep(.location-map){border:0;border-radius:0;height:430px}.map-panel :deep(.attribution){right:8px}.map-panel :deep(.map-empty){min-height:430px}
.position-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0;padding:16px;gap:14px;border-top:1px solid var(--border,#dbe4ef)}.position-details div{min-width:0}.position-details dt{font-size:12px;color:var(--muted,#64748b)}.position-details dd{margin:4px 0 0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.footnote{margin:14px 0 0;font-size:12px}
@media(max-width:900px){.traccar-grid{grid-template-columns:1fr}.fleet-panel{max-height:360px;overflow:auto}}
@media(max-width:560px){.position-details{grid-template-columns:1fr}.map-panel :deep(.location-map),.map-panel :deep(.map-empty){height:340px;min-height:340px}}
</style>
