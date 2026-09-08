import { createRouter, createWebHistory } from 'vue-router'
import { appBasePath, featureEnabled, runtime } from '@/config/runtime'
import { useSessionStore } from '@/stores/session'

const routes = [
  { path: '/login', component: () => import('@/views/auth/LoginView.vue'), meta: { public: true } },
  { path: '/primeiro-acesso', component: () => import('@/views/auth/SetupView.vue'), meta: { public: true, feature: 'users' } },
  { path: '/confirmacao', component: () => import('@/views/auth/VerifyView.vue'), meta: { public: true, feature: 'security' } },
  { path: '/', component: () => import('@/views/DashboardView.vue') },
  { path: '/instancias', component: () => import('@/views/InstancesView.vue'), meta: { permission: 'instances.read' } },
  { path: '/instancias/:id', component: () => import('@/views/InstanceView.vue'), meta: { permission: 'instances.read' } },
  { path: '/canais', component: () => import('@/views/ChannelsView.vue'), meta: { permission: 'instances.read' } },
  { path: '/conversas', component: () => import('@/views/ConversationsView.vue'), meta: { permission: 'messages.read' } },
  { path: '/mensagens', component: () => import('@/views/MessagesView.vue'), meta: { permission: 'messages.read', feature: 'messages' } },
  { path: '/contatos', component: () => import('@/views/ContactsView.vue'), meta: { permission: 'messages.read', feature: 'contacts' } },
  { path: '/chamadas', component: () => import('@/views/VoiceView.vue'), meta: { permission: 'pbx.read', feature: 'voice' } },
  { path: '/ramais', component: () => import('@/views/VoiceExtensionsView.vue'), meta: { permission: 'pbx.read', feature: 'voice' } },
  { path: '/filas', component: () => import('@/views/VoiceQueuesView.vue'), meta: { permission: 'pbx.read', feature: 'voice' } },
  { path: '/fluxos', component: () => import('@/views/FlowsView.vue'), meta: { permission: 'studio.read', feature: 'studio' } },
  { path: '/automacoes', component: () => import('@/views/AutomationsView.vue'), meta: { permission: 'studio.read', feature: 'studio' } },
  { path: '/usuarios', component: () => import('@/views/UsersView.vue'), meta: { permission: 'users.read', feature: 'users' } },
  { path: '/permissoes', component: () => import('@/views/PermissionsView.vue'), meta: { permission: 'users.read', feature: 'permissions' } },
  { path: '/auditoria', component: () => import('@/views/AuditView.vue'), meta: { permission: 'audit.read', feature: 'audit' } },
  { path: '/seguranca', component: () => import('@/views/SecurityView.vue'), meta: { feature: 'security' } },
  { path: '/saude', component: () => import('@/views/HealthView.vue') },
  { path: '/atualizacoes', component: () => import('@/views/UpdatesView.vue'), meta: { feature: 'updates' } },
  { path: '/configuracoes', component: () => import('@/views/SettingsView.vue'), meta: { feature: 'settings' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({ history: createWebHistory(appBasePath()), routes })
router.beforeEach(async (to) => {
  const session = useSessionStore()
  const feature = to.meta.feature as string | undefined
  if (feature && !featureEnabled(feature, false)) return '/'

  if (to.meta.public) {
    if (runtime.authMode === 'access-code' && ['/primeiro-acesso', '/confirmacao'].includes(to.path)) return '/login'
    if (to.path === '/confirmacao') return true
    const ok = await session.restore()
    if (ok) return '/'
    return true
  }

  const ok = await session.restore()
  if (!ok) return '/login'
  if (session.security?.enrollmentRequired && featureEnabled('security', false) && to.path !== '/seguranca') return '/seguranca'
  const permission = to.meta.permission as string | undefined
  if (permission && !session.hasPermission(permission)) return '/'
  return true
})
export default router
