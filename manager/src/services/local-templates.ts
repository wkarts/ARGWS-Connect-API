import { runtime } from '@/config/runtime'
import { getCurrentAccessCode } from './current'
import { readInstanceToken } from './instance-token'

export interface LocalTemplate {
  id: string
  name: string
  language: string
  components: Array<{ type: 'HEADER' | 'BODY' | 'FOOTER'; text: string; format?: 'TEXT' }>
  enabled: boolean
  available: boolean
  status: 'LOCAL_READY' | 'LOCAL_DISABLED'
  source: 'connectapi_local'
  execution: 'rendered_text'
  version: number
}

async function request(instanceId: string, instanceName: string, action: string, method: string, body?: unknown, after?: string) {
  const session = getCurrentAccessCode()
  const token = await readInstanceToken(instanceId)
  const url = new URL(`${runtime.apiBaseUrl}/localTemplate/${action}/${encodeURIComponent(instanceName)}`)
  if (after) url.searchParams.set('after', after)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), runtime.requestTimeoutMs || 30000)
  try {
    const response = await fetch(url, {
      method, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      headers: { apikey: token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (session !== getCurrentAccessCode()) throw new Error('Sessão alterada. Entre novamente.')
    if (response.status === 401 || response.status === 403) throw new Error('Acesso negado a esta instância. Entre novamente.')
    if (response.status === 404) throw new Error('Recurso não encontrado. Confirme que a API foi atualizada.')
    if (response.status === 409) throw new Error('O modelo já existe, foi alterado ou arquivado. Atualize a lista antes de continuar.')
    const result = await response.json()
    if (!response.ok) {
      const message = response.status === 400 && typeof result?.response?.message === 'string' ? result.response.message : ''
      throw new Error(message || 'Não foi possível concluir a operação com o modelo.')
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

export async function listLocalTemplates(instanceId: string, instanceName: string): Promise<LocalTemplate[]> {
  const result: LocalTemplate[] = []
  const visited = new Set<string>()
  let after: string | undefined
  do {
    const page = await request(instanceId, instanceName, 'find', 'GET', undefined, after)
    if (!Array.isArray(page.data)) throw new Error('Resposta de modelos inválida.')
    result.push(...page.data)
    after = page.paging?.cursors?.after
    if (after && (typeof after !== 'string' || visited.has(after) || visited.size >= 100)) throw new Error('Paginação de modelos inválida.')
    if (after) visited.add(after)
  } while (after)
  return result.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
}

export function saveLocalTemplate(instanceId: string, instanceName: string, payload: unknown, editing: boolean) {
  return request(instanceId, instanceName, editing ? 'edit' : 'create', 'POST', payload)
}

export function archiveLocalTemplate(instanceId: string, instanceName: string, template: LocalTemplate) {
  return request(instanceId, instanceName, 'delete', 'DELETE', { name: template.name, language: template.language, version: template.version })
}
