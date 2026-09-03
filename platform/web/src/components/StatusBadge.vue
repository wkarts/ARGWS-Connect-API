<script setup lang="ts">
import { computed } from 'vue'
import { statusLabel } from '../utils/labels'

const props = defineProps<{ status: string }>()

const normalized = computed(() => String(props.status || 'UNKNOWN').trim().toUpperCase())
const label = computed(() => statusLabel(normalized.value))

const classes = computed(() => {
  const value = normalized.value
  if (['ACTIVE','PAID','SUCCEEDED','REGISTERED','SENT','DELIVERED','READ','PROCESSED','CONFIRMED','HEALTHY','ENABLED','MATCHED','APPROVED'].includes(value)) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (['PENDING','PROVISIONING','RUNNING','STARTING','VERIFYING','WAITING_SSL','OPEN','PARTIALLY_PAID','CONNECTING','PAIRING','RECONNECTING','RETRY','WARNING','NEGOTIATED','SUGGESTED','DRAFT','QUEUED'].includes(value)) {
    return 'bg-amber-100 text-amber-700'
  }
  if (['FAILED','ERROR','CRITICAL','OVERDUE','BLOCKED','BLOCKED_EXTERNAL','PROVISIONING_FAILED','UNAVAILABLE','UNHEALTHY','REJECTED'].includes(value)) {
    return 'bg-rose-100 text-rose-700'
  }
  if (['SUSPENDED','CANCELLED','CANCELED','ARCHIVED','CLOSED','CLOSE','STOPPED','EXITED','DISCONNECTED','NOT_CREATED','NOT_CONFIGURED','INACTIVE','DISABLED','NOT_REQUIRED','REVERSED','EXPIRED','WRITTEN_OFF'].includes(value)) {
    return 'bg-slate-200 text-slate-700'
  }
  return 'bg-blue-100 text-blue-700'
})
</script>

<template><span class="badge" :class="classes">{{ label }}</span></template>
