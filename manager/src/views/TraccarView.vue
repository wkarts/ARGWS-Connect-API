<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AppShell from '@/layouts/AppShell.vue'
import TraccarMap from '@/components/TraccarMap.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'

type TraccarOverview = { server: any; devices: any[]; positions: any[]; refreshedAt: string; map?: { tileUrl: string } }

const ALL_DEVICES = '__all__'
const overview = ref<TraccarOverview | null>(null)
const selected = ref(ALL_DEVICES)
const error = ref('')
const busy = ref(false)
let refreshTimer: number | null = null

const positions = computed(() => new Map((overview.value?.positions || []).map((position: any) => [String(position.deviceId), position])))
const devices = computed(() => (overview.value?.devices || []).map((device: any) => ({
  ...device,
  position: positions.value.get(String(device.id)) || null,
})))
const selectedDevice = computed(() => selected.value === ALL_DEVICES ? null : devices.value.find((device: any) => String(device.id) === selected.value) || null)
const onlineCount = computed(() => devices.value.filter((device: any) => device.status === 'online').length)
const positionedCount = computed(() => devices.value.filter((device: any) => device.position).length)
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

function statusLabel(device: any) {
  if (device?.status === 'online') return 'Online'
  if (device?.status === 'offline') return 'Offline'
  return device?.status ? String(device.status) : 'Desconhecido'
}

function battery(device: any) {
  const attributes = device?.position?.attributes || {}
  const percentage = Number(attributes.batt ?? attributes.batteryLevel)
  return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 ? `${percentage.toFixed(0)}%` : 'Não informado'
}

function positionTime(device: any) {
  return stamp(device?.position?.fixTime || device?.position?.deviceTime || device?.position?.serverTime || device?.lastUpdate)
}

async function reload() {
  busy.value = true
  error.value = ''
  try {
    const next = await connect.traccarOverview()
    overview.value = next
    if (selected.value !== ALL_DEVICES && !devices.value.some((device: any) => String(device.id) === selected.value)) selected.value = ALL_DEVICES
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
    <div class="traccar-page">
      <header class="traccar-heading">
        <div class="heading-copy">
          <div class="heading-kicker"><span class="connection-dot"></span><span>Traccar interno</span><span class="heading-separator">·</span><strong>{{ serverName }}</strong></div>
          <h1>Frota Traccar</h1>
          <p>Mapa, dispositivos e posições recebidas pelo Traccar.</p>
        </div>
        <div class="heading-actions">
          <span v-if="overview" class="refresh-time">Atualizado {{ stamp(overview.refreshedAt) }}</span>
          <button class="btn ghost" :disabled="busy" @click="reload"><AppIcon name="refresh" :size="16" />{{ busy ? 'Atualizando…' : 'Atualizar' }}</button>
        </div>
      </header>

      <div v-if="error" class="alert error">{{ error }}</div>
      <div v-else-if="!overview" class="loading">Consultando o Traccar interno…</div>
      <template v-else>
        <div class="traccar-stats" aria-label="Resumo da frota">
          <div><strong>{{ devices.length }}</strong><span>Dispositivos</span></div>
          <div><strong>{{ onlineCount }}</strong><span>Online no Traccar</span></div>
          <div><strong>{{ positionedCount }}</strong><span>Com posição</span></div>
          <div class="stats-context"><AppIcon name="fleet" :size="16" /><span>{{ selected === ALL_DEVICES ? 'Todos os dispositivos' : (selectedDevice?.name || 'Dispositivo selecionado') }}</span></div>
        </div>

        <section class="traccar-console" aria-label="Console de mapas do Traccar">
          <TraccarMap :devices="devices" :selected-id="selected === ALL_DEVICES ? undefined : selected" :tile-url="overview.map?.tileUrl" @select="selected = $event" />
          <aside v-if="selectedDevice" class="traccar-detail-card" aria-label="Detalhes do dispositivo selecionado">
            <header>
              <div class="detail-title"><span class="device-detail-dot" :class="selectedDevice.status === 'online' ? 'online' : 'offline'"></span><div><strong>{{ selectedDevice.name || `Dispositivo ${selectedDevice.id}` }}</strong><small>{{ selectedDevice.uniqueId || 'Sem identificador' }}</small></div></div>
              <button type="button" class="detail-close" aria-label="Exibir todos os dispositivos" @click="selected = ALL_DEVICES"><AppIcon name="close" :size="15" /></button>
            </header>
            <div class="detail-status"><strong>{{ statusLabel(selectedDevice) }}</strong><span>Estado retornado pelo Traccar</span></div>
            <dl class="detail-grid">
              <div><dt>Última posição</dt><dd>{{ positionTime(selectedDevice) }}</dd></div>
              <div><dt>Bateria</dt><dd>{{ battery(selectedDevice) }}</dd></div>
              <div><dt>Latitude</dt><dd>{{ coordinate(selectedDevice.position?.latitude) }}</dd></div>
              <div><dt>Longitude</dt><dd>{{ coordinate(selectedDevice.position?.longitude) }}</dd></div>
              <div><dt>Velocidade</dt><dd>{{ selectedDevice.position ? `${Number(selectedDevice.position.speed || 0).toFixed(1)} kn` : '—' }}</dd></div>
              <div><dt>Direção</dt><dd>{{ selectedDevice.position?.course != null ? `${Number(selectedDevice.position.course).toFixed(0)}°` : '—' }}</dd></div>
            </dl>
          </aside>
        </section>

        <p class="traccar-note">Esta tela consulta a API do Traccar pelo servidor da aplicação. O estado exibido é o estado nativo do Traccar e a posição é o último relatório recebido; o navegador não abre uma segunda sessão nem um endereço interno.</p>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.traccar-page{min-width:0}.traccar-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:15px}.heading-copy{min-width:0}.heading-kicker{display:flex;align-items:center;gap:7px;margin-bottom:6px;color:var(--muted);font-size:11px}.heading-kicker strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-weight:650}.heading-separator{color:var(--border)}.connection-dot,.device-detail-dot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px var(--success-soft)}.traccar-heading h1{margin:0;font-size:26px;letter-spacing:-.025em}.traccar-heading p{margin:4px 0 0;color:var(--muted);font-size:13px}.heading-actions{display:flex;align-items:center;gap:10px;flex:none}.refresh-time{color:var(--muted);font-size:11px;white-space:nowrap}.loading{padding:32px;color:var(--muted)}
.traccar-stats{display:flex;align-items:center;gap:0;min-height:58px;margin-bottom:13px;padding:0 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}.traccar-stats>div{display:flex;align-items:baseline;gap:7px;padding:0 18px;border-right:1px solid var(--border)}.traccar-stats>div:first-child{padding-left:2px}.traccar-stats>div:last-child{border-right:0}.traccar-stats strong{font-size:19px;letter-spacing:-.02em}.traccar-stats span{color:var(--muted);font-size:11px;white-space:nowrap}.stats-context{margin-left:auto!important;max-width:34%;border-right:0!important;color:var(--primary)}.stats-context svg{flex:none}.stats-context span{overflow:hidden;text-overflow:ellipsis;color:var(--primary);font-weight:700}
.traccar-console{position:relative;min-width:0}.traccar-detail-card{position:absolute;z-index:10;right:16px;bottom:16px;width:min(300px,calc(100% - 48px));padding:13px;border:1px solid #cbd5e1;border-radius:12px;background:color-mix(in srgb,var(--surface) 95%,transparent);box-shadow:0 8px 28px #0f172a2e;backdrop-filter:blur(10px)}.traccar-detail-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.detail-title{display:flex;align-items:center;gap:8px;min-width:0}.detail-title>div{display:grid;gap:2px;min-width:0}.detail-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.detail-title small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px}.device-detail-dot{flex:none}.device-detail-dot.offline{background:#94a3b8;box-shadow:0 0 0 3px #e2e8f0}.detail-close{display:grid;place-items:center;width:25px;height:25px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--muted);flex:none}.detail-status{display:flex;align-items:baseline;gap:6px;margin:12px 0 9px;padding-bottom:9px;border-bottom:1px solid var(--border)}.detail-status strong{color:var(--success);font-size:12px}.detail-status span{color:var(--muted);font-size:10px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:0}.detail-grid div{min-width:0}.detail-grid dt{color:var(--muted);font-size:9px}.detail-grid dd{margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.traccar-note{margin:10px 0 0;color:var(--muted);font-size:11px;line-height:1.45}
@media(max-width:1050px){.traccar-stats>div{padding:0 12px}.stats-context{max-width:30%}.traccar-detail-card{right:12px;bottom:12px}}
@media(max-width:760px){.traccar-heading{flex-direction:column;gap:12px}.heading-actions{width:100%;justify-content:space-between}.traccar-stats{align-items:stretch;flex-wrap:wrap;padding:7px 10px;gap:4px}.traccar-stats>div,.traccar-stats>div:first-child{flex:1 1 31%;justify-content:center;padding:6px 6px;border-right:0}.traccar-stats .stats-context{flex-basis:100%;justify-content:flex-start;max-width:none;padding:6px 2px;border-top:1px solid var(--border)}.refresh-time{font-size:10px}}
@media(max-width:560px){.traccar-heading h1{font-size:23px}.heading-actions,.heading-actions .btn{width:100%}.heading-actions{align-items:stretch;flex-direction:column}.refresh-time{order:2}.traccar-detail-card{right:10px;bottom:10px;width:calc(100% - 20px)}.traccar-note{font-size:10px}}
</style>
