import { runtime } from '@/config/runtime'
import { getCurrentAccessCode } from './current'

class InstanceTokenError extends Error {}

// The native adapter is used by both the embedded and standalone Manager.
// Do not invent a credential endpoint for the optional account/service adapter.
export function instanceTokenSupported(): boolean {
  return runtime.compatibility === 'current'
}

export async function readInstanceToken(instanceId: string, signal?: AbortSignal): Promise<string> {
  if (!instanceTokenSupported()) throw new InstanceTokenError('Consulta de token indisponível nesta instalação.')
  const credential = getCurrentAccessCode()
  if (!credential) throw new InstanceTokenError('Sua sessão expirou. Entre novamente.')
  if (!instanceId.trim()) throw new InstanceTokenError('Instância não informada.')

  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, Math.min(runtime.requestTimeoutMs || 30000, 30000))
  try {
    const url = new URL(`${runtime.apiBaseUrl}/instance/fetchInstances`)
    url.searchParams.set('instanceId', instanceId)
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { apikey: credential },
      signal: controller.signal,
    })
    if (response.status === 401) throw new InstanceTokenError('Sua sessão expirou. Entre novamente.')
    if (response.status === 403) throw new InstanceTokenError('Você não tem permissão para consultar este token.')
    if (response.status === 404) throw new InstanceTokenError('Instância não encontrada.')
    if (!response.ok) throw new InstanceTokenError('Não foi possível consultar o token. Tente novamente.')
    const payload: unknown = await response.json()
    if (controller.signal.aborted || getCurrentAccessCode() !== credential) {
      throw new InstanceTokenError('Consulta cancelada. Entre novamente ou tente outra vez.')
    }
    const items = Array.isArray(payload) ? payload : [payload]
    const item = items.find(value => value && typeof value === 'object' && String(value.id || value.instanceId || '') === instanceId)
    // Never fall back to the login credential, provider key, hash or another instance.
    if (typeof item?.token !== 'string' || !item.token.trim()) {
      throw new InstanceTokenError('O token desta instância não foi disponibilizado pela API.')
    }
    return item.token
  } catch (error) {
    if (error instanceof InstanceTokenError) throw error
    // Upstream bodies/parse errors can contain secrets: never echo them in the UI.
    throw new InstanceTokenError(controller.signal.aborted
      ? 'Consulta do token cancelada ou tempo de espera excedido.'
      : 'Não foi possível consultar o token. Tente novamente.')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

export async function copyInstanceToken(text: string): Promise<void> {
  if (!text.trim()) throw new InstanceTokenError('Nenhum token disponível para copiar.')
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return }
    catch { /* Use the compatibility path only when the modern API is unavailable/denied. */ }
  }

  const previous = document.activeElement as HTMLElement | null
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const inputSelection = previous instanceof HTMLInputElement || previous instanceof HTMLTextAreaElement
    ? { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection }
    : null
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.tabIndex = -1
  field.setAttribute('aria-label', 'Cópia temporária do token')
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px;pointer-events:none'
  try {
    document.body.appendChild(field)
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, field.value.length)
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) throw new Error('copy denied')
  } catch {
    throw new InstanceTokenError('Cópia bloqueada pelo navegador. Use Mostrar token e copie o texto manualmente.')
  } finally {
    field.value = ''
    field.remove()
    previous?.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      ranges.forEach(range => selection.addRange(range))
    }
    if (inputSelection && (previous instanceof HTMLInputElement || previous instanceof HTMLTextAreaElement)) {
      if (inputSelection.start !== null && inputSelection.end !== null) {
        previous.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction || undefined)
      }
    }
  }
}
