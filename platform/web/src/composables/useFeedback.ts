import { ref } from 'vue'
import { apiError } from '../api/client'

export function useFeedback() {
  const error = ref('')
  const success = ref('')
  const loading = ref(false)

  function clear() {
    error.value = ''
    success.value = ''
  }

  function fail(reason: unknown) {
    error.value = apiError(reason)
  }

  function done(message: string) {
    success.value = message
  }

  return { error, success, loading, clear, fail, done }
}
