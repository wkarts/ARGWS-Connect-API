<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { connect } from '@/services/connect'
import { useFindHubAvatar } from '@/services/use-findhub-avatar'
import { friendlyError } from '@/services/errors'
const props = defineProps<{ instanceId: string; device: any }>()
const avatar = useFindHubAvatar(() => props.instanceId, () => props.device)
const emit = defineEmits<{ changed: [] }>()
const busy = ref(false), error = ref(''), picker = ref<HTMLInputElement>()
let disposed = false
onBeforeUnmount(() => { disposed = true })
async function save(avatar: string | null) {
  await connect.findHubAvatar(props.instanceId, props.device.id, avatar)
  if (!disposed) emit('changed')
}
async function remove() {
  busy.value = true; error.value = ''
  try { await save(null) } catch(e) { error.value = friendlyError(e) } finally { busy.value = false }
}
async function selected(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || busy.value) return
  busy.value = true; error.value = ''; let bitmap: ImageBitmap | undefined
  try {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Escolha uma imagem PNG, JPEG ou WebP de até 8 MiB.')
    bitmap = await createImageBitmap(file)
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw new Error('Escolha uma imagem de até 16 megapixels.')
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Não foi possível preparar a imagem.')
    const size = Math.min(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128)
    if (!disposed) await save(canvas.toDataURL('image/png'))
  } catch(e) { if (!disposed) error.value = friendlyError(e) }
  finally { bitmap?.close(); busy.value = false }
}
</script>
<template>
  <div class="device-avatar-editor">
    <img v-if="avatar" :src="avatar" :alt="`Avatar de ${device.name}`" width="44" height="44" />
    <span v-else class="device-avatar-placeholder"><AppIcon name="location" :size="24" /></span>
    <input ref="picker" class="avatar-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Imagem do dispositivo" @change="selected" />
    <button type="button" class="card-link" :disabled="busy" @click="picker?.click()">{{ busy ? 'Salvando…' : 'Alterar avatar' }}</button>
    <button v-if="avatar" type="button" class="card-link" :disabled="busy" @click="remove">Remover</button>
  </div>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
</template>
<style scoped>
.device-avatar-editor{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}.device-avatar-editor img{border-radius:50%;object-fit:cover;border:1px solid var(--border)}.device-avatar-placeholder{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--surface-alt);color:var(--primary)}.avatar-input{display:none}.card-link{border:0;background:transparent;padding:0;font-size:12px}
</style>
