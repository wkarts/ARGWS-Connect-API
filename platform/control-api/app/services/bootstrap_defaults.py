from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import PlatformPlan, PlatformSetting
from app.models.tenant import TenantRole

# Núcleo canônico de permissões do Connect|API Platform. O domínio financeiro
# herdado não participa dos presets padrão e permanece desativado por feature flag.
ALL_TENANT_PERMISSIONS: list[str] = [
    "dashboard.read",
    "channels.read", "channels.manage",
    "instances.read", "instances.manage",
    "messages.read", "messages.send",
    "templates.read", "templates.manage",
    "micro_apps.read", "micro_apps.manage",
    "events.read", "events.replay",
    "automations.read", "automations.manage",
    "integrations.read", "integrations.manage",
    "webhooks.read", "webhooks.manage",
    "pbx.read", "pbx.manage",
    "voip.read", "voip.manage",
    "api_keys.read", "api_keys.manage",
    "notifications.read", "notifications.manage",
    "documents.read", "documents.manage",
    "exports.read", "exports.create",
    "reports.view",
    "companies.read", "companies.update",
    "users.read", "users.manage",
    "roles.read", "roles.manage",
    "audit.read",
]

# Os planos são perfis técnicos iniciais, sem preços comerciais inventados.
# O Control Plane é a fonte de verdade para preços, limites e publicação pública.
DEFAULT_PLANS: list[dict[str, Any]] = [
    {
        "code": "STARTER",
        "name": "Starter",
        "description": "Base de comunicação e integração para pequenos ambientes.",
        "monthly_price": Decimal("0.00"),
        "annual_price": Decimal("0.00"),
        "sort_order": 10,
        "is_public": False,
        "features": {
            "channels": True,
            "instances": True,
            "messages": True,
            "api": True,
            "webhooks": False,
            "automations": False,
            "whatsapp": True,
            "pbx": False,
            "voip": False,
            "custom_domain": False,
            "custom_integrations_allowed": False,
        },
        "limits": {
            "users": 0,
            "instances": 0,
            "channels": 0,
            "monthly_messages": 0,
            "webhooks": 0,
            "automations": 0,
            "storage_gb": 0,
        },
    },
    {
        "code": "PROFESSIONAL",
        "name": "Professional",
        "description": "Integrações, webhooks e domínio personalizado.",
        "monthly_price": Decimal("0.00"),
        "annual_price": Decimal("0.00"),
        "sort_order": 20,
        "is_public": False,
        "features": {
            "channels": True,
            "instances": True,
            "messages": True,
            "api": True,
            "webhooks": True,
            "automations": False,
            "whatsapp": True,
            "pbx": False,
            "voip": False,
            "custom_domain": True,
            "custom_integrations_allowed": True,
        },
        "limits": {
            "users": 0,
            "instances": 0,
            "channels": 0,
            "monthly_messages": 0,
            "webhooks": 0,
            "automations": 0,
            "storage_gb": 0,
        },
    },
    {
        "code": "BUSINESS",
        "name": "Business",
        "description": "Automação, PBX, VOIP e integrações ampliadas.",
        "monthly_price": Decimal("0.00"),
        "annual_price": Decimal("0.00"),
        "sort_order": 30,
        "is_public": False,
        "features": {
            "channels": True,
            "instances": True,
            "messages": True,
            "api": True,
            "webhooks": True,
            "automations": True,
            "whatsapp": True,
            "pbx": True,
            "voip": True,
            "custom_domain": True,
            "custom_integrations_allowed": True,
        },
        "limits": {
            "users": 0,
            "instances": 0,
            "channels": 0,
            "monthly_messages": 0,
            "webhooks": 0,
            "automations": 0,
            "storage_gb": 0,
        },
    },
    {
        "code": "ENTERPRISE",
        "name": "Enterprise",
        "description": "Governança, suporte assistido e capacidade definida por contrato.",
        "monthly_price": Decimal("0.00"),
        "annual_price": Decimal("0.00"),
        "sort_order": 40,
        "is_public": False,
        "features": {
            "channels": True,
            "instances": True,
            "messages": True,
            "api": True,
            "webhooks": True,
            "automations": True,
            "whatsapp": True,
            "pbx": True,
            "voip": True,
            "custom_domain": True,
            "custom_integrations_allowed": True,
            "support_impersonation": True,
        },
        "limits": {
            "users": 0,
            "instances": 0,
            "channels": 0,
            "monthly_messages": 0,
            "webhooks": 0,
            "automations": 0,
            "storage_gb": 0,
        },
    },
]

DEFAULT_PLATFORM_SETTINGS: list[dict[str, Any]] = [
    {
        "key": "platform.locale",
        "category": "GENERAL",
        "value": {"language": "pt-BR", "timezone": "America/Bahia"},
        "description": "Localização padrão da plataforma.",
    },
    {
        "key": "tenant.provisioning",
        "category": "PROVISIONING",
        "value": {
            "temporary_domain": True,
            "custom_domains": True,
            "database_per_tenant": True,
            "storage_per_tenant": True,
        },
        "description": "Política canônica de provisionamento multitenant.",
    },
    {
        "key": "connect.defaults",
        "category": "COMMUNICATION",
        "value": {
            "channels_enabled": True,
            "webhooks_enabled": True,
            "events_enabled": True,
            "automations_enabled": True,
            "pbx_available": False,
            "voip_available": False,
        },
        "description": "Capacidades padrão do Connect|API Platform.",
    },
    {
        "key": "backup.retention",
        "category": "BACKUP",
        "value": {"daily": 14, "weekly": 8, "monthly": 12, "yearly": 5},
        "description": "Retenção padrão de backups.",
    },
    {
        "key": "security.support_session",
        "category": "SECURITY",
        "value": {"max_minutes": 120, "reason_required": True, "audit_required": True},
        "description": "Política de acesso assistido.",
    },
]

ROLE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "code": "TENANT_ADMIN",
        "name": "Administrador",
        "description": "Acesso integral ao tenant.",
        "permissions": ["*"],
        "is_system": True,
    },
    {
        "code": "INTEGRATION_MANAGER",
        "name": "Gestor de integrações",
        "description": "Gerencia canais, instâncias, integrações, webhooks e automações.",
        "permissions": [
            p for p in ALL_TENANT_PERMISSIONS
            if p not in {"users.manage", "roles.manage", "pbx.manage", "voip.manage"}
        ],
        "is_system": True,
    },
    {
        "code": "COMMUNICATION_OPERATOR",
        "name": "Operador de comunicação",
        "description": "Opera canais, instâncias, mensagens e eventos.",
        "permissions": [
            p for p in ALL_TENANT_PERMISSIONS
            if p.split(".", 1)[0] in {"dashboard", "channels", "instances", "messages", "events", "notifications"}
        ],
        "is_system": True,
    },
    {
        "code": "PBX_OPERATOR",
        "name": "Operador PBX/VOIP",
        "description": "Opera recursos de telefonia, PBX e VOIP.",
        "permissions": [
            p for p in ALL_TENANT_PERMISSIONS
            if p.split(".", 1)[0] in {"dashboard", "channels", "instances", "events", "pbx", "voip"}
        ],
        "is_system": True,
    },
    {
        "code": "AUDITOR",
        "name": "Auditor",
        "description": "Consulta dados operacionais e trilhas de auditoria sem alterações.",
        "permissions": [
            p for p in ALL_TENANT_PERMISSIONS
            if p.endswith(".read") or p in {"reports.view"}
        ],
        "is_system": True,
    },
    {
        "code": "VIEWER",
        "name": "Consulta",
        "description": "Acesso estritamente de leitura.",
        "permissions": [p for p in ALL_TENANT_PERMISSIONS if p.endswith(".read")],
        "is_system": True,
    },
]


async def ensure_platform_defaults(session: AsyncSession) -> None:
    for definition in DEFAULT_PLANS:
        code = definition["code"]
        item = await session.scalar(select(PlatformPlan).where(PlatformPlan.code == code))
        if item is None:
            session.add(PlatformPlan(**definition))
    for definition in DEFAULT_PLATFORM_SETTINGS:
        item = await session.scalar(select(PlatformSetting).where(PlatformSetting.key == definition["key"]))
        if item is None:
            session.add(PlatformSetting(**definition))
    await session.flush()


async def ensure_tenant_roles(session: AsyncSession) -> None:
    for definition in ROLE_DEFINITIONS:
        item = await session.scalar(select(TenantRole).where(TenantRole.code == definition["code"]))
        if item is None:
            session.add(TenantRole(**definition))
        elif item.is_system:
            item.name = definition["name"]
            item.description = definition["description"]
            item.permissions = definition["permissions"]
            item.is_active = True
    await session.flush()
