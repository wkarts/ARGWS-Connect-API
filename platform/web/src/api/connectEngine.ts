import { api } from './client'

export interface EngineInstance {
  id: string
  alias: string
  instance_name: string
  provider: string
  status: string
  state?: string | null
  capabilities?: Record<string, unknown>
  last_error?: string | null
  created_at?: string | null
}

export interface DiscoverableEngineInstance {
  instance_name: string
  engine_id?: string | null
  provider: string
  state?: string | null
  number?: string | null
  profile_name?: string | null
  owner_jid?: string | null
  counts: { messages: number; contacts: number; chats: number }
  suggested_alias: string
}

export interface EngineInstanceDiscovery {
  available: DiscoverableEngineInstance[]
  adopted: Array<{ binding_id: string; instance_name: string }>
}

interface Envelope<T> { data: T }

export async function engineStatus() {
  return (await api.get<Envelope<Record<string, unknown>>>('/v1/connect/engine/status')).data.data
}

export async function listEngineInstances(): Promise<EngineInstance[]> {
  return (await api.get<Envelope<EngineInstance[]>>('/v1/connect/instances')).data.data
}

export async function discoverEngineInstances(): Promise<EngineInstanceDiscovery> {
  return (await api.get<Envelope<EngineInstanceDiscovery>>('/v1/connect/instances/discover')).data.data
}

export async function adoptEngineInstance(payload: { instance_name: string; alias?: string }) {
  return (await api.post<Envelope<Record<string, unknown>>>('/v1/connect/instances/adopt', payload)).data.data
}

export async function detachEngineInstance(id: string) {
  return (await api.delete<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/detach`)).data.data
}

export async function createEngineInstance(payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>('/v1/connect/instances', payload)).data.data
}

export async function connectEngineInstance(id: string) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/connect`)).data.data
}

export async function restartEngineInstance(id: string) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/restart`)).data.data
}

export async function deleteEngineInstance(id: string) {
  return (await api.delete<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}`)).data.data
}

export async function engineTemplates(id: string) {
  return (await api.get<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/templates`)).data.data
}

export async function engineTemplateCapabilities(id: string) {
  return (await api.get<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/template-capabilities`)).data.data
}

export async function previewEngineTemplate(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/template-preview`, payload)).data.data
}

export async function sendEngineTemplate(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/send-template`, payload)).data.data
}

export async function sendEngineText(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/send-text`, payload)).data.data
}

export async function engineActions(id: string) {
  return (await api.get<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/actions`)).data.data
}

export async function createEngineAction(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/actions`, payload)).data.data
}

export async function executeEngineAction(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/actions/execute`, payload)).data.data
}

export async function deleteEngineAction(id: string, actionKey: string) {
  return (await api.delete<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/actions`, { data: { actionKey } })).data.data
}

export async function engineRecipes(id: string) {
  return (await api.get<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/recipes`)).data.data
}

export async function createEngineRecipe(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/recipes`, payload)).data.data
}

export async function executeEngineRecipe(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/recipes/execute`, payload)).data.data
}

export async function deleteEngineRecipe(id: string, recipeKey: string) {
  return (await api.delete<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/recipes`, { data: { recipeKey } })).data.data
}

export async function createEngineTemplate(id: string, payload: Record<string, unknown>) {
  return (await api.post<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/templates`, payload)).data.data
}

export async function editEngineTemplate(id: string, payload: Record<string, unknown>) {
  return (await api.put<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/templates`, payload)).data.data
}

export async function deleteEngineTemplate(id: string, payload: Record<string, unknown>) {
  return (await api.delete<Envelope<Record<string, unknown>>>(`/v1/connect/instances/${id}/templates`, { data: payload })).data.data
}
