from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_control_roles
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.platform import ProvisioningJob, Tenant, TenantDomain
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.services.domains import domain_service
from app.services.provisioning import provisioning_service
from app.services.tenant_resolver import TenantResolver

router = APIRouter(prefix="/api/control/v1", tags=["Control Plane - Provisionamento"])


class ProvisioningActionInput(BaseModel):
    action: str

    @field_validator("action")
    @classmethod
    def normalize_action(cls, value: str) -> str:
        action = value.strip().upper()
        allowed = {
            "VALIDATE",
            "MIGRATE_DATABASE",
            "ENSURE_STORAGE",
            "RECONCILE_DOMAIN",
            "ACTIVATE_IF_READY",
        }
        if action not in allowed:
            raise ValueError("Ação de provisionamento inválida.")
        return action


def _domain_state(domain: TenantDomain | None) -> dict:
    if domain is None:
        return {
            "id": None,
            "hostname": None,
            "status": "MISSING",
            "ssl_status": "MISSING",
            "management_mode": None,
            "dns_provider": None,
            "dns_verified": False,
            "last_error": "Tenant sem domínio principal.",
        }
    return {
        "id": str(domain.id),
        "hostname": domain.hostname,
        "status": domain.status,
        "ssl_status": domain.ssl_status,
        "management_mode": domain.management_mode,
        "dns_provider": domain.dns_provider,
        "dns_verified": domain.dns_verified_at is not None,
        "last_checked_at": domain.last_checked_at.isoformat() if domain.last_checked_at else None,
        "last_reconciled_at": domain.last_reconciled_at.isoformat() if domain.last_reconciled_at else None,
        "last_error": domain.last_error,
    }


def _tenant_snapshot(tenant: Tenant) -> dict:
    primary = next((item for item in tenant.domains if item.is_primary), None)
    primary = primary or next(iter(tenant.domains), None)
    latest = max(tenant.provisioning_jobs, key=lambda item: item.created_at, default=None)

    database = tenant.database
    storage = tenant.storage
    domain = _domain_state(primary)

    database_ready = bool(database and database.status == "ACTIVE")
    storage_ready = bool(storage and storage.status == "ACTIVE")
    domain_ready = bool(primary and primary.status == "ACTIVE")
    ssl_ready = bool(primary and primary.ssl_status in {"ACTIVE", "NOT_REQUIRED"})
    ready = database_ready and storage_ready and domain_ready and ssl_ready

    issues: list[str] = []
    if not database:
        issues.append("Banco isolado ainda não foi criado.")
    elif not database_ready:
        issues.append(f"Banco do tenant está em estado {database.status}.")
    if not storage:
        issues.append("Storage isolado ainda não foi criado.")
    elif not storage_ready:
        issues.append(f"Storage do tenant está em estado {storage.status}.")
    if not primary:
        issues.append("Tenant não possui domínio principal.")
    else:
        if not domain_ready:
            issues.append(f"Domínio principal está em estado {primary.status}.")
        if not ssl_ready:
            issues.append(f"SSL do domínio está em estado {primary.ssl_status}.")

    return {
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "tenant_status": tenant.status,
        "plan_code": tenant.plan_code,
        "ready": ready,
        "issues": issues,
        "database": {
            "status": database.status if database else "MISSING",
            "database_name": database.database_name if database else None,
            "database_user": database.database_user if database else None,
            "credential_version": database.credential_version if database else None,
            "migrated_revision": database.migrated_revision if database else None,
            "provisioned_at": database.provisioned_at.isoformat() if database and database.provisioned_at else None,
            "last_error": database.last_error if database else "Banco não provisionado.",
        },
        "storage": {
            "status": storage.status if storage else "MISSING",
            "provider": storage.provider if storage else None,
            "bucket": storage.bucket if storage else None,
            "prefix": storage.prefix if storage else None,
            "provisioned_at": storage.provisioned_at.isoformat() if storage and storage.provisioned_at else None,
            "last_error": storage.last_error if storage else "Storage não provisionado.",
        },
        "domain": domain,
        "latest_job": {
            "id": str(latest.id),
            "operation": latest.operation,
            "status": latest.status,
            "current_step": latest.current_step,
            "progress": latest.progress,
            "attempts": latest.attempts,
            "correlation_id": latest.correlation_id,
            "started_at": latest.started_at.isoformat() if latest.started_at else None,
            "finished_at": latest.finished_at.isoformat() if latest.finished_at else None,
            "last_error": latest.last_error,
        } if latest else None,
    }


async def _load_tenant(session: AsyncSession, tenant_id: UUID) -> Tenant:
    tenant = await session.scalar(
        select(Tenant)
        .where(Tenant.id == tenant_id)
        .options(
            selectinload(Tenant.database),
            selectinload(Tenant.storage),
            selectinload(Tenant.domains),
            selectinload(Tenant.provisioning_jobs),
        )
    )
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Cliente não encontrado.", 404)
    return tenant


@router.get("/provisioning/overview", response_model=SuccessResponse[dict])
async def provisioning_overview(
    _: AuthUser = Depends(
        require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")
    ),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenants = list(
        (
            await session.scalars(
                select(Tenant)
                .options(
                    selectinload(Tenant.database),
                    selectinload(Tenant.storage),
                    selectinload(Tenant.domains),
                    selectinload(Tenant.provisioning_jobs),
                )
                .order_by(Tenant.name)
            )
        ).all()
    )
    rows = [_tenant_snapshot(tenant) for tenant in tenants]
    return SuccessResponse(
        data={
            "total": len(rows),
            "ready": sum(1 for row in rows if row["ready"]),
            "attention": sum(1 for row in rows if not row["ready"]),
            "running": sum(
                1
                for row in rows
                if row["latest_job"] and row["latest_job"]["status"] in {"PENDING", "RUNNING"}
            ),
            "tenants": rows,
        }
    )


@router.get("/tenants/{tenant_id}/provisioning", response_model=SuccessResponse[dict])
async def tenant_provisioning_snapshot(
    tenant_id: UUID,
    _: AuthUser = Depends(
        require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")
    ),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await _load_tenant(session, tenant_id)
    return SuccessResponse(data=_tenant_snapshot(tenant))


@router.post("/tenants/{tenant_id}/provisioning/actions", response_model=SuccessResponse[dict])
async def provisioning_action(
    tenant_id: UUID,
    payload: ProvisioningActionInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await _load_tenant(session, tenant_id)
    before = _tenant_snapshot(tenant)
    action = payload.action

    if action == "VALIDATE":
        await provisioning_service.validate_resources(session, tenant)
    elif action == "MIGRATE_DATABASE":
        if tenant.database is None:
            raise APIError(
                "TENANT_DATABASE_MISSING",
                "O banco do cliente ainda não existe; use o provisionamento completo.",
                409,
            )
        context = await TenantResolver(session).resolve_by_id(str(tenant.id), require_active=False)
        await provisioning_service._run_tenant_migrations(context)
        tenant.database.status = "ACTIVE"
        tenant.database.migrated_revision = "head"
        tenant.database.provisioned_at = tenant.database.provisioned_at or datetime.now(UTC)
        tenant.database.last_error = None
        await session.flush()
    elif action == "ENSURE_STORAGE":
        if tenant.storage is None:
            raise APIError(
                "TENANT_STORAGE_MISSING",
                "O storage do cliente ainda não possui registro; use o provisionamento completo.",
                409,
            )
        await provisioning_service.storage.ensure_bucket(tenant.storage.bucket)
        tenant.storage.status = "ACTIVE"
        tenant.storage.provisioned_at = tenant.storage.provisioned_at or datetime.now(UTC)
        tenant.storage.last_error = None
        await session.flush()
    elif action == "RECONCILE_DOMAIN":
        primary = next((item for item in tenant.domains if item.is_primary), None)
        primary = primary or next(iter(tenant.domains), None)
        if primary is None:
            raise APIError("TENANT_WITHOUT_DOMAIN", "Cliente sem domínio para reconciliar.", 409)
        if primary.management_mode == "EXTERNAL_DNS":
            await domain_service.verify(session, primary)
        else:
            await domain_service.reconcile(session, primary)
    elif action == "ACTIVATE_IF_READY":
        await provisioning_service.validate_resources(session, tenant)
        snapshot = _tenant_snapshot(tenant)
        if not snapshot["ready"]:
            raise APIError(
                "TENANT_RESOURCES_NOT_READY",
                "O cliente ainda possui recursos pendentes e não pode ser ativado.",
                409,
                {"issues": snapshot["issues"]},
            )
        tenant.status = "ACTIVE"
        tenant.activated_at = tenant.activated_at or datetime.now(UTC)
        await session.flush()

    after = _tenant_snapshot(tenant)
    await platform_audit(
        session,
        action=f"tenant.provisioning.{action.lower()}",
        entity_type="Tenant",
        entity_id=str(tenant.id),
        actor_id=user.id,
        tenant_id=str(tenant.id),
        before={
            "tenant_status": before["tenant_status"],
            "database": before["database"]["status"],
            "storage": before["storage"]["status"],
            "domain": before["domain"]["status"],
            "ssl": before["domain"]["ssl_status"],
        },
        after={
            "tenant_status": after["tenant_status"],
            "database": after["database"]["status"],
            "storage": after["storage"]["status"],
            "domain": after["domain"]["status"],
            "ssl": after["domain"]["ssl_status"],
            "ready": after["ready"],
        },
        context={"origin": "provisioning-console", "operation": action},
    )
    await session.commit()
    tenant = await _load_tenant(session, tenant_id)
    return SuccessResponse(data=_tenant_snapshot(tenant))
