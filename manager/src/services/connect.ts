import { runtime } from '@/config/runtime'
import { current } from './current'
import { connect as service } from './service'

const adapter: any = runtime.compatibility === 'service' ? service : current

export const connect = {
  status: (...args: any[]) => adapter.status(...args),
  setup: (...args: any[]) => adapter.setup(...args),
  login: (...args: any[]) => adapter.login(...args),
  loginAccess: (...args: any[]) => runtime.compatibility === 'current'
    ? current.loginAccess(...args)
    : Promise.reject(new Error('Modo de acesso indisponível.')),
  verify: (...args: any[]) => adapter.verify(...args),
  me: (...args: any[]) => adapter.me(...args),
  logout: (...args: any[]) => adapter.logout(...args),
  security: (...args: any[]) => adapter.security(...args),
  beginTwoStep: (...args: any[]) => adapter.beginTwoStep(...args),
  confirmTwoStep: (...args: any[]) => adapter.confirmTwoStep(...args),
  regenerateRecovery: (...args: any[]) => adapter.regenerateRecovery(...args),
  changePassword: (...args: any[]) => adapter.changePassword(...args),
  overview: (...args: any[]) => adapter.overview(...args),
  connections: (...args: any[]) => adapter.connections(...args),
  connection: (...args: any[]) => adapter.connection(...args),
  createConnection: (...args: any[]) => adapter.createConnection(...args),
  connectConnection: (...args: any[]) => adapter.connectConnection(...args),
  restartConnection: (...args: any[]) => adapter.restartConnection(...args),
  disconnectConnection: (...args: any[]) => adapter.disconnectConnection(...args),
  removeConnection: (...args: any[]) => adapter.removeConnection(...args),
  conversations: (...args: any[]) => adapter.conversations(...args),
  messages: (...args: any[]) => adapter.messages(...args),
  sendText: (...args: any[]) => adapter.sendText(...args),
  contacts: (...args: any[]) => adapter.contacts ? adapter.contacts(...args) : Promise.resolve([]),
  calls: (...args: any[]) => adapter.calls(...args),
  callAction: (...args: any[]) => adapter.callAction(...args),
  users: (...args: any[]) => adapter.users(...args),
  roles: (...args: any[]) => adapter.roles(...args),
  createUser: (...args: any[]) => adapter.createUser(...args),
  updateUser: (...args: any[]) => adapter.updateUser(...args),
  removeUser: (...args: any[]) => adapter.removeUser(...args),
  audit: (...args: any[]) => adapter.audit(...args),
  health: (...args: any[]) => adapter.health(...args),
  updates: (...args: any[]) => adapter.updates(...args),
}
