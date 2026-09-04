import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppLayout from '../layouts/AppLayout.vue'
import LoginPage from '../pages/LoginPage.vue'
import ForgotPasswordPage from '../pages/ForgotPasswordPage.vue'
import ResetPasswordPage from '../pages/ResetPasswordPage.vue'
import TwoFactorPage from '../pages/TwoFactorPage.vue'
import NotFoundPage from '../pages/NotFoundPage.vue'
import PlaneDashboardPage from '../pages/PlaneDashboardPage.vue'
import TenantLandingPage from '../pages/TenantLandingPage.vue'
import PartnerWorkspacePage from '../pages/partner/PartnerWorkspacePage.vue'

// Control Plane
import TenantsPage from '../pages/TenantsPage.vue'
import PartnersPage from '../pages/PartnersPage.vue'
import TenantDetailPage from '../pages/TenantDetailPage.vue'
import PlansPage from '../pages/PlansPage.vue'
import PlatformUsersPage from '../pages/PlatformUsersPage.vue'
import DomainsPage from '../pages/DomainsPage.vue'
import ProvisioningPage from '../pages/ProvisioningPage.vue'
import BackupsPage from '../pages/BackupsPage.vue'
import PlatformHealthPage from '../pages/PlatformHealthPage.vue'
import PlatformAccessPage from '../pages/PlatformAccessPage.vue'
import PlatformWhatsAppPage from '../pages/PlatformWhatsAppPage.vue'
import ObservabilityPage from '../pages/ObservabilityPage.vue'
import ControlAuditPage from '../pages/ControlAuditPage.vue'
import ControlSettingsPage from '../pages/ControlSettingsPage.vue'
import ControlLandingBuilderPage from '../pages/ControlLandingBuilderPage.vue'
import ControlResourcesPage from '../pages/ControlResourcesPage.vue'

// Tenant Plane — Connect|API
import ConnectChannelsPage from '../pages/ConnectChannelsPage.vue'
import ConnectInstancesPage from '../pages/ConnectInstancesPage.vue'
import ConnectMessagesPage from '../pages/ConnectMessagesPage.vue'
import ConnectTemplatesPage from '../pages/ConnectTemplatesPage.vue'
import ConnectIntegrationsPage from '../pages/ConnectIntegrationsPage.vue'
import ConnectMicroAppsPage from '../pages/ConnectMicroAppsPage.vue'
import ConnectEventsPage from '../pages/ConnectEventsPage.vue'
import ConnectAutomationsPage from '../pages/ConnectAutomationsPage.vue'
import ConnectPbxPage from '../pages/ConnectPbxPage.vue'
import ConnectVoipPage from '../pages/ConnectVoipPage.vue'
import RolesPage from '../pages/RolesPage.vue'
import UsersPage from '../pages/UsersPage.vue'
import AuditPage from '../pages/AuditPage.vue'

const controlMeta = { plane: 'control' as const }
const tenantMeta = { plane: 'tenant' as const }
const partnerMeta = { plane: 'partner' as const }

const controlRoutes: RouteRecordRaw[] = [
  { path: 'tenants', name: 'tenants', component: TenantsPage, meta: controlMeta },
  { path: 'partners', name: 'partners', component: PartnersPage, meta: controlMeta },
  { path: 'tenants/:id', name: 'tenant-detail', component: TenantDetailPage, meta: controlMeta },
  { path: 'plans', name: 'plans', component: PlansPage, meta: controlMeta },
  { path: 'platform-users', name: 'platform-users', component: PlatformUsersPage, meta: controlMeta },
  { path: 'domains', name: 'domains', component: DomainsPage, meta: controlMeta },
  { path: 'provisioning', name: 'provisioning', component: ProvisioningPage, meta: controlMeta },
  { path: 'backups', name: 'backups', component: BackupsPage, meta: controlMeta },
  { path: 'platform-health', name: 'platform-health', component: PlatformHealthPage, meta: controlMeta },
  { path: 'resources', name: 'platform-resources', component: ControlResourcesPage, meta: controlMeta },
  { path: 'platform-whatsapp', name: 'platform-whatsapp', component: PlatformWhatsAppPage, meta: controlMeta },
  { path: 'observability', name: 'observability', component: ObservabilityPage, meta: controlMeta },
  { path: 'landing-builder', name: 'landing-builder', component: ControlLandingBuilderPage, meta: controlMeta },
  { path: 'platform-access', name: 'platform-access', component: PlatformAccessPage, meta: controlMeta },
  { path: 'control-audit', name: 'control-audit', component: ControlAuditPage, meta: controlMeta },
  { path: 'control-settings', name: 'control-settings', component: ControlSettingsPage, meta: controlMeta },
  { path: 'support', redirect: '/platform-access' },
  { path: 'platform-api-keys', redirect: '/platform-access' }
]

const partnerRoutes: RouteRecordRaw[] = [
  { path: 'partner-tenants', name: 'partner-tenants', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-plans', name: 'partner-plans', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-domains', name: 'partner-domains', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-usage', name: 'partner-usage', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-api', name: 'partner-api', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-branding', name: 'partner-branding', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-support', name: 'partner-support', component: PartnerWorkspacePage, meta: partnerMeta },
  { path: 'partner-settings', name: 'partner-settings', component: PartnerWorkspacePage, meta: partnerMeta },
]

const tenantRoutes: RouteRecordRaw[] = [
  { path: 'channels', name: 'channels', component: ConnectChannelsPage, meta: tenantMeta },
  { path: 'instances', name: 'instances', component: ConnectInstancesPage, meta: tenantMeta },
  { path: 'messages', name: 'messages', component: ConnectMessagesPage, meta: tenantMeta },
  { path: 'templates', name: 'templates', component: ConnectTemplatesPage, meta: tenantMeta },
  { path: 'integrations', name: 'integrations', component: ConnectIntegrationsPage, meta: tenantMeta },
  { path: 'micro-apps', name: 'micro-apps', component: ConnectMicroAppsPage, meta: tenantMeta },
  { path: 'events', name: 'events', component: ConnectEventsPage, meta: tenantMeta },
  { path: 'automations', name: 'automations', component: ConnectAutomationsPage, meta: tenantMeta },
  { path: 'pbx', name: 'pbx', component: ConnectPbxPage, meta: tenantMeta },
  { path: 'voip', name: 'voip', component: ConnectVoipPage, meta: tenantMeta },
  { path: 'roles', name: 'roles', component: RolesPage, meta: tenantMeta },
  { path: 'users', name: 'users', component: UsersPage, meta: tenantMeta },
  { path: 'audit', name: 'audit', component: AuditPage, meta: tenantMeta }
]

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
  { path: '/forgot-password', name: 'forgot-password', component: ForgotPasswordPage, meta: { public: true } },
  { path: '/reset-password', name: 'reset-password', component: ResetPasswordPage, meta: { public: true } },
  { path: '/security/2fa', name: 'two-factor', component: TwoFactorPage, meta: { mfa: true } },
  { path: '/welcome', name: 'tenant-landing', component: TenantLandingPage, meta: { public: true } },
  { path: '/', component: AppLayout, children: [
    { path: '', name: 'home', component: PlaneDashboardPage },
    ...controlRoutes,
    ...partnerRoutes,
    ...tenantRoutes
  ] },
  { path: '/:pathMatch(.*)*', component: NotFoundPage, meta: { public: true } }
]

const router = createRouter({ history: createWebHistory(), routes })
router.beforeEach(to => {
  const auth = useAuthStore()
  if (!auth.session) auth.hydrate()
  if (!to.meta.public && !auth.authenticated) {
    if (to.name === 'home' && auth.isTenantPlane) return { name: 'tenant-landing' }
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (auth.authenticated && auth.mfaPending && to.name !== 'two-factor') return { name: 'two-factor', query: { redirect: to.fullPath } }
  if (to.name === 'two-factor' && (!auth.authenticated || !auth.mfaPending)) return { name: auth.authenticated ? 'home' : 'login' }
  if (to.name === 'tenant-landing' && !auth.isTenantPlane) return { name: 'login' }
  if (to.name === 'tenant-landing' && auth.authenticated) return { name: 'home' }
  if (to.name === 'login' && auth.authenticated) return auth.mfaPending ? { name: 'two-factor' } : { name: 'home' }
  if (to.meta.plane === 'control' && !auth.isControlPlane) return { name: 'home' }
  if (to.meta.plane === 'partner' && !auth.isPartnerPlane) return { name: 'home' }
  if (to.meta.plane === 'tenant' && !auth.isTenantPlane) return { name: 'home' }
  return true
})
export default router
