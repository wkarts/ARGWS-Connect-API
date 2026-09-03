from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import accessible_company_ids, get_tenant_db, require_control_roles, require_permission
from app.db.platform import get_platform_session
from app.models.platform import PlatformAuditLog, PlatformUser, Tenant
from app.models.tenant import Company, TenantAuditLog, TenantUser
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse

router = APIRouter(tags=["Auditoria detalhada"])

_ACTION_LABELS: dict[str, str] = {
    "whatsapp.status": "Consulta do estado do WhatsApp",
    "whatsapp.create": "Criação da conexão do WhatsApp",
    "whatsapp.connect": "Conexão do WhatsApp",
    "whatsapp.disconnect": "Desconexão do WhatsApp",
    "whatsapp.restart": "Reinício da conexão do WhatsApp",
    "whatsapp.delete": "Remoção da conexão do WhatsApp",
    "whatsapp.control.create": "Criação da conexão do WhatsApp pelo Control Plane",
    "whatsapp.control.connect": "Conexão do WhatsApp pelo Control Plane",
    "whatsapp.control.disconnect": "Desconexão do WhatsApp pelo Control Plane",
    "whatsapp.control.restart": "Reinício do WhatsApp pelo Control Plane",
    "whatsapp.control.delete": "Remoção do WhatsApp pelo Control Plane",
    "integration.updated": "Integração atualizada",
    "company.created": "Empresa cadastrada",
    "company.updated": "Empresa atualizada",
    "company.security.updated": "Política de segurança da empresa atualizada",
    "customer.created": "Cliente cadastrado",
    "customer.updated": "Cliente atualizado",
    "user.created": "Usuário cadastrado",
    "user.updated": "Usuário atualizado",
    "user.password_reset": "Senha de usuário redefinida",
    "user.mfa_reset": "Autenticação em duas etapas redefinida",
    "bank_account.created": "Conta bancária cadastrada",
    "bank_agreement.created": "Convênio bancário cadastrado",
    "notification_rule.created": "Régua de cobrança cadastrada",
    "notification_rule.updated": "Régua de cobrança atualizada",
    "notification_rule.executed": "Régua de cobrança executada",
    "notification_template.created": "Template de comunicação cadastrado",
    "notification_template.updated": "Template de comunicação atualizado",
    "tenant.create.requested": "Criação de tenant solicitada",
    "tenant.updated": "Tenant atualizado",
    "tenant.provisioned": "Tenant provisionado",
    "tenant.provision.retry_requested": "Reprocessamento do tenant solicitado",
    "domain.created": "Domínio cadastrado",
    "domain.updated": "Domínio atualizado",
    "domain.deleted": "Domínio removido",
    "domain.verified": "Domínio verificado",
    "domain.reconciled": "Domínio reconciliado",
    "domain.proxy_updated": "Proxy do domínio atualizado",
    "domain.dnssec_updated": "DNSSEC do domínio atualizado",
    "domain.ssl_activated": "SSL do domínio ativado",
    "plan.created": "Plano cadastrado",
    "plan.updated": "Plano atualizado",
    "plan.deactivated": "Plano desativado",
    "platform_user.created": "Usuário da plataforma cadastrado",
    "platform_user.updated": "Usuário da plataforma atualizado",
    "platform_user.password_reset": "Senha de usuário da plataforma redefinida",
    "observability.diagnostics_exported": "Diagnóstico operacional exportado",
    "observability.runtime_logs_purged": "Retenção de logs operacionais aplicada",
    "support_session.created": "Sessão de suporte iniciada",
    "support_session.revoked": "Sessão de suporte encerrada",
}

_ENTITY_LABELS: dict[str, str] = {
    "PlatformWhatsApp": "WhatsApp da conta",
    "WhatsAppInstance": "Instância de WhatsApp",
    "IntegrationSetting": "Integração",
    "Company": "Empresa",
    "Customer": "Cliente",
    "TenantUser": "Usuário",
    "BankAccount": "Conta bancária",
    "BankAgreement": "Convênio bancário",
    "NotificationRule": "Régua de cobrança",
    "NotificationTemplate": "Template de comunicação",
    "Tenant": "Tenant",
    "TenantDomain": "Domínio",
    "ProvisioningJob": "Provisionamento",
    "PlatformPlan": "Plano",
    "PlatformUser": "Usuário da plataforma",
    "DiagnosticsBundle": "Pacote de diagnóstico",
    "RuntimeLogs": "Logs operacionais",
    "SupportSession": "Sessão de suporte",
}


def _action_label(value: str) -> str:
    if value in _ACTION_LABELS:
        return _ACTION_LABELS[value]
    words = value.replace("_", " ").replace(".", " · ").strip()
    return words[:1].upper() + words[1:] if words else "Evento de auditoria"


def _entity_label(value: str) -> str:
    return _ENTITY_LABELS.get(value, value or "Entidade")


@router.get("/api/v1/audit-details", response_model=SuccessResponse[list[dict]])
async def tenant_audit_details(
    limit: int = Query(default=250, ge=1, le=1000),
    q: str | None = Query(default=None, max_length=200),
    action: str | None = Query(default=None, max_length=100),
    actor_id: UUID | None = Query(default=None),
    company_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_permission("audit.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = (
        select(
            TenantAuditLog,
            TenantUser.name,
            TenantUser.email,
            TenantUser.role,
            Company.legal_name,
            Company.trade_name,
            Company.tax_id,
        )
        .outerjoin(TenantUser, TenantUser.id == TenantAuditLog.actor_id)
        .outerjoin(Company, Company.id == TenantAuditLog.company_id)
    )
    filters = []
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        filters.append(TenantAuditLog.company_id.in_(company_ids))
    if action:
        filters.append(TenantAuditLog.action.ilike(f"%{action}%"))
    if actor_id:
        filters.append(TenantAuditLog.actor_id == actor_id)
    if company_id:
        filters.append(TenantAuditLog.company_id == company_id)
    if q:
        term = f"%{q}%"
        filters.append(
            or_(
                TenantAuditLog.action.ilike(term),
                TenantAuditLog.entity_type.ilike(term),
                TenantAuditLog.entity_id.ilike(term),
                TenantUser.name.ilike(term),
                TenantUser.email.ilike(term),
                Company.legal_name.ilike(term),
                Company.trade_name.ilike(term),
                Company.tax_id.ilike(term),
            )
        )
    rows = list(
        (
            await session.execute(
                stmt.where(*filters)
                .order_by(TenantAuditLog.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "action": item.action,
                "action_label": _action_label(item.action),
                "entity_type": item.entity_type,
                "entity_label": _entity_label(item.entity_type),
                "entity_id": item.entity_id,
                "actor_id": str(item.actor_id) if item.actor_id else None,
                "actor_name": actor_name or "Sistema",
                "actor_email": actor_email,
                "actor_role": actor_role,
                "company_id": str(item.company_id) if item.company_id else None,
                "company_name": company_trade_name or company_legal_name,
                "company_tax_id": company_tax_id,
                "before": item.before or {},
                "after": item.after or {},
                "context": item.context or {},
                "correlation_id": item.correlation_id,
                "created_at": item.created_at.isoformat(),
            }
            for (
                item,
                actor_name,
                actor_email,
                actor_role,
                company_legal_name,
                company_trade_name,
                company_tax_id,
            ) in rows
        ]
    )


@router.get("/api/control/v1/audit-details", response_model=PaginatedResponse[dict])
async def platform_audit_details(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=100, ge=1, le=200),
    q: str | None = Query(default=None, max_length=200),
    action: str | None = Query(default=None, max_length=100),
    tenant_id: UUID | None = Query(default=None),
    actor_id: UUID | None = Query(default=None),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> PaginatedResponse[dict]:
    base = (
        select(
            PlatformAuditLog,
            PlatformUser.name,
            PlatformUser.email,
            PlatformUser.role,
            Tenant.name,
            Tenant.slug,
        )
        .outerjoin(PlatformUser, PlatformUser.id == PlatformAuditLog.actor_id)
        .outerjoin(Tenant, Tenant.id == PlatformAuditLog.tenant_id)
    )
    count_stmt = (
        select(func.count())
        .select_from(PlatformAuditLog)
        .outerjoin(PlatformUser, PlatformUser.id == PlatformAuditLog.actor_id)
        .outerjoin(Tenant, Tenant.id == PlatformAuditLog.tenant_id)
    )
    filters = []
    if action:
        filters.append(PlatformAuditLog.action.ilike(f"%{action}%"))
    if tenant_id:
        filters.append(PlatformAuditLog.tenant_id == tenant_id)
    if actor_id:
        filters.append(PlatformAuditLog.actor_id == actor_id)
    if q:
        term = f"%{q}%"
        filters.append(
            or_(
                PlatformAuditLog.action.ilike(term),
                PlatformAuditLog.entity_type.ilike(term),
                PlatformAuditLog.entity_id.ilike(term),
                PlatformUser.name.ilike(term),
                PlatformUser.email.ilike(term),
                Tenant.name.ilike(term),
                Tenant.slug.ilike(term),
            )
        )
    total = int(await session.scalar(count_stmt.where(*filters)) or 0)
    rows = list(
        (
            await session.execute(
                base.where(*filters)
                .order_by(PlatformAuditLog.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).all()
    )
    data = [
        {
            "id": str(item.id),
            "action": item.action,
            "action_label": _action_label(item.action),
            "entity_type": item.entity_type,
            "entity_label": _entity_label(item.entity_type),
            "entity_id": item.entity_id,
            "actor_id": str(item.actor_id) if item.actor_id else None,
            "actor_name": actor_name or "Sistema",
            "actor_email": actor_email,
            "actor_role": actor_role,
            "tenant_id": str(item.tenant_id) if item.tenant_id else None,
            "tenant_name": tenant_name or "Plataforma",
            "tenant_slug": tenant_slug,
            "before": item.before or {},
            "after": item.after or {},
            "context": item.context or {},
            "correlation_id": item.correlation_id,
            "created_at": item.created_at.isoformat(),
        }
        for item, actor_name, actor_email, actor_role, tenant_name, tenant_slug in rows
    ]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(
            page=page,
            per_page=per_page,
            total=total,
            pages=(total + per_page - 1) // per_page,
        ),
    )
