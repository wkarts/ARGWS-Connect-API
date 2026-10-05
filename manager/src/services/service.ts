import { request, setCsrf, clearCsrf } from './http'
import * as normalize from './normalizers'
import type { AuditItem, ConnectionItem, Conversation, ManagerEmbeddingSettings, ManagerStorageOverview, Message, Overview, Session, TranscriptionJob, UserItem } from '@/types/domain'

function statusForm(data: any, file?: File) {
  const form = new FormData()
  for (const key of ['type', 'content', 'caption', 'backgroundColor', 'font']) {
    const value = data?.[key]
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
  }
  if (data?.allContacts !== undefined) form.append('allContacts', String(Boolean(data.allContacts)))
  if (Array.isArray(data?.statusJidList) && data.statusJidList.length) {
    form.append('statusJidList', JSON.stringify(data.statusJidList))
  }
  if (file) form.append('file', file, file.name)
  return form
}

export const connect = {
  async status() { return request<any>('/status') },
  async setup(data: { name: string; email: string; password: string }, setupToken: string) {
    return request<any>('/setup', { method: 'POST', data, headers: { 'x-setup-token': setupToken } })
  },
  async login(email: string, password: string) {
    const raw = await request<any>('/auth/login', { method: 'POST', data: { email, password } })
    if (raw?.mfaRequired) return { challenge: true, raw }
    const value = normalize.session(raw); setCsrf(value.csrf); return { challenge: false, session: value }
  },
  async verify(code = '', recoveryCode = ''): Promise<Session> {
    const raw = await request<any>('/auth/2fa/verify', { method: 'POST', data: recoveryCode ? { recoveryCode } : { code } })
    const value = normalize.session(raw); setCsrf(value.csrf); return value
  },
  async me(): Promise<Session> {
    const value = normalize.session(await request<any>('/auth/me')); setCsrf(value.csrf); return value
  },
  async logout() { try { return await request('/auth/logout', { method: 'POST' }) } finally { clearCsrf() } },
  async embeddingSettings(): Promise<ManagerEmbeddingSettings> { return request<ManagerEmbeddingSettings>('/embedding') },
  async saveEmbeddingSettings(data: { version: number; enabled: boolean; allowedOrigins: string[] }): Promise<ManagerEmbeddingSettings> { return request<ManagerEmbeddingSettings>('/embedding', { method: 'PUT', data }) },
  async security() { return normalize.security((await request<any>('/auth/security'))?.security) },
  async beginTwoStep(password: string) { return request<any>('/auth/2fa/setup', { method: 'POST', data: { password } }) },
  async confirmTwoStep(code: string) { const raw = await request<any>('/auth/2fa/confirm', { method: 'POST', data: { code } }); const value = normalize.session(raw); setCsrf(value.csrf); return { session: value, recoveryCodes: raw?.recoveryCodes || [] } },
  async regenerateRecovery(password: string) { return request<any>('/auth/2fa/recovery/regenerate', { method: 'POST', data: { password } }) },
  async changePassword(currentPassword: string, newPassword: string) { return request('/auth/password/change', { method: 'POST', data: { currentPassword, newPassword } }) },
  async overview(): Promise<Overview> { return normalize.overview(await request<any>('/dashboard')) },
  async connections(): Promise<ConnectionItem[]> { return normalize.connections(await request<any>('/instances')) },
  async connection(id: string) { return request<any>(`/instances/${encodeURIComponent(id)}`) },
  async createConnection(data: any) { return request('/instances', { method: 'POST', data }) },
  async connectConnection(id: string, data: any = {}) { return request(`/instances/${encodeURIComponent(id)}/connect`, { method: 'POST', data }) },
  async restartConnection(id: string) { return request(`/instances/${encodeURIComponent(id)}/restart`, { method: 'POST' }) },
  async disconnectConnection(id: string) { return request(`/instances/${encodeURIComponent(id)}/logout`, { method: 'POST' }) },
  async removeConnection(id: string) { return request(`/instances/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  async conversations(id: string): Promise<Conversation[]> { return normalize.conversations(await request<any>(`/instances/${encodeURIComponent(id)}/chats`)) },
  async messages(id: string, ref: string): Promise<Message[]> { return normalize.messages(await request<any>(`/instances/${encodeURIComponent(id)}/messages`, { params: { remoteJid: ref } })) },
  async sendText(id: string, number: string, text: string) { return request(`/instances/${encodeURIComponent(id)}/messages/text`, { method: 'POST', data: { number, text } }) },
  async sendStatus(id: string, data: any, file?: File) { return request(`/instances/${encodeURIComponent(id)}/status`, { method: 'POST', data: statusForm(data, file), timeout: 180000 }) },
  async statuses(id: string): Promise<Message[]> { return request<Message[]>(`/instances/${encodeURIComponent(id)}/statuses`) },
  async statusViews(id: string, statusId: string) { return request<{ id: string; count: number; viewers: Array<{ participant: string; status: string }> }>(`/instances/${encodeURIComponent(id)}/statuses/${encodeURIComponent(statusId)}/views`) },
  async deleteStatus(id: string, statusId: string) { return request(`/instances/${encodeURIComponent(id)}/statuses/${encodeURIComponent(statusId)}`, { method: 'DELETE' }) },
  async statusMedia(_id: string, _statusId: string): Promise<{ base64: string; mimetype: string }> {
    throw new Error('Prévia de mídia indisponível neste modo de conexão.')
  },
  async calls(id: string) { return request<any>(`/instances/${encodeURIComponent(id)}/calls`) },
  async callAction(id: string, action: string, data: any = {}) { return request(`/instances/${encodeURIComponent(id)}/calls/${encodeURIComponent(action)}`, { method: 'POST', data }) },
  async users(): Promise<UserItem[]> { return normalize.users(await request<any>('/users')) },
  async roles() { return request<any>('/roles') },
  async createUser(data: any) { return request('/users', { method: 'POST', data }) },
  async updateUser(id: string, data: any) { return request(`/users/${encodeURIComponent(id)}`, { method: 'PUT', data }) },
  async removeUser(id: string) { return request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  async audit(): Promise<AuditItem[]> { return normalize.audit(await request<any>('/audit', { params: { limit: 200 } })) },
  async health() { return request<any>('/system/health') },
  async updates() { return request<any>('/updates') },
  async storageOverview(instanceId?: string): Promise<ManagerStorageOverview> { return request<ManagerStorageOverview>('/storage/overview', { params: instanceId ? { instanceId } : undefined }) },
  async storageCleanupPreview(data: any) { return request<any>('/storage/cleanup/preview', { method: 'POST', data }) },
  async storageCleanup(data: any) { return request<any>('/storage/cleanup', { method: 'POST', data }) },
  async transcriptionList(limit = 100): Promise<TranscriptionJob[]> { return request<TranscriptionJob[]>('/transcriptions', { params: { limit } }) },
  async transcriptionHealth(): Promise<any> { return request<any>('/transcriptions/health') },
  async downloadSpeechModel(modelId: string): Promise<any> { return request<any>(`/speech/models/${encodeURIComponent(modelId)}/download`, { method: 'POST', timeout: 60000 }) },
  async uploadTranscription(file: File, language = ''): Promise<TranscriptionJob> {
    const data = new FormData()
    data.append('audio', file, file.name)
    if (language) data.append('language', language)
    return request<TranscriptionJob>('/transcriptions/upload', { method: 'POST', data, timeout: 180000 })
  },
  async transcription(jobId: string): Promise<TranscriptionJob> { return request<TranscriptionJob>(`/transcriptions/${encodeURIComponent(jobId)}`) },
  async retryTranscription(jobId: string): Promise<TranscriptionJob> { return request<TranscriptionJob>(`/transcriptions/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }) },
  async deleteTranscription(jobId: string): Promise<{ id: string; deleted: boolean; sourceRemoved?: boolean; sourceRetained?: boolean }> { return request<{ id: string; deleted: boolean; sourceRemoved?: boolean; sourceRetained?: boolean }>(`/transcriptions/${encodeURIComponent(jobId)}`, { method: 'DELETE' }) },
  async dictate(file: File, input: { language: string; instanceId?: string; durationMs: number; idempotencyKey: string }): Promise<any> {
    const data = new FormData()
    data.append('audio', file, file.name)
    data.append('language', input.language)
    data.append('durationMs', String(input.durationMs))
    data.append('idempotencyKey', input.idempotencyKey)
    if (input.instanceId) data.append('instanceId', input.instanceId)
    return request('/speech/dictation', { method: 'POST', data, timeout: 60000 })
  },
  async dictationJob(jobId: string): Promise<TranscriptionJob> { return request<TranscriptionJob>(`/speech/dictation/${encodeURIComponent(jobId)}`) },
  async cancelDictation(jobId: string): Promise<TranscriptionJob> { return request<TranscriptionJob>(`/speech/dictation/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }) },
  async speechHealth(): Promise<any> { return request<any>('/speech/health') },
  async transcribeMessage(messageId: string, instanceId: string, language = 'pt-BR', idempotencyKey = crypto.randomUUID()): Promise<TranscriptionJob> {
    return request<TranscriptionJob>('/speech/transcriptions', { method: 'POST', data: { messageId, instanceId, language, idempotencyKey }, timeout: 60000 })
  },
  async speechJob(jobId: string): Promise<TranscriptionJob> { return request<TranscriptionJob>(`/speech/transcriptions/${encodeURIComponent(jobId)}`) },
}
