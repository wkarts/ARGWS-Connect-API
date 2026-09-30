<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { project, unproject, zoomAt } from '@/services/findhub-map'

type TraccarPoint = {
  latitude: number
  longitude: number
  accuracy?: number
}

type TraccarDevice = {
  id?: string | number
  name?: string
  uniqueId?: string
  category?: string
  status?: string
  lastUpdate?: string
  position?: (TraccarPoint & { fixTime?: string; deviceTime?: string; serverTime?: string; speed?: number; course?: number; attributes?: Record<string, unknown> }) | null
}

const props = withDefaults(defineProps<{
  devices?: TraccarDevice[]
  selectedId?: string
  tileUrl?: string
}>(), { devices: () => [] })

const emit = defineEmits<{ select: [id: string]; selectAll: [] }>()

const viewport = ref<HTMLElement>()
const width = ref(960)
const height = ref(560)
const center = ref({ latitude: 0, longitude: 0 })
const zoom = ref(3)
const follow = ref(true)
const query = ref('')
const statusFilter = ref<'all' | 'online' | 'offline'>('all')
const drawerOpen = ref(true)
const tileError = ref(false)
const retryGeneration = ref(0)
let observer: ResizeObserver | undefined
let drag: { x: number; y: number; center: { x: number; y: number } } | null = null
let wheelDelta = 0
let lastWheel = -Infinity

function validPoint(value: unknown): value is TraccarPoint {
  const point = value as Partial<TraccarPoint> | null | undefined
  return Number.isFinite(Number(point?.latitude)) && Number(point?.latitude) >= -90 && Number(point?.latitude) <= 90 &&
    Number.isFinite(Number(point?.longitude)) && Number(point?.longitude) >= -180 && Number(point?.longitude) <= 180
}

function pointOf(device: TraccarDevice) {
  return validPoint(device.position) ? { ...device.position, latitude: Number(device.position.latitude), longitude: Number(device.position.longitude) } : null
}

const filteredDevices = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return props.devices.filter((device) => {
    const matchesQuery = !needle || [device.name, device.uniqueId, device.category].some(value => String(value || '').toLocaleLowerCase().includes(needle))
    const matchesStatus = statusFilter.value === 'all' || (statusFilter.value === 'online' ? device.status === 'online' : device.status !== 'online')
    return matchesQuery && matchesStatus
  })
})

const positionedDevices = computed(() => props.devices.filter(device => pointOf(device)))
const selectedDevice = computed(() => props.devices.find(device => String(device.id) === String(props.selectedId)) || null)
const world = computed(() => 256 * 2 ** zoom.value)
const origin = computed(() => {
  const point = project(center.value.latitude, center.value.longitude, zoom.value)
  return { x: point.x - width.value / 2, y: point.y - height.value / 2 }
})

function locate(point: TraccarPoint) {
  const projected = project(point.latitude, point.longitude, zoom.value)
  let x = projected.x - origin.value.x
  x -= Math.round((x - width.value / 2) / world.value) * world.value
  return { x, y: projected.y - origin.value.y }
}

const markers = computed(() => positionedDevices.value.map((device, index) => {
  const point = pointOf(device) as TraccarPoint
  return {
    device,
    point,
    key: String(device.id ?? `${device.name || 'device'}-${index}`),
    ...locate(point),
  }
}))

const tiles = computed(() => {
  if (tileError.value) return []
  const template = props.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  if (!template.startsWith('https://')) return []
  const output: Array<{ key: string; src: string; x: number; y: number }> = []
  const count = 2 ** zoom.value
  for (let x = Math.floor(origin.value.x / 256); x <= Math.floor((origin.value.x + width.value) / 256); x += 1) {
    for (let y = Math.floor(origin.value.y / 256); y <= Math.floor((origin.value.y + height.value) / 256); y += 1) {
      if (y < 0 || y >= count) continue
      output.push({
        key: `${zoom.value}/${x}/${y}`,
        src: template.replace('{z}', String(zoom.value)).replace('{x}', String((x % count + count) % count)).replace('{y}', String(y)),
        x: x * 256 - origin.value.x,
        y: y * 256 - origin.value.y,
      })
    }
  }
  return output
})

function fitToDevices() {
  const points = positionedDevices.value.map(device => pointOf(device) as TraccarPoint)
  if (!points.length) {
    center.value = { latitude: 0, longitude: 0 }
    zoom.value = 3
    return
  }
  const selectedPoint = selectedDevice.value && pointOf(selectedDevice.value)
  if (selectedPoint && props.selectedId) {
    center.value = { latitude: selectedPoint.latitude, longitude: selectedPoint.longitude }
    zoom.value = 15
    return
  }
  const latitude = (Math.min(...points.map(point => point.latitude)) + Math.max(...points.map(point => point.latitude))) / 2
  const longitude = (Math.min(...points.map(point => point.longitude)) + Math.max(...points.map(point => point.longitude))) / 2
  let fittedZoom = 15
  for (let candidate = 15; candidate >= 2; candidate -= 1) {
    const projected = points.map(point => project(point.latitude, point.longitude, candidate))
    const spanX = Math.max(...projected.map(point => point.x)) - Math.min(...projected.map(point => point.x))
    const spanY = Math.max(...projected.map(point => point.y)) - Math.min(...projected.map(point => point.y))
    if (spanX <= width.value * 0.68 && spanY <= height.value * 0.68) {
      fittedZoom = candidate
      break
    }
  }
  center.value = { latitude, longitude }
  zoom.value = fittedZoom
}

function selectDevice(device: TraccarDevice) {
  if (device.id == null) return
  emit('select', String(device.id))
  follow.value = true
}

function selectAll() {
  emit('selectAll')
  follow.value = true
}

function recenter() {
  fitToDevices()
  follow.value = true
}

function zoomBy(delta: number) {
  zoom.value = Math.max(2, Math.min(19, zoom.value + delta))
  follow.value = false
}

function retryTiles() {
  tileError.value = false
  retryGeneration.value += 1
}

function start(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button,a,input,select')) return
  follow.value = false
  viewport.value?.setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY, center: project(center.value.latitude, center.value.longitude, zoom.value) }
}

function move(event: PointerEvent) {
  if (!drag) return
  center.value = unproject(drag.center.x - event.clientX + drag.x, drag.center.y - event.clientY + drag.y, zoom.value)
}

function stopDrag(event?: PointerEvent) {
  if (event && viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  drag = null
}

function key(event: KeyboardEvent) {
  const delta: Record<string, [number, number]> = { ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0] }
  if (!delta[event.key]) return
  event.preventDefault()
  follow.value = false
  const point = project(center.value.latitude, center.value.longitude, zoom.value)
  center.value = unproject(point.x + delta[event.key][0], point.y + delta[event.key][1], zoom.value)
}

function wheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey || !viewport.value) return
  event.preventDefault()
  wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height.value : 1)
  if (Math.abs(wheelDelta) < 60 || event.timeStamp - lastWheel < 120) return
  const rect = viewport.value.getBoundingClientRect()
  const result = zoomAt(center.value, zoom.value, zoom.value + (wheelDelta < 0 ? 1 : -1), event.clientX - rect.left, event.clientY - rect.top, width.value, height.value)
  zoom.value = result.zoom
  center.value = result.center
  follow.value = false
  drag = null
  wheelDelta = 0
  lastWheel = event.timeStamp
}

function statusLabel(device: TraccarDevice) {
  if (device.status === 'online') return 'Online'
  if (device.status === 'offline') return 'Offline'
  return device.status || 'Desconhecido'
}

watch(() => props.tileUrl, () => { tileError.value = false })
watch(() => [props.devices, props.selectedId], () => { if (follow.value) fitToDevices() }, { deep: true, immediate: true })

onMounted(() => {
  viewport.value?.addEventListener('wheel', wheel, { passive: false })
  observer = new ResizeObserver(entries => {
    const rectangle = entries[0]?.contentRect
    if (!rectangle) return
    width.value = Math.max(1, rectangle.width)
    height.value = Math.max(1, rectangle.height)
    if (follow.value) fitToDevices()
  })
  if (viewport.value) observer.observe(viewport.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  viewport.value?.removeEventListener('wheel', wheel)
})
</script>

<template>
  <div class="traccar-map" :class="{ 'drawer-collapsed': !drawerOpen }">
    <div ref="viewport" class="traccar-map-canvas" tabindex="0" role="region" aria-label="Mapa Traccar. Use o scroll para aproximar, arraste para mover e use as setas do teclado." @pointerdown="start" @pointermove="move" @pointerup="stopDrag" @pointercancel="stopDrag" @keydown="key">
      <img v-for="tile in tiles" :key="`${retryGeneration}:${tile.key}`" :src="tile.src" referrerpolicy="strict-origin" decoding="async" @error="tileError = true" alt="" width="256" height="256" draggable="false" :style="{ left: `${tile.x}px`, top: `${tile.y}px` }" />
      <svg class="traccar-map-overlay" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
        <g v-for="marker in markers" :key="`accuracy-${marker.key}`">
          <circle :cx="marker.x" :cy="marker.y" :r="Math.min(160, Math.max(12, Number(marker.point.accuracy || 0) / 3))" :class="['accuracy-ring', { selected: String(marker.device.id) === String(selectedId) }]" />
        </g>
      </svg>
      <button v-for="marker in markers" :key="marker.key" type="button" class="traccar-marker" :class="[{ selected: String(marker.device.id) === String(selectedId) }, marker.device.status === 'online' ? 'online' : 'offline']" :style="{ left: `${marker.x}px`, top: `${marker.y}px` }" :aria-label="`Selecionar ${marker.device.name || marker.device.id}`" @pointerdown.stop @click.stop="selectDevice(marker.device)">
        <span></span>
        <small v-if="markers.length <= 18">{{ marker.device.name || `Dispositivo ${marker.device.id}` }}</small>
      </button>
      <div v-if="!positionedDevices.length" class="traccar-map-empty" role="status"><AppIcon name="location" :size="24" /><strong>Nenhuma posição disponível</strong><span>O Traccar ainda não recebeu uma posição válida para esta frota.</span></div>
      <div class="traccar-map-tools" aria-label="Controles do mapa">
        <button type="button" class="map-tool" aria-label="Aproximar mapa" :disabled="zoom >= 19" @click.stop="zoomBy(1)"><AppIcon name="plus" :size="18" /></button>
        <button type="button" class="map-tool" aria-label="Afastar mapa" :disabled="zoom <= 2" @click.stop="zoomBy(-1)"><AppIcon name="minus" :size="18" /></button>
        <button type="button" class="map-tool" aria-label="Enquadrar dispositivos" @click.stop="recenter"><AppIcon name="location" :size="18" /></button>
      </div>
      <div v-if="tileError" class="traccar-map-error" role="alert"><strong>O mapa não foi carregado.</strong><span>Verifique o servidor de tiles configurado para o Traccar.</span><button type="button" class="btn ghost compact" @click.stop="retryTiles">Tentar novamente</button></div>
      <small class="traccar-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></small>
    </div>

    <aside class="traccar-device-drawer" aria-label="Dispositivos Traccar">
      <header class="drawer-header"><div><strong>Dispositivos</strong><small>{{ positionedDevices.length }} com posição · {{ props.devices.length }} cadastrados</small></div><button type="button" class="drawer-close" aria-label="Ocultar lista de dispositivos" @click="drawerOpen = false"><AppIcon name="close" :size="17" /></button></header>
      <div class="drawer-search"><AppIcon name="search" :size="16" /><input v-model="query" type="search" placeholder="Buscar dispositivo" aria-label="Buscar dispositivo" /></div>
      <div class="drawer-filters" role="group" aria-label="Filtrar dispositivos"><button type="button" :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">Todos</button><button type="button" :class="{ active: statusFilter === 'online' }" @click="statusFilter = 'online'">Online</button><button type="button" :class="{ active: statusFilter === 'offline' }" @click="statusFilter = 'offline'">Offline</button></div>
      <div class="drawer-list">
        <button type="button" class="drawer-all" :class="{ selected: !selectedId }" @click="selectAll"><span class="device-state all"></span><span class="device-copy"><strong>Todos os dispositivos</strong><small>Exibir a frota inteira</small></span><AppIcon name="chevron" :size="15" /></button>
        <button v-for="device in filteredDevices" :key="device.id" type="button" class="drawer-device" :class="{ selected: String(device.id) === String(selectedId) }" @click="selectDevice(device)">
          <span class="device-state" :class="device.status === 'online' ? 'online' : 'offline'"></span>
          <span class="device-copy"><strong>{{ device.name || `Dispositivo ${device.id}` }}</strong><small>{{ statusLabel(device) }} · {{ device.uniqueId || 'sem identificador' }}</small></span>
          <AppIcon name="chevron" :size="15" />
        </button>
        <p v-if="!filteredDevices.length" class="drawer-empty">Nenhum dispositivo corresponde ao filtro.</p>
      </div>
      <footer class="drawer-footer"><span class="legend-dot online"></span><span>Online</span><span class="legend-dot offline"></span><span>Offline/sem estado</span></footer>
    </aside>
    <button v-if="!drawerOpen" type="button" class="drawer-open" aria-label="Mostrar lista de dispositivos" @click="drawerOpen = true"><AppIcon name="fleet" :size="18" /><span>Dispositivos</span></button>
    <div v-if="follow" class="map-mode">Enquadramento automático</div>
  </div>
</template>

<style scoped>
.traccar-map{position:relative;isolation:isolate;min-width:0;height:clamp(480px,calc(100dvh - 270px),760px);overflow:hidden;border:1px solid var(--border);border-radius:14px;background:#dce5ed;box-shadow:var(--shadow)}
.traccar-map-canvas{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;outline:0}.traccar-map-canvas:active{cursor:grabbing}.traccar-map-canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--primary)}.traccar-map-canvas>img{position:absolute;max-width:none;user-select:none}.traccar-map-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.accuracy-ring{fill:var(--primary);fill-opacity:.12;stroke:var(--primary);stroke-opacity:.35;stroke-width:1.2}.accuracy-ring.selected{fill-opacity:.2;stroke-width:2}
.traccar-marker{position:absolute;z-index:3;display:grid;justify-items:center;gap:4px;transform:translate(-50%,-50%);border:0;background:transparent;padding:0;color:#0f172a;cursor:pointer}.traccar-marker>span{display:block;width:16px;height:16px;border:3px solid #fff;border-radius:50%;background:#64748b;box-shadow:0 2px 8px #0f172a66}.traccar-marker.online>span{background:#16a34a}.traccar-marker.selected>span{width:21px;height:21px;background:var(--primary);box-shadow:0 0 0 4px #fff,0 0 0 7px color-mix(in srgb,var(--primary) 45%,transparent)}.traccar-marker small{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 6px;border-radius:5px;background:#fff;box-shadow:0 1px 5px #0f172a33;font-size:10px;font-weight:700}
.traccar-map-tools{position:absolute;z-index:5;top:16px;right:16px;display:grid;gap:6px}.map-tool{display:grid;place-items:center;width:36px;height:36px;border:1px solid #c8d4df;border-radius:8px;background:#fff;color:#1e293b;box-shadow:0 2px 8px #0f172a26}.map-tool:hover{color:var(--primary);border-color:var(--primary)}.map-tool:disabled{opacity:.45;cursor:not-allowed}.traccar-map-empty{position:absolute;z-index:4;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:7px;width:min(340px,calc(100% - 40px));padding:20px;text-align:center;color:var(--muted);background:color-mix(in srgb,var(--surface) 93%,transparent);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}.traccar-map-empty strong{color:var(--text);font-size:14px}.traccar-map-empty span{font-size:12px;line-height:1.4}.traccar-map-error{position:absolute;z-index:6;left:50%;bottom:36px;transform:translateX(-50%);display:grid;gap:7px;width:min(390px,calc(100% - 32px));padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);font-size:12px}.traccar-map-error span{color:var(--muted)}.traccar-attribution{position:absolute;z-index:6;right:0;bottom:0;padding:4px 7px;background:#fff;color:#475569;font-size:10px}.traccar-attribution a{color:inherit}
.traccar-device-drawer{position:absolute;z-index:7;inset:16px auto 16px 16px;display:flex;flex-direction:column;width:min(310px,calc(100% - 96px));overflow:hidden;background:color-mix(in srgb,var(--surface) 96%,transparent);border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 28px #0f172a2e;backdrop-filter:blur(9px)}.drawer-collapsed .traccar-device-drawer{display:none}.drawer-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:15px 15px 12px;border-bottom:1px solid var(--border)}.drawer-header div{display:grid;gap:3px;min-width:0}.drawer-header strong{font-size:14px}.drawer-header small{color:var(--muted);font-size:10px}.drawer-close,.drawer-open{display:grid;place-items:center;border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:7px}.drawer-close{width:29px;height:29px;flex:none}.drawer-search{display:flex;align-items:center;gap:7px;margin:12px 12px 8px;padding:0 9px;height:34px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.drawer-search input{min-width:0;width:100%;border:0;outline:0;background:transparent;color:var(--text);font-size:12px}.drawer-filters{display:flex;gap:4px;padding:0 12px 9px}.drawer-filters button{flex:1;padding:6px 4px;border:1px solid transparent;border-radius:6px;background:var(--surface-2);color:var(--muted);font-size:10px;font-weight:700}.drawer-filters button.active{background:var(--primary-soft);border-color:color-mix(in srgb,var(--primary) 25%,var(--border));color:var(--primary)}.drawer-list{min-height:0;overflow:auto;border-top:1px solid var(--border)}.drawer-device,.drawer-all{display:flex;align-items:center;gap:9px;width:100%;padding:11px 12px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);text-align:left;cursor:pointer}.drawer-device:hover,.drawer-device.selected,.drawer-all:hover,.drawer-all.selected{background:var(--primary-soft)}.device-state,.legend-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:none}.device-state.online,.legend-dot.online{background:#16a34a}.device-state.all{background:var(--primary)}.device-copy{display:grid;gap:3px;min-width:0;flex:1}.device-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.device-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px}.drawer-empty{padding:18px 14px;color:var(--muted);font-size:11px;text-align:center}.drawer-footer{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:9px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:10px}.drawer-footer .legend-dot.offline{margin-left:6px}.drawer-open{position:absolute;z-index:8;top:16px;left:16px;display:flex;align-items:center;gap:6px;padding:8px 10px;color:#1e293b;box-shadow:0 2px 8px #0f172a26;font-size:11px;font-weight:700}.map-mode{position:absolute;z-index:7;left:50%;bottom:12px;transform:translateX(-50%);padding:5px 9px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#475569;box-shadow:0 2px 8px #0f172a1f;font-size:10px;font-weight:700;pointer-events:none}
@media(max-width:900px){.traccar-map{height:clamp(460px,calc(100dvh - 235px),680px)}.traccar-device-drawer{inset:12px auto 12px 12px;width:min(295px,calc(100% - 70px))}.traccar-map-tools{top:12px;right:12px}}
@media(max-width:560px){.traccar-map{height:calc(100dvh - 205px);min-height:420px}.traccar-device-drawer{inset:10px 10px auto 10px;width:calc(100% - 20px);max-height:min(285px,56%)}.drawer-list{max-height:145px}.traccar-map-tools{top:auto;right:10px;bottom:42px}.drawer-open{top:10px;left:10px}.map-mode{bottom:9px}.traccar-marker small{display:none}.traccar-map-error{bottom:70px}}
</style>
