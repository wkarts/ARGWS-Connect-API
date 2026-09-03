from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.banking_governance import (
    PlanBankProviderPolicy,
    PlanBankProviderRule,
    PlatformBankProvider,
    TenantBankProviderOverride,
    TenantBankProviderPolicy,
)
from app.models.banking_platform import BankInstitution
from app.models.platform import PlatformPlan, Tenant
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.banking.registry import banking_providers


@dataclass(frozen=True, slots=True)
class ProviderEntitlementDecision:
    provider: str
    allowed: bool
    source: str
    driver_status: str
    driver_installed: bool
    globally_enabled: bool
    tenant_visible: bool
    plan_mode: str
    tenant_override: str | None
    operationally_allowed: bool | None = None

    @property
    def operational_allowed(self) -> bool:
        return self.allowed if self.operationally_allowed is None else self.operationally_allowed

    @property
    def discoverable(self) -> bool:
        return self.allowed and self.tenant_visible

    @property
    def commercial_status(self) -> str:
        if self.source == "TENANT_HIDDEN":
            return "HIDDEN"
        if self.source == "TENANT_ALLOW":
            return "OVERRIDE_ALLOWED"
        if self.source == "TENANT_DENY":
            return "OVERRIDE_DENIED"
        return "ENTITLED" if self.allowed else "NOT_ENTITLED"

    def public_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "allowed": self.allowed,
            "operationally_allowed": self.operational_allowed,
            "discoverable": self.discoverable,
            "source": self.source,
            "commercial_status": self.commercial_status,
            "driver_status": self.driver_status,
            "driver_installed": self.driver_installed,
            "globally_enabled": self.globally_enabled,
            "tenant_visible": self.tenant_visible,
            "plan_mode": self.plan_mode,
            "tenant_override": self.tenant_override,
        }


def evaluate_provider_entitlement(
    *,
    driver_installed: bool,
    globally_enabled: bool,
    tenant_visible: bool,
    tenant_override: str | None,
    plan_mode: str,
    selected_by_plan: bool,
) -> tuple[bool, str]:
    """Aplica a precedência comercial definida pela rc.27.

    ``tenant_visible`` é metadado de descoberta/UI e não altera autorização
    operacional. A transformação para descoberta acontece exclusivamente em
    ``tenant_provider_decisions``.
    """
    if not driver_installed:
        return False, "DRIVER_UNAVAILABLE"
    if not globally_enabled:
        return False, "GLOBAL_DISABLED"

    override = (tenant_override or "INHERIT").upper()
    if override == "DENY":
        return False, "TENANT_DENY"
    if override == "ALLOW":
        return True, "TENANT_ALLOW"

    mode = (plan_mode or "ALL").upper()
    if mode == "NONE":
        return False, "PLAN_NONE"
    if mode == "SELECTED":
        return (True, "PLAN_SELECTED") if selected_by_plan else (False, "PLAN_NOT_SELECTED")
    return True, "PLAN_ALL"


def _documentation_fingerprint(manifest: Any) -> tuple[str, str | None, datetime | None]:
    payload = [
        {
            "url": item.url,
            "title": item.title,
            "version": item.version,
            "checked_at": item.checked_at.isoformat() if item.checked_at else None,
        }
        for item in manifest.documentation
    ]
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    versions = sorted({str(item.version) for item in manifest.documentation if item.version})
    checked = [item.checked_at for item in manifest.documentation if item.checked_at]
    checked_at = datetime.combine(max(checked), datetime.min.time(), tzinfo=UTC) if checked else None
    return digest, ", ".join(versions) if versions else None, checked_at


async def _institution_for_manifest(session: AsyncSession, manifest: Any) -> BankInstitution | None:
    reference = manifest.institution
    if reference is None:
        return None
    if reference.ispb:
        item = await session.scalar(select(BankInstitution).where(BankInstitution.ispb == reference.ispb))
        if item is not None:
            return item
    if reference.bank_code:
        return await session.scalar(
            select(BankInstitution)
            .where(BankInstitution.bank_code == reference.bank_code)
            .order_by(BankInstitution.active.desc(), BankInstitution.updated_at.desc())
        )
    return None


async def ensure_provider_governance_catalog(session: AsyncSession) -> list[PlatformBankProvider]:
    """Converge metadados técnicos sem transformar catálogo em driver.

    ``driver_installed`` representa a existência de pelo menos um executor real
    para o provider. Modos/capabilities apenas documentados ficam em
    ``source_metadata`` e nunca são apresentados como capacidade efetiva.
    """
    items: list[PlatformBankProvider] = []
    for manifest in banking_providers.manifests():
        code = manifest.code.upper()
        row = await session.scalar(select(PlatformBankProvider).where(PlatformBankProvider.code == code))
        is_new = row is None
        if row is None:
            row = PlatformBankProvider(
                code=code,
                display_name=manifest.name,
                globally_enabled=code in {"SANDBOX", "ASAAS"},
                tenant_visible=True,
            )
            session.add(row)

        institution = await _institution_for_manifest(session, manifest)
        provider = banking_providers.provider_or_none(code)
        documentation_hash, documentation_version, documentation_checked_at = _documentation_fingerprint(manifest)
        implemented_modes = manifest.effective_implemented_modes()
        driver_installed = bool(
            provider is not None
            and manifest.implementation_available
            and implemented_modes
        )
        effective_capabilities = manifest.capabilities if driver_installed else frozenset()

        row.institution_id = institution.id if institution else None
        row.display_name = manifest.name
        row.driver_installed = driver_installed
        row.driver_status = manifest.status.value
        row.driver_version = str(getattr(provider, "driver_version", "") or "") or None
        row.integration_modes = sorted(item.value for item in implemented_modes) if driver_installed else []
        row.capabilities = sorted(item.value for item in effective_capabilities)
        row.environments = sorted(item.value for item in manifest.environments) if driver_installed else []
        row.documentation_status = "PUBLIC_VERIFIED" if manifest.documentation else "INTERNAL"
        row.documentation_version = documentation_version
        row.documentation_checked_at = documentation_checked_at
        row.documentation_hash = documentation_hash
        row.source_metadata = {
            "manifest_implementation_available": bool(manifest.implementation_available),
            "requires_homologation": bool(manifest.requires_homologation),
            "catalog_integration_modes": sorted(item.value for item in manifest.integration_modes),
            "implemented_modes": sorted(item.value for item in implemented_modes),
            "catalog_capabilities": sorted(item.value for item in manifest.capabilities),
            "documentation": [
                {
                    "url": item.url,
                    "title": item.title,
                    "version": item.version,
                    "checked_at": item.checked_at.isoformat() if item.checked_at else None,
                }
                for item in manifest.documentation
            ],
        }

        # Catálogo sem executor nunca fica comercialmente liberado nem visível
        # ao tenant. Isso também corrige estados antigos persistidos na rc.27.
        if not driver_installed:
            row.globally_enabled = False
            row.tenant_visible = False
        elif is_new and code not in {"SANDBOX", "ASAAS"}:
            row.globally_enabled = False
            row.tenant_visible = True

        items.append(row)

    await session.flush()
    return items


def governance_dict(item: PlatformBankProvider, *, manifest: Any | None = None) -> dict[str, Any]:
    payload = manifest.public_dict() if manifest is not None else {}
    catalog_modes = (
        sorted(mode.value for mode in manifest.integration_modes)
        if manifest is not None
        else list((item.source_metadata or {}).get("catalog_integration_modes") or [])
    )
    implemented_modes = (
        sorted(mode.value for mode in manifest.effective_implemented_modes())
        if manifest is not None and item.driver_installed
        else []
    )
    catalog_capabilities = (
        sorted(capability.value for capability in manifest.capabilities)
        if manifest is not None
        else list((item.source_metadata or {}).get("catalog_capabilities") or [])
    )
    connection_driver_installed = bool(
        manifest is not None
        and item.driver_installed
        and BankingIntegrationMode.DIRECT_API in manifest.effective_implemented_modes()
    )
    payload.update(
        {
            "governance_id": str(item.id),
            "provider": item.code,
            "display_name": item.display_name,
            "driver_version": item.driver_version,
            "driver_status": item.driver_status,
            "driver_installed": item.driver_installed,
            "connection_driver_installed": connection_driver_installed,
            "globally_enabled": item.globally_enabled,
            "tenant_visible": item.tenant_visible,
            # Campos sem prefixo representam exclusivamente o que executa hoje.
            "integration_modes": implemented_modes,
            "implemented_modes": implemented_modes,
            "capabilities": list(item.capabilities or []),
            # Catálogo/documentação ficam separados e nunca significam liberação.
            "catalog_integration_modes": catalog_modes,
            "catalog_capabilities": catalog_capabilities,
            "documentation_status": item.documentation_status,
            "documentation_version": item.documentation_version,
            "documentation_checked_at": (
                item.documentation_checked_at.isoformat() if item.documentation_checked_at else None
            ),
            "documentation_hash": item.documentation_hash,
            "sandbox_verified_at": item.sandbox_verified_at.isoformat() if item.sandbox_verified_at else None,
            "homologation_verified_at": (
                item.homologation_verified_at.isoformat() if item.homologation_verified_at else None
            ),
            "production_verified_at": (
                item.production_verified_at.isoformat() if item.production_verified_at else None
            ),
            "last_health_check_at": item.last_health_check_at.isoformat() if item.last_health_check_at else None,
            "last_health_check_status": item.last_health_check_status,
            "notes": item.notes,
        }
    )
    return payload


async def _tenant(session: AsyncSession, tenant_id: UUID | str) -> Tenant:
    normalized = tenant_id if isinstance(tenant_id, UUID) else UUID(str(tenant_id))
    item = await session.get(Tenant, normalized)
    if item is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado no Control Plane.", 404)
    return item


async def _plan(session: AsyncSession, code: str) -> PlatformPlan:
    item = await session.scalar(select(PlatformPlan).where(PlatformPlan.code == code.upper()))
    if item is None:
        raise APIError("PLAN_NOT_FOUND", "Plano do tenant não existe no Control Plane.", 422)
    return item


async def resolve_provider_entitlement(
    session: AsyncSession,
    *,
    tenant_id: UUID | str,
    provider_code: str,
    ensure_catalog: bool = True,
) -> ProviderEntitlementDecision:
    if ensure_catalog:
        await ensure_provider_governance_catalog(session)
    provider = provider_code.strip().upper()
    governance = await session.scalar(
        select(PlatformBankProvider).where(PlatformBankProvider.code == provider)
    )
    if governance is None:
        raise APIError("BANKING_PROVIDER_UNKNOWN", "Provider bancário não existe no catálogo.", 404)

    tenant = await _tenant(session, tenant_id)
    plan = await _plan(session, tenant.plan_code)
    plan_policy = await session.scalar(
        select(PlanBankProviderPolicy).where(PlanBankProviderPolicy.plan_id == plan.id)
    )
    plan_mode = plan_policy.mode if plan_policy else "ALL"
    selected = False
    if plan_policy is not None and plan_mode == "SELECTED":
        selected = bool(
            await session.scalar(
                select(PlanBankProviderRule.allowed).where(
                    PlanBankProviderRule.policy_id == plan_policy.id,
                    PlanBankProviderRule.provider_code == provider,
                )
            )
        )

    override = await session.scalar(
        select(TenantBankProviderOverride.action).where(
            TenantBankProviderOverride.tenant_id == tenant.id,
            TenantBankProviderOverride.provider_code == provider,
        )
    )
    allowed, source = evaluate_provider_entitlement(
        driver_installed=governance.driver_installed,
        globally_enabled=governance.globally_enabled,
        tenant_visible=governance.tenant_visible,
        tenant_override=override,
        plan_mode=plan_mode,
        selected_by_plan=selected,
    )
    return ProviderEntitlementDecision(
        provider=provider,
        allowed=allowed,
        source=source,
        driver_status=governance.driver_status,
        driver_installed=governance.driver_installed,
        globally_enabled=governance.globally_enabled,
        tenant_visible=governance.tenant_visible,
        plan_mode=plan_mode,
        tenant_override=override,
        operationally_allowed=allowed,
    )


async def require_provider_entitlement(
    session: AsyncSession,
    *,
    tenant_id: UUID | str,
    provider_code: str,
) -> ProviderEntitlementDecision:
    decision = await resolve_provider_entitlement(
        session,
        tenant_id=tenant_id,
        provider_code=provider_code,
    )
    if decision.operational_allowed:
        return decision
    if decision.source == "DRIVER_UNAVAILABLE":
        raise APIError(
            "BANKING_PROVIDER_NOT_AVAILABLE",
            "O provider está catalogado, porém o driver executável não está instalado.",
            422,
            decision.public_dict(),
        )
    raise APIError(
        "BANKING_PROVIDER_NOT_ENTITLED",
        "Este provider bancário não está liberado para o tenant.",
        403,
        decision.public_dict(),
    )


async def tenant_provider_decisions(
    session: AsyncSession,
    *,
    tenant_id: UUID | str,
) -> list[ProviderEntitlementDecision]:
    """Retorna decisões para descoberta/UI sem alterar autorização operacional.

    Provider oculto pelo Control Plane recebe ``allowed=False`` e fonte
    ``TENANT_HIDDEN`` apenas nesta visão de descoberta. O campo público
    ``operationally_allowed`` preserva a decisão real usada por conexões já
    existentes e por operações server-side.
    """
    await ensure_provider_governance_catalog(session)
    decisions: list[ProviderEntitlementDecision] = []
    for manifest in banking_providers.manifests():
        decision = await resolve_provider_entitlement(
            session,
            tenant_id=tenant_id,
            provider_code=manifest.code,
            ensure_catalog=False,
        )
        if decision.operational_allowed and not decision.tenant_visible:
            decision = replace(
                decision,
                allowed=False,
                source="TENANT_HIDDEN",
                operationally_allowed=True,
            )
        decisions.append(decision)
    return decisions


async def read_plan_policy(session: AsyncSession, *, plan: PlatformPlan) -> dict[str, Any]:
    policy = await session.scalar(
        select(PlanBankProviderPolicy).where(PlanBankProviderPolicy.plan_id == plan.id)
    )
    if policy is None:
        return {"plan_code": plan.code, "mode": "ALL", "providers": [], "implicit": True}
    selected = list(
        (
            await session.scalars(
                select(PlanBankProviderRule.provider_code).where(
                    PlanBankProviderRule.policy_id == policy.id,
                    PlanBankProviderRule.allowed.is_(True),
                )
            )
        ).all()
    )
    return {
        "plan_code": plan.code,
        "mode": policy.mode,
        "providers": sorted(selected),
        "implicit": False,
    }


async def replace_plan_policy(
    session: AsyncSession,
    *,
    plan: PlatformPlan,
    mode: str,
    providers: list[str],
) -> PlanBankProviderPolicy:
    await ensure_provider_governance_catalog(session)
    normalized_mode = mode.upper()
    normalized_providers = list(dict.fromkeys(code.strip().upper() for code in providers if code.strip()))
    if normalized_mode not in {"ALL", "SELECTED", "NONE"}:
        raise APIError("BANK_PROVIDER_POLICY_INVALID", "Política bancária do plano é inválida.", 422)

    rows = list((await session.scalars(select(PlatformBankProvider))).all())
    by_code = {row.code: row for row in rows}
    unknown = sorted(set(normalized_providers) - set(by_code))
    if unknown:
        raise APIError(
            "BANKING_PROVIDER_UNKNOWN",
            "Há providers inexistentes na política do plano.",
            422,
            {"providers": unknown},
        )
    unavailable = sorted(
        code for code in normalized_providers if not by_code[code].driver_installed
    )
    if unavailable:
        raise APIError(
            "BANKING_PROVIDER_NOT_AVAILABLE",
            "Plano não pode liberar provider que existe apenas no catálogo e não possui executor real.",
            409,
            {"providers": unavailable},
        )

    policy = await session.scalar(
        select(PlanBankProviderPolicy).where(PlanBankProviderPolicy.plan_id == plan.id)
    )
    if policy is None:
        policy = PlanBankProviderPolicy(plan_id=plan.id, mode=normalized_mode)
        session.add(policy)
        await session.flush()
    else:
        policy.mode = normalized_mode

    await session.execute(delete(PlanBankProviderRule).where(PlanBankProviderRule.policy_id == policy.id))
    if normalized_mode == "SELECTED":
        for code in normalized_providers:
            session.add(PlanBankProviderRule(policy_id=policy.id, provider_code=code, allowed=True))
    await session.flush()
    return policy


async def read_tenant_policy(session: AsyncSession, *, tenant: Tenant) -> dict[str, Any]:
    policy = await session.scalar(
        select(TenantBankProviderPolicy).where(TenantBankProviderPolicy.tenant_id == tenant.id)
    )
    overrides = list(
        (
            await session.execute(
                select(TenantBankProviderOverride.provider_code, TenantBankProviderOverride.action)
                .where(TenantBankProviderOverride.tenant_id == tenant.id)
                .order_by(TenantBankProviderOverride.provider_code)
            )
        ).all()
    )
    return {
        "tenant_id": str(tenant.id),
        "mode": policy.mode if policy else "INHERIT",
        "overrides": [{"provider": code, "action": action} for code, action in overrides],
        "implicit": policy is None,
    }


async def replace_tenant_policy(
    session: AsyncSession,
    *,
    tenant: Tenant,
    mode: str,
    overrides: list[tuple[str, str]],
) -> TenantBankProviderPolicy:
    await ensure_provider_governance_catalog(session)
    normalized_mode = mode.upper()
    normalized_overrides = [
        (provider.strip().upper(), action.strip().upper())
        for provider, action in overrides
        if provider.strip()
    ]
    if normalized_mode not in {"INHERIT", "CUSTOM"}:
        raise APIError("BANK_PROVIDER_POLICY_INVALID", "Política bancária do tenant é inválida.", 422)

    rows = list((await session.scalars(select(PlatformBankProvider))).all())
    by_code = {row.code: row for row in rows}
    unknown = sorted({code for code, _ in normalized_overrides} - set(by_code))
    if unknown:
        raise APIError(
            "BANKING_PROVIDER_UNKNOWN",
            "Há providers inexistentes nos overrides do tenant.",
            422,
            {"providers": unknown},
        )

    unavailable_allow = sorted(
        code
        for code, action in normalized_overrides
        if action == "ALLOW" and not by_code[code].driver_installed
    )
    if unavailable_allow:
        raise APIError(
            "BANKING_PROVIDER_NOT_AVAILABLE",
            "Tenant não pode receber ALLOW para provider sem executor real.",
            409,
            {"providers": unavailable_allow},
        )

    policy = await session.scalar(
        select(TenantBankProviderPolicy).where(TenantBankProviderPolicy.tenant_id == tenant.id)
    )
    if policy is None:
        policy = TenantBankProviderPolicy(tenant_id=tenant.id, mode=normalized_mode)
        session.add(policy)
    else:
        policy.mode = normalized_mode

    await session.execute(
        delete(TenantBankProviderOverride).where(TenantBankProviderOverride.tenant_id == tenant.id)
    )
    if normalized_mode == "CUSTOM":
        for provider, normalized_action in normalized_overrides:
            if normalized_action not in {"ALLOW", "DENY", "INHERIT"}:
                raise APIError(
                    "BANK_PROVIDER_OVERRIDE_INVALID",
                    "Override bancário do tenant é inválido.",
                    422,
                    {"provider": provider, "action": normalized_action},
                )
            if normalized_action != "INHERIT":
                session.add(
                    TenantBankProviderOverride(
                        tenant_id=tenant.id,
                        provider_code=provider,
                        action=normalized_action,
                    )
                )
    await session.flush()
    return policy
