import { onBeforeUnmount, ref, watch } from 'vue'
import { connect } from './connect'
/** Binary content is fetched only for displayed devices; SSE contains a small revision, never image bytes. */
export function useFindHubAvatar(instanceId: () => string, device: () => any) {
  const avatar = ref<string | null>(null); let generation = 0
  watch(() => [instanceId(), device()?.id, device()?.avatarVersion, device()?.avatarData], async () => {
    const current = ++generation; avatar.value = null
    if (device()?.avatarData) { avatar.value = device().avatarData; return }
    if (!device()?.id || !device()?.avatarVersion) return
    try {
      const value = await connect.findHubAvatar(instanceId(), device().id)
      if (generation === current) avatar.value = value.avatarData || null
    } catch { /* An avatar error never stops the position stream. */ }
  }, { immediate: true })
  onBeforeUnmount(() => { generation++ })
  return avatar
}
