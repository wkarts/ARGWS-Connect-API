const roleLabels: Record<string, string> = {
  TENANT_ADMIN: 'Administrador',
  INTEGRATION_MANAGER: 'Gestor de integrações',
  COMMUNICATION_OPERATOR: 'Operador de comunicação',
  PBX_OPERATOR: 'Operador PBX/VOIP',
  AUDITOR: 'Auditoria',
  VIEWER: 'Consulta',
  PLATFORM_ADMIN: 'Administrador da plataforma',
  PLATFORM_SUPERADMIN: 'Administrador da plataforma',
  PLATFORM_SUPPORT: 'Suporte da plataforma',
  PLATFORM_AUDITOR: 'Auditoria da plataforma',
  PARTNER_ADMIN: 'Administrador do parceiro',
  PARTNER_MANAGER: 'Gestor do parceiro',
  PARTNER_OPERATOR: 'Operador do parceiro',
  PARTNER_AUDITOR: 'Auditoria do parceiro',
}

const permissionLabels: Record<string, string> = {
  'dashboard.read': 'Visualizar dashboard',
  'channels.read': 'Visualizar canais', 'channels.manage': 'Administrar canais',
  'instances.read': 'Visualizar instâncias', 'instances.manage': 'Administrar instâncias',
  'messages.read': 'Visualizar mensagens', 'messages.send': 'Enviar mensagens',
  'templates.read': 'Visualizar templates', 'templates.manage': 'Administrar templates',
  'micro_apps.read': 'Visualizar Micro Apps', 'micro_apps.manage': 'Administrar Micro Apps',
  'events.read': 'Visualizar eventos', 'events.replay': 'Reprocessar eventos',
  'automations.read': 'Visualizar automações', 'automations.manage': 'Administrar automações',
  'integrations.read': 'Visualizar integrações', 'integrations.manage': 'Administrar integrações',
  'webhooks.read': 'Visualizar webhooks', 'webhooks.manage': 'Administrar webhooks',
  'pbx.read': 'Visualizar PBX', 'pbx.manage': 'Administrar PBX',
  'voip.read': 'Visualizar VOIP', 'voip.manage': 'Administrar VOIP',
  'api_keys.read': 'Visualizar chaves de API', 'api_keys.manage': 'Administrar chaves de API',
  'notifications.read': 'Visualizar notificações', 'notifications.manage': 'Administrar notificações',
  'documents.read': 'Visualizar documentos', 'documents.manage': 'Administrar documentos',
  'exports.read': 'Visualizar exportações', 'exports.create': 'Gerar exportações',
  'reports.view': 'Visualizar relatórios',
  'companies.read': 'Visualizar empresas', 'companies.update': 'Editar empresas',
  'users.read': 'Visualizar usuários', 'users.manage': 'Administrar usuários',
  'roles.read': 'Visualizar perfis de acesso', 'roles.manage': 'Administrar perfis de acesso',
  'audit.read': 'Visualizar auditoria',
  '*': 'Acesso administrativo completo',
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', DISABLED: 'Desativado', ENABLED: 'Habilitado',
  PENDING: 'Pendente', VERIFYING: 'Aguardando verificação', PROVISIONING: 'Provisionando',
  PROVISIONING_FAILED: 'Falha no provisionamento', FAILED: 'Falhou', ERROR: 'Erro',
  SUCCEEDED: 'Concluído', RUNNING: 'Em execução', COMPLETED: 'Concluído', PROCESSING: 'Processando',
  WAITING_NAMESERVERS: 'Aguardando servidores DNS', WAITING_SSL: 'Aguardando certificado SSL',
  CONNECTED: 'Conectado', DISCONNECTED: 'Desconectado', CONNECTING: 'Conectando', RECONNECTING: 'Reconectando',
  NOT_CREATED: 'Ainda não criado', NOT_CONFIGURED: 'Não configurado', UNAVAILABLE: 'Indisponível',
  HEALTHY: 'Saudável', UNHEALTHY: 'Não saudável', RESTARTING: 'Reiniciando', EXITED: 'Encerrado',
  OPEN: 'Aberto', OVERDUE: 'Vencido', PAID: 'Pago', PARTIALLY_PAID: 'Pago parcialmente',
  CANCELLED: 'Cancelado', CANCELED: 'Cancelado', WRITTEN_OFF: 'Baixado como perda', REVERSED: 'Estornado',
  PAUSED: 'Pausado', SENT: 'Enviado', DELIVERED: 'Entregue', READ: 'Lido', RETRY: 'Nova tentativa',
  MATCHED: 'Conciliado', SUGGESTED: 'Sugerido', UNMATCHED: 'Não conciliado', REJECTED: 'Rejeitado',
  CREDIT: 'Crédito', DEBIT: 'Débito', MANUAL: 'Manual', AUTOMATIC: 'Automático',
  CRITICAL: 'Crítico', WARNING: 'Aviso', INFO: 'Informação', DEBUG: 'Depuração',
  SUSPENDED: 'Suspenso', BLOCKED: 'Bloqueado', BLOCKED_EXTERNAL: 'Bloqueado por serviço externo', ARCHIVED: 'Arquivado',
  UNKNOWN: 'Desconhecido', NOT_REQUIRED: 'Não necessário',
  PRODUCTION: 'Produção', HOMOLOGATION: 'Homologação', SANDBOX: 'Ambiente de testes',
  PUBLIC: 'Público', SECRET: 'Protegido', FULL: 'Completo', TENANT: 'Cliente específico',
}

const auditActions: Record<string, string> = {
  'tenant.create.requested': 'Criação do cliente solicitada',
  'tenant.provisioned': 'Cliente provisionado',
  'tenant.updated': 'Cliente atualizado',
  'tenant.provision.retry_requested': 'Reprocessamento do provisionamento solicitado',
  'domain.created': 'Domínio adicionado',
  'domain.updated': 'Domínio atualizado',
  'domain.deleted': 'Domínio removido',
  'domain.verified': 'Domínio verificado',
  'domain.reconciled': 'Domínio reconciliado',
  'domain.proxy_updated': 'Proxy do domínio atualizado',
  'domain.dnssec_updated': 'DNSSEC do domínio atualizado',
  'domain.ssl_activated': 'SSL do domínio ativado',
  'plan.created': 'Plano criado',
  'plan.updated': 'Plano atualizado',
  'plan.deactivated': 'Plano desativado',
  'whatsapp.status': 'Estado do WhatsApp consultado',
  'whatsapp.create': 'Conexão do WhatsApp preparada',
  'whatsapp.connect': 'Conexão do WhatsApp iniciada',
  'whatsapp.disconnect': 'WhatsApp desconectado',
  'whatsapp.restart': 'Conexão do WhatsApp reiniciada',
  'whatsapp.delete': 'Conexão do WhatsApp removida',
  'whatsapp.control.create': 'Conexão do WhatsApp preparada pelo Control Plane',
  'whatsapp.control.connect': 'Conexão do WhatsApp iniciada pelo Control Plane',
  'whatsapp.control.disconnect': 'WhatsApp desconectado pelo Control Plane',
  'whatsapp.control.restart': 'WhatsApp reiniciado pelo Control Plane',
  'whatsapp.control.delete': 'Conexão do WhatsApp removida pelo Control Plane',
  'observability.diagnostics_exported': 'Diagnóstico exportado',
  'observability.runtime_logs_purged': 'Retenção de logs aplicada',
  'integration.updated': 'Integração atualizada',
  'platform_integration.upserted': 'Integração da plataforma atualizada',
  'bank_account.created': 'Conta bancária criada',
  'bank_agreement.created': 'Convênio bancário criado',
  'contract.updated': 'Contrato atualizado',
  'contract.deleted': 'Contrato excluído/encerrado',
  'user.created': 'Usuário criado',
  'user.updated': 'Usuário atualizado',
  'user.password_reset': 'Senha de usuário redefinida',
  'user.mfa_reset': 'Autenticação em duas etapas redefinida',
  'company.updated': 'Empresa atualizada',
  'company.security.updated': 'Segurança da empresa atualizada',
  'notification_rule.created': 'Régua de cobrança criada',
  'notification_rule.updated': 'Régua de cobrança atualizada',
  'notification_rule.executed': 'Régua de cobrança executada',
  'notification_template.created': 'Modelo de comunicação criado',
  'notification_template.updated': 'Modelo de comunicação atualizado',
}

const entityLabels: Record<string, string> = {
  Tenant: 'Cliente da plataforma', TenantDomain: 'Domínio', PlatformPlan: 'Plano',
  PlatformWhatsApp: 'WhatsApp', WhatsAppInstance: 'Conexão do WhatsApp',
  PlatformIntegration: 'Integração da plataforma', IntegrationSetting: 'Integração',
  TenantUser: 'Usuário', Company: 'Empresa', Contract: 'Contrato', BankAccount: 'Conta bancária',
  BankAgreement: 'Convênio bancário', DiagnosticsBundle: 'Pacote de diagnóstico',
  ProvisioningJob: 'Provisionamento', NotificationRule: 'Régua de cobrança',
  NotificationTemplate: 'Modelo de comunicação', RuntimeLogs: 'Logs operacionais',
}

export function roleLabel(role?: string | null): string {
  if (!role) return 'Usuário'
  return roleLabels[role] || 'Usuário'
}

export function statusLabel(status?: string | null): string {
  if (!status) return '—'
  return statusLabels[String(status).toUpperCase()] || String(status).replaceAll('_', ' ').toLowerCase().replace(/^./, char => char.toUpperCase())
}

export function logLevelLabel(level?: string | null): string {
  return statusLabel(level)
}

export function domainModeLabel(mode?: string | null): string {
  const labels: Record<string, string> = {
    PLATFORM_SUBDOMAIN: 'Subdomínio Connect|API gerenciado',
    PLATFORM_MANAGED: 'Domínio próprio gerenciado pela Connect|API Platform',
    EXTERNAL_DNS: 'Domínio próprio com DNS do cliente',
  }
  return labels[String(mode || '').toUpperCase()] || 'Administração não definida'
}

export function auditActionLabel(action?: string | null): string {
  if (!action) return 'Evento do sistema'
  return auditActions[action] || action.replaceAll('.', ' › ').replaceAll('_', ' ')
}

export function entityLabel(entity?: string | null): string {
  if (!entity) return 'Registro'
  return entityLabels[entity] || entity
}

export function permissionLabel(permission: string): string {
  if (permissionLabels[permission]) return permissionLabels[permission]
  const [resource, action] = permission.split('.', 2)
  const resourceLabel = permissionGroup(permission)
  const actionLabels: Record<string, string> = {
    read: 'Visualizar', create: 'Cadastrar', update: 'Editar', delete: 'Excluir',
    manage: 'Administrar', generate: 'Gerar', import: 'Importar', approve: 'Aprovar',
    cancel: 'Cancelar', reverse: 'Estornar', action: 'Executar ações', view: 'Visualizar',
    deactivate: 'Desativar',
  }
  if (resource && action && actionLabels[action]) return `${actionLabels[action]} ${resourceLabel.toLowerCase()}`
  return 'Permissão adicional'
}

export function permissionGroup(permission: string): string {
  const prefix = permission.split('.')[0]
  const labels: Record<string, string> = {
    dashboard: 'Dashboard', channels: 'Canais', instances: 'Instâncias', messages: 'Mensagens',
    templates: 'Templates', micro_apps: 'Micro Apps', events: 'Eventos', automations: 'Automações',
    integrations: 'Integrações', webhooks: 'Webhooks', pbx: 'PBX', voip: 'VOIP',
    api_keys: 'Chaves de API', notifications: 'Notificações', documents: 'Documentos',
    exports: 'Exportações', reports: 'Relatórios', companies: 'Empresas', users: 'Usuários',
    roles: 'Perfis de acesso', audit: 'Auditoria', '*': 'Administração',
  }
  return labels[prefix] || 'Outras permissões'
}
