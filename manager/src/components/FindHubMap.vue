<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { project, unproject, zoomAt } from '@/services/findhub-map'

type MapPoint = { latitude: number; longitude: number; accuracy?: number; timestamp?: string }
type MapDevice = { id?: string | number; name?: string; position?: MapPoint | null; avatarData?: string | null; status?: string }

const props = withDefaults(defineProps<{
  position?: MapPoint | null
  positions?: MapDevice[]
  trail?: MapPoint[]
  tileUrl?: string
  avatarData?: string | null
  deviceName?: string
  initialCenter?: MapPoint | null
  initialZoom?: number
}>(), { initialZoom: 4 })

const viewport = ref<HTMLElement>()
const width = ref(800)
const height = ref(430)
const follow = ref(true)
const tileError = ref(false)
const retryGeneration = ref(0)
const center = ref({ latitude: 0, longitude: 0 })
const zoom = ref(props.initialZoom)
let observer: ResizeObserver | undefined
let drag: { x: number; y: number; center: { x: number; y: number } } | null = null

function validPoint(value: any): value is MapPoint {
  return Number.isFinite(Number(value?.latitude)) && Number(value.latitude) >= -90 && Number(value.latitude) <= 90 &&
    Number.isFinite(Number(value?.longitude)) && Number(value.longitude) >= -180 && Number(value.longitude) <= 180
}

function normalizedPoint(value: any): MapPoint | null {
  return validPoint(value) ? { ...value, latitude: Number(value.latitude), longitude: Number(value.longitude) } : null
}

const fallbackCenter = computed(() => normalizedPoint(props.initialCenter) || { latitude: 0, longitude: 0 })
const singlePosition = computed(() => normalizedPoint(props.position))
const mapDevices = computed<MapDevice[]>(() => {
  const devices = (props.positions || []).filter(item => validPoint(item?.position))
  if (devices.length) return devices
  return singlePosition.value
    ? [{ id: 'selected', name: props.deviceName || 'Dispositivo', position: singlePosition.value, avatarData: props.avatarData }]
    : []
})
const hasPosition = computed(() => mapDevices.value.length > 0)
const world = computed(() => 256 * 2 ** zoom.value)
const origin = computed(() => {
  const point = project(center.value.latitude, center.value.longitude, zoom.value)
  return { x: point.x - width.value / 2, y: point.y - height.value / 2 }
})
const locate = (point: MapPoint) => {
  const projected = project(point.latitude, point.longitude, zoom.value)
  let x = projected.x - origin.value.x
  x -= Math.round((x - width.value / 2) / world.value) * world.value
  return { x, y: projected.y - origin.value.y }
}
const markers = computed(() => mapDevices.value.map((item, index) => ({
  ...item,
  key: String(item.id ?? `${item.name || 'device'}-${index}`),
  point: item.position as MapPoint,
  ...locate(item.position as MapPoint),
})))
const trail = computed(() => (props.trail || []).filter(validPoint).slice(-500).map(point => {
  const screen = locate(point)
  return `${screen.x},${screen.y}`
}).join(' '))
const accuracy = (point: MapPoint) => Math.min(2000, Math.max(0, (point.accuracy || 0) /
  (156543.03392 * Math.cos(center.value.latitude * Math.PI / 180) / 2 ** zoom.value)))
const tiles = computed(() => {
  if (tileError.value) return []
  const out: { key: string; src: string; x: number; y: number }[] = []
  const n = 2 ** zoom.value
  const template = props.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  if (!template.startsWith('https://')) return out
  for (let x = Math.floor(origin.value.x / 256); x <= Math.floor((origin.value.x + width.value) / 256); x++) {
    for (let y = Math.floor(origin.value.y / 256); y <= Math.floor((origin.value.y + height.value) / 256); y++) {
      if (y < 0 || y >= n) continue
      out.push({
        key: `${zoom.value}/${x}/${y}`,
        src: template.replace('{z}', String(zoom.value)).replace('{x}', String((x % n + n) % n)).replace('{y}', String(y)),
        x: x * 256 - origin.value.x,
        y: y * 256 - origin.value.y,
      })
    }
  }
  return out
})

function fitToMarkers() {
  const points = mapDevices.value.map(item => item.position as MapPoint)
  if (!points.length) {
    center.value = { latitude: fallbackCenter.value.latitude, longitude: fallbackCenter.value.longitude }
    zoom.value = Math.max(2, Math.min(19, props.initialZoom))
    return
  }
  const latitude = (Math.min(...points.map(point => point.latitude)) + Math.max(...points.map(point => point.latitude))) / 2
  const longitude = (Math.min(...points.map(point => point.longitude)) + Math.max(...points.map(point => point.longitude))) / 2
  if (points.length === 1) {
    center.value = { latitude, longitude }
    zoom.value = 15
    return
  }
  let fittedZoom = 15
  for (let candidate = 15; candidate >= 2; candidate--) {
    const projected = points.map(point => project(point.latitude, point.longitude, candidate))
    const spanX = Math.max(...projected.map(point => point.x)) - Math.min(...projected.map(point => point.x))
    const spanY = Math.max(...projected.map(point => point.y)) - Math.min(...projected.map(point => point.y))
    if (spanX <= width.value * 0.72 && spanY <= height.value * 0.72) { fittedZoom = candidate; break }
  }
  center.value = { latitude, longitude }
  zoom.value = fittedZoom
}

function recenter() { fitToMarkers(); follow.value = true }
function retryTiles() { tileError.value = false; retryGeneration.value++ }
watch(() => props.tileUrl, () => { tileError.value = false })
watch([() => props.position, () => props.positions, () => props.initialCenter], () => { if (follow.value) fitToMarkers() }, { deep: true, immediate: true })
function start(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button,a')) return
  follow.value = false
  viewport.value?.setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY, center: project(center.value.latitude, center.value.longitude, zoom.value) }
}
function move(event: PointerEvent) { if (drag) center.value = unproject(drag.center.x - event.clientX + drag.x, drag.center.y - event.clientY + drag.y, zoom.value) }
function key(event: KeyboardEvent) {
  const delta: Record<string, [number, number]> = { ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0] }
  if (!delta[event.key]) return
  event.preventDefault(); follow.value = false
  const point = project(center.value.latitude, center.value.longitude, zoom.value)
  center.value = unproject(point.x + delta[event.key][0], point.y + delta[event.key][1], zoom.value)
}
let wheelDelta = 0
let lastWheel = -Infinity
function wheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) return
  event.preventDefault()
  wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height.value : 1)
  if (Math.abs(wheelDelta) < 60 || event.timeStamp - lastWheel < 120) return
  const rect = viewport.value!.getBoundingClientRect()
  const result = zoomAt(center.value, zoom.value, zoom.value + (wheelDelta < 0 ? 1 : -1), event.clientX - rect.left, event.clientY - rect.top, width.value, height.value)
  zoom.value = result.zoom; center.value = result.center; follow.value = false; drag = null
  wheelDelta = 0; lastWheel = event.timeStamp
}
onMounted(() => {
  viewport.value?.addEventListener('wheel', wheel, { passive: false })
  observer = new ResizeObserver(entries => { width.value = entries[0].contentRect.width; height.value = entries[0].contentRect.height || 430 })
  if (viewport.value) observer.observe(viewport.value)
})
onBeforeUnmount(() => { observer?.disconnect(); viewport.value?.removeEventListener('wheel', wheel) })
</script>
<template>
  <div ref="viewport" class="location-map" tabindex="0" role="region" aria-label="Mapa de localização. Use o scroll do mouse para aproximar ou afastar e as setas para mover o mapa." @pointerdown="start" @pointermove="move" @pointerup="drag=null" @pointercancel="drag=null" @keydown="key">
    <img v-for="tile in tiles" :key="`${retryGeneration}:${tile.key}`" :src="tile.src" referrerpolicy="strict-origin" decoding="async" @error="tileError=true" alt="" width="256" height="256" draggable="false" :style="{ left: tile.x+'px', top: tile.y+'px' }" />
    <svg class="map-overlay" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
      <polyline :points="trail" fill="none" stroke="var(--primary)" stroke-width="3" />
      <g v-for="marker in markers" :key="marker.key">
        <title>{{ marker.name || 'Dispositivo' }}</title>
        <circle :cx="marker.x" :cy="marker.y" :r="accuracy(marker.point)" fill="var(--primary)" fill-opacity=".12" stroke="var(--primary)" stroke-opacity=".35" />
        <circle :cx="marker.x" :cy="marker.y" r="8" fill="var(--primary)" stroke="white" stroke-width="3" />
        <text v-if="markers.length <= 20" :x="marker.x + 12" :y="marker.y - 10" class="marker-label">{{ marker.name || 'Dispositivo' }}</text>
      </g>
    </svg>
    <template v-for="marker in markers" :key="`avatar-${marker.key}`">
      <img v-if="marker.avatarData" class="map-device-avatar" :src="marker.avatarData" :alt="marker.name || 'Dispositivo'" draggable="false" width="36" height="36" :style="{ left: marker.x+'px', top: marker.y+'px' }" />
    </template>
    <div v-if="!hasPosition" class="map-empty" role="status"><strong>Nenhuma posição recebida</strong><span>O mapa está pronto. Solicite uma localização ou aguarde o próximo relatório.</span></div>
    <div class="map-controls"><button class="btn ghost" aria-label="Aproximar mapa" :disabled="zoom>=19" @click.stop="zoom=Math.min(19,zoom+1)">+</button><button class="btn ghost" aria-label="Afastar mapa" :disabled="zoom<=2" @click.stop="zoom=Math.max(2,zoom-1)">−</button><button class="btn ghost" @click.stop="recenter">{{ follow ? (hasPosition ? 'Acompanhando' : 'Mapa mundial') : 'Centralizar' }}</button></div>
    <div v-if="tileError" class="map-tile-error" role="alert"><strong>O provedor não carregou o mapa.</strong><span>Verifique o acesso ao provedor ou configure FINDHUB_MAP_TILE_URL. Nenhuma restrição é contornada automaticamente.</span><button class="btn ghost" @click.stop="retryTiles">Tentar novamente</button></div>
    <small class="attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></small>
  </div>
</template>
<style scoped>
.location-map{height:430px;position:relative;overflow:hidden;background:var(--background,#edf2f7);border:1px solid var(--border);border-radius:14px;touch-action:none;cursor:grab}.location-map:active{cursor:grabbing}.location-map:focus-visible{outline:2px solid var(--primary)}.location-map>img{position:absolute;max-width:none;user-select:none}.map-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.marker-label{font:600 11px/1.2 system-ui,sans-serif;fill:#0f172a;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}.map-controls{position:absolute;left:12px;top:12px;display:flex;gap:6px}.map-controls button{background:var(--surface)}.map-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;gap:5px;min-width:min(330px,calc(100% - 40px));padding:16px 18px;text-align:center;color:var(--muted);background:color-mix(in srgb,var(--surface) 90%,transparent);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);pointer-events:none}.map-empty strong{color:var(--text);font-size:13px}.map-empty span{font-size:12px}.attribution{position:absolute;bottom:0;right:0;background:var(--surface);padding:4px 8px;font-size:10px}
.map-tile-error{position:absolute;left:16px;right:16px;bottom:32px;display:grid;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;box-shadow:var(--shadow);font-size:12px}.map-tile-error button{justify-self:start}.map-tile-error span{color:var(--muted)}
.map-device-avatar{position:absolute;width:36px;height:36px;border-radius:50%;border:3px solid white;object-fit:cover;transform:translate(-50%,-50%);pointer-events:none;box-shadow:0 2px 8px #0003}
</style>
