from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.platform import PlatformPlan, Tenant


@dataclass(frozen=True, slots=True)
class TenantEntitlements:
    tenant_id: UUID
    plan_code: str
    features: dict[str, Any]
    limits: dict[str, Any]

    def require_feature(self, feature: str) -> None:
        value = self.features.get(feature)
        if value is False:
            raise APIError(
                "FEATURE_NOT_AVAILABLE",
                "Este recurso não está habilitado no plano do tenant.",
                403,
                {"feature": feature, "plan": self.plan_code},
            )

    def enforce_limit(self, resource: str, current: int, increment: int = 1) -> None:
        raw = self.limits.get(resource)
        if raw in (None, "", 0, "0"):
            return
        try:
            limit = int(raw)
        except (TypeError, ValueError):
            return
        if limit > 0 and current + increment > limit:
            raise APIError(
                "TENANT_LIMIT_EXCEEDED",
                "O limite contratado para este recurso foi atingido.",
                409,
                {
                    "resource": resource,
                    "current": current,
                    "increment": increment,
                    "limit": limit,
                    "plan": self.plan_code,
                },
            )


async def _managed_keys(session: AsyncSession) -> tuple[set[str], set[str]]:
    """Retorna todas as chaves controladas comercialmente por planos.

    O objeto ``Tenant.features`` também guarda opções operacionais do tenant
    (landing page, modo demo, cobrança de add-on, etc.). Por isso uma troca de
    plano não pode simplesmente substituir o JSON inteiro. Apenas chaves que
    aparecem em algum plano são consideradas entitlements comerciais.
    """
    plans = list((await session.scalars(select(PlatformPlan))).all())
    feature_keys: set[str] = set()
    limit_keys: set[str] = set()
    for plan in plans:
        feature_keys.update(str(key) for key in (plan.features or {}))
        limit_keys.update(str(key) for key in (plan.limits or {}))
    return feature_keys, limit_keys


async def resolve_plan(session: AsyncSession, plan_code: str) -> PlatformPlan:
    code = plan_code.strip().upper()
    plan = await session.scalar(
        select(PlatformPlan).where(PlatformPlan.code == code, PlatformPlan.is_active.is_(True))
    )
    if plan is None:
        raise APIError("PLAN_NOT_FOUND", "Plano informado não existe ou está inativo.", 422)
    return plan


async def synchronize_tenant_entitlements(
    session: AsyncSession,
    tenant: Tenant,
    *,
    plan: PlatformPlan | None = None,
) -> dict[str, Any]:
    """Converge features/limits do tenant com o plano sem apagar opções locais."""
    plan = plan or await resolve_plan(session, tenant.plan_code)
    managed_features, managed_limits = await _managed_keys(session)

    current_features = dict(tenant.features or {})
    current_limits = dict(tenant.limits or {})
    operational_features = {
        key: value for key, value in current_features.items() if key not in managed_features
    }
    operational_limits = {
        key: value for key, value in current_limits.items() if key not in managed_limits
    }

    tenant.plan_code = plan.code
    tenant.features = {**operational_features, **dict(plan.features or {})}
    tenant.limits = {**operational_limits, **dict(plan.limits or {})}
    await session.flush()
    return {
        "plan_code": plan.code,
        "features": dict(tenant.features or {}),
        "limits": dict(tenant.limits or {}),
    }


async def synchronize_plan_tenants(session: AsyncSession, plan: PlatformPlan) -> int:
    """Propaga uma edição de plano a todos os tenants vinculados."""
    tenants = list(
        (await session.scalars(select(Tenant).where(Tenant.plan_code == plan.code))).all()
    )
    for tenant in tenants:
        await synchronize_tenant_entitlements(session, tenant, plan=plan)
    return len(tenants)


async def load_tenant_entitlements(session: AsyncSession, tenant_id: str) -> TenantEntitlements:
    item = await session.get(Tenant, UUID(tenant_id))
    if item is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado no Control Plane.", 404)
    if item.status != "ACTIVE":
        raise APIError("TENANT_NOT_ACTIVE", "Tenant não está ativo.", 403, {"status": item.status})
    return TenantEntitlements(
        tenant_id=item.id,
        plan_code=item.plan_code,
        features=dict(item.features or {}),
        limits=dict(item.limits or {}),
    )
