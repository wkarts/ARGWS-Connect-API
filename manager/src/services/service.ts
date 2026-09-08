import { request, setCsrf, clearCsrf } from './http'
import * as normalize from './normalizers'
import type { AuditItem, ConnectionItem, Conversation, Message, Overview, Session, UserItem } from '@/types/domain'

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
}
