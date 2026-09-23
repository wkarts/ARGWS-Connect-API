<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { project, unproject } from '@/services/findhub-map'
const props = defineProps<{ position?: any; trail?: any[]; tileUrl?: string }>()
const viewport = ref<HTMLElement>(), width = ref(800), height = 430, zoom = ref(15), follow = ref(true)
const center = ref({ latitude: 0, longitude: 0 })
let observer: ResizeObserver | undefined, drag: { x: number; y: number; center: { x: number; y: number } } | null = null
const world = computed(() => 256 * 2 ** zoom.value)
const origin = computed(() => { const p = project(center.value.latitude, center.value.longitude, zoom.value); return { x: p.x - width.value / 2, y: p.y - height / 2 } })
const locate = (p: any) => { const point = project(p.latitude, p.longitude, zoom.value); let x = point.x - origin.value.x; x -= Math.round((x - width.value / 2) / world.value) * world.value; return { x, y: point.y - origin.value.y } }
const marker = computed(() => props.position ? locate(props.position) : null)
const trail = computed(() => (props.trail || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).slice(-500).map(p => { const s = locate(p); return `${s.x},${s.y}` }).join(' '))
const accuracy = computed(() => Math.min(2000, Math.max(0, (props.position?.accuracy || 0) / (156543.03392 * Math.cos(center.value.latitude * Math.PI / 180) / 2 ** zoom.value))))
const tiles = computed(() => {
  if (!props.position) return []
  const out: { key: string; src: string; x: number; y: number }[] = [], n = 2 ** zoom.value
  const template = props.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  if (!template.startsWith('https://')) return out
  for (let x = Math.floor(origin.value.x / 256); x <= Math.floor((origin.value.x + width.value) / 256); x++) {
    for (let y = Math.floor(origin.value.y / 256); y <= Math.floor((origin.value.y + height) / 256); y++) {
      if (y < 0 || y >= n) continue
      out.push({ key: `${zoom.value}/${x}/${y}`, src: template.replace('{z}', String(zoom.value)).replace('{x}', String((x % n + n) % n)).replace('{y}', String(y)), x: x * 256 - origin.value.x, y: y * 256 - origin.value.y })
    }
  }
  return out
})
function recenter() { if (props.position) center.value = { latitude: props.position.latitude, longitude: props.position.longitude }; follow.value = true }
watch(() => props.position, () => { if (follow.value) recenter() }, { immediate: true })
function start(event: PointerEvent) { if ((event.target as HTMLElement).closest('button,a')) return; follow.value = false; viewport.value?.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, center: project(center.value.latitude, center.value.longitude, zoom.value) } }
function move(event: PointerEvent) { if (drag) center.value = unproject(drag.center.x - event.clientX + drag.x, drag.center.y - event.clientY + drag.y, zoom.value) }
function key(event: KeyboardEvent) { const delta: Record<string, [number,number]> = { ArrowUp:[0,-80],ArrowDown:[0,80],ArrowLeft:[-80,0],ArrowRight:[80,0] }; if (!delta[event.key]) return; event.preventDefault(); follow.value = false; const c = project(center.value.latitude,center.value.longitude,zoom.value); center.value = unproject(c.x+delta[event.key][0],c.y+delta[event.key][1],zoom.value) }
onMounted(() => { observer = new ResizeObserver(entries => { width.value = entries[0].contentRect.width }); if (viewport.value) observer.observe(viewport.value) })
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <div ref="viewport" class="location-map" tabindex="0" role="region" aria-label="Mapa de localização. Use as setas para mover o mapa." @pointerdown="start" @pointermove="move" @pointerup="drag=null" @pointercancel="drag=null" @keydown="key">
    <template v-if="position">
      <img v-for="tile in tiles" :key="tile.key" :src="tile.src" alt="" width="256" height="256" draggable="false" :style="{ left: tile.x+'px', top: tile.y+'px' }" />
      <svg class="map-overlay" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true"><polyline :points="trail" fill="none" stroke="var(--primary)" stroke-width="3"/><g v-if="marker"><circle :cx="marker.x" :cy="marker.y" :r="accuracy" fill="var(--primary)" fill-opacity=".12" stroke="var(--primary)" stroke-opacity=".35"/><circle :cx="marker.x" :cy="marker.y" r="8" fill="var(--primary)" stroke="white" stroke-width="3"/></g></svg>
    </template>
    <div v-else class="map-empty">Nenhuma posição disponível. Selecione um dispositivo e solicite a localização.</div>
    <div class="map-controls"><button class="btn ghost" aria-label="Aproximar mapa" :disabled="zoom>=19" @click.stop="zoom=Math.min(19,zoom+1)">+</button><button class="btn ghost" aria-label="Afastar mapa" :disabled="zoom<=2" @click.stop="zoom=Math.max(2,zoom-1)">−</button><button class="btn ghost" :disabled="!position" @click.stop="recenter">{{ follow ? 'Acompanhando' : 'Centralizar' }}</button></div>
    <small class="attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></small>
  </div>
</template>
<style scoped>
.location-map{height:430px;position:relative;overflow:hidden;background:var(--background,#edf2f7);border:1px solid var(--border);border-radius:14px;touch-action:none;cursor:grab}.location-map:active{cursor:grabbing}.location-map:focus-visible{outline:2px solid var(--primary)}.location-map>img{position:absolute;max-width:none;user-select:none}.map-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.map-controls{position:absolute;left:12px;top:12px;display:flex;gap:6px}.map-controls button{background:var(--surface)}.map-empty{display:flex;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center;color:var(--muted)}.attribution{position:absolute;bottom:0;right:0;background:var(--surface);padding:4px 8px;font-size:10px}
</style>
