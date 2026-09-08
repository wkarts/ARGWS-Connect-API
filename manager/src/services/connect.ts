import { runtime } from '@/config/runtime'
import { current } from './current'
import { connect as service } from './service'
import type {
  AuditItem,
  ConnectionItem,
  ContactItem,
  Conversation,
  Message,
  Overview,
  SecurityState,
  Session,
  UserItem,
} from '@/types/domain'

const adapter: Record<string, any> = (runtime.compatibility === 'service' ? service : current) as Record<string, any>

function invoke<T = any>(name: string, ...args: any[]): Promise<T> {
  const fn = adapter[name]
  if (typeof fn !== 'function') {
    return Promise.reject(new Error('Este recurso ainda não está disponível nesta instalação.'))
  }
  return Promise.resolve(fn(...args)) as Promise<T>
}

export const connect = {
  status: (): Promise<any> => invoke('status'),
  setup: (data: any, setupToken?: string): Promise<any> => invoke('setup', data, setupToken),
  login: (email: string, password: string): Promise<any> => invoke('login', email, password),
  loginAccess: (code: string): Promise<Session> => runtime.compatibility === 'current'
    ? current.loginAccess(code)
    : Promise.reject(new Error('Modo de acesso indisponível.')),
  verify: (code = '', recovery = ''): Promise<Session> => invoke('verify', code, recovery),
  me: (): Promise<Session> => invoke('me'),
  logout: (): Promise<any> => invoke('logout'),
  security: (): Promise<SecurityState> => invoke('security'),
  beginTwoStep: (password: string): Promise<any> => invoke('beginTwoStep', password),
  confirmTwoStep: (code: string): Promise<{ session: Session; recoveryCodes: string[] }> => invoke('confirmTwoStep', code),
  regenerateRecovery: (password: string): Promise<any> => invoke('regenerateRecovery', password),
  changePassword: (currentPassword: string, newPassword: string): Promise<any> => invoke('changePassword', currentPassword, newPassword),
  overview: (): Promise<Overview> => invoke('overview'),
  connections: (): Promise<ConnectionItem[]> => invoke('connections'),
  connection: (id: string): Promise<any> => invoke('connection', id),
  createConnection: (data: any): Promise<any> => invoke('createConnection', data),
  connectConnection: (id: string, data: any = {}): Promise<any> => invoke('connectConnection', id, data),
  restartConnection: (id: string): Promise<any> => invoke('restartConnection', id),
  disconnectConnection: (id: string): Promise<any> => invoke('disconnectConnection', id),
  removeConnection: (id: string): Promise<any> => invoke('removeConnection', id),
  conversations: (id: string): Promise<Conversation[]> => invoke('conversations', id),
  messages: (id: string, ref = ''): Promise<Message[]> => invoke('messages', id, ref),
  sendText: (id: string, number: string, text: string): Promise<any> => invoke('sendText', id, number, text),
  contacts: (id: string): Promise<ContactItem[]> => typeof adapter.contacts === 'function' ? invoke('contacts', id) : Promise.resolve([]),
  calls: (id: string): Promise<any> => invoke('calls', id),
  callAction: (id: string, action: string, data: any = {}): Promise<any> => invoke('callAction', id, action, data),
  users: (): Promise<UserItem[]> => invoke('users'),
  roles: (): Promise<any[]> => invoke('roles'),
  createUser: (data: any): Promise<any> => invoke('createUser', data),
  updateUser: (id: string, data: any): Promise<any> => invoke('updateUser', id, data),
  removeUser: (id: string): Promise<any> => invoke('removeUser', id),
  audit: (): Promise<AuditItem[]> => invoke('audit'),
  health: (): Promise<any> => invoke('health'),
  updates: (): Promise<any> => invoke('updates'),
}
