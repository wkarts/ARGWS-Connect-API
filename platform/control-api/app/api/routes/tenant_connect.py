from __future__ import annotations

import re
import hmac
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field, SecretStr, field_validator
from sqlalchemy import func, select

from app.api.deps import current_tenant_user, get_tenant_context_dep, require_permission
from app.core.config import settings
from app.core.secrets import secret_cipher
from app.services.entitlements import load_tenant_entitlements
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.models.platform import EngineBinding, Tenant
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.schemas.connect_engine import INSTANCE_ALIAS_RE
from app.services.audit import platform_audit
from app.services.branding import resolve_tenant_branding
from app.services.connect_engine import connect_engine

router = APIRouter(prefix="/api/v1", tags=["Connect|API Platform"])


class EngineInstanceAdopt(BaseModel):
    instance_name: str = Field(min_length=1, max_length=180)
    instance_token: SecretStr = Field(min_length=12, max_length=512)
    alias: str | None = Field(default=None, min_length=2, max_length=49)

    @field_validator("instance_name")
    @classmethod
    def valid_instance_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(char in normalized for char in "\r\n\x00/\\?#%"):
            raise ValueError("Nome de instância inválido.")
        return normalized

    @field_validator("alias")
    @classmethod
    def valid_alias(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not INSTANCE_ALIAS_RE.fullmatch(normalized):
            raise ValueError("Use apenas letras minúsculas, números, '_' ou '-', começando por letra/número.")
        return normalized


async def _tenant_branding(context: TenantContext) -> dict:
    async with PlatformSessionLocal() as session:
        tenant = await session.get(Tenant, UUID(context.tenant_id))
        if tenant is None:
            return {}
        return await resolve_tenant_branding(session, tenant)


def _suggest_alias(instance_name: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", instance_name.lower()).strip("-_")[:49]
    if len(value) < 2:
        return "instance"
    return value


def _engine_instance_rows(payload: object) -> list[dict[str, Any]]:
    """Return a safe, secret-free view of Engine instances.

    `/instance/fetchInstances` currently returns a list of Prisma instance rows.
    The bridge intentionally copies only fields required for adoption so tokens,
    webhook credentials and provider internals never cross the Platform API.
    """

    if isinstance(payload, dict):
        candidate = payload.get("instances") or payload.get("data") or payload.get("response")
        source = candidate if isinstance(candidate, list) else []
    elif isinstance(payload, list):
        source = payload
    else:
        source = []

    result: list[dict[str, Any]] = []
    for raw in source:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or raw.get("instanceName") or "").strip()
        if not name:
            continue
        counts = raw.get("_count") if isinstance(raw.get("_count"), dict) else {}
        result.append(
            {
                "instance_name": name,
                "engine_id": str(raw.get("id") or raw.get("instanceId") or "") or None,
                "provider": str(raw.get("integration") or raw.get("provider") or "WHATSAPP-BAILEYS"),
                "state": str(raw.get("connectionStatus") or raw.get("state") or "") or None,
                "number": str(raw.get("number") or "") or None,
                "profile_name": str(raw.get("profileName") or "") or None,
                "owner_jid": str(raw.get("ownerJid") or "") or None,
                "counts": {
                    "messages": int(counts.get("Message") or 0),
                    "contacts": int(counts.get("Contact") or 0),
                    "chats": int(counts.get("Chat") or 0),
                },
                "suggested_alias": _suggest_alias(name),
            }
        )
    return result


@router.get("/context", response_model=SuccessResponse[dict])
async def tenant_context(
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(current_tenant_user),
) -> SuccessResponse[dict]:
    return SuccessResponse(data={
        "tenant_id": context.tenant_id, "slug": context.slug, "hostname": context.hostname,
        "timezone": context.timezone, "branding": await _tenant_branding(context),
    })


@router.get("/connect/capabilities", response_model=SuccessResponse[dict])
async def connect_capabilities(
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(current_tenant_user),
) -> SuccessResponse[dict]:
    return SuccessResponse(data={
        "product": "Connect|API Platform", "tenant_id": context.tenant_id,
        "modules": ["channels","instances","messages","events","webhooks","automations","integrations","pbx","voip"],
        "reference_financial_domain_enabled": settings.enable_reference_financial_domain,
    })


@router.get("/connect/instances/discover", response_model=SuccessResponse[dict])
async def discover_existing_engine_instances(
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("instances.read")),
) -> SuccessResponse[dict]:
    # Unbound Engine instances are not public inventory for all customers.
    async with PlatformSessionLocal() as session:
        bindings = list((await session.scalars(select(EngineBinding).where(
            EngineBinding.tenant_id == UUID(context.tenant_id)))).all())

    adopted = [
        {
            "binding_id": str(item.id),
            "instance_name": item.instance_name,
        }
        for item in bindings
        if str(item.tenant_id) == context.tenant_id
        and (item.metadata_json or {}).get("origin") == "ADOPTED_EXISTING"
    ]
    return SuccessResponse(data={"available": [], "adopted": adopted, "ownership_proof_required": True})


@router.post("/connect/instances/adopt", response_model=SuccessResponse[dict], status_code=201)
async def adopt_existing_engine_instance(
    payload: EngineInstanceAdopt,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    token = payload.instance_token.get_secret_value()
    if hmac.compare_digest(token.encode(), settings.connect_engine_api_key.encode()):
        raise APIError("ENGINE_INSTANCE_PROOF_REQUIRED", "Utilize a chave individual da instância, não a chave global.", 422)
    try:
        rows = await connect_engine.request("GET", "/instance/fetchInstances", params={"instanceName": payload.instance_name}, api_key=token)
    except APIError as exc:
        if exc.code == "ENGINE_CREDENTIAL_REJECTED":
            raise APIError("ENGINE_INSTANCE_PROOF_INVALID", "A chave não comprova acesso à instância informada.", 403) from exc
        raise
    engine_item = next((row for row in _engine_instance_rows(rows) if row["instance_name"] == payload.instance_name), None)
    if engine_item is None:
        raise APIError("ENGINE_INSTANCE_PROOF_INVALID", "A chave não comprova acesso à instância informada.", 403)
    alias = payload.alias or str(engine_item["suggested_alias"])
    async with PlatformSessionLocal() as session:
        await session.scalar(select(Tenant).where(Tenant.id == UUID(context.tenant_id)).with_for_update())
        entitlement = await load_tenant_entitlements(session, context.tenant_id)
        entitlement.require_feature("instances")
        count = await session.scalar(select(func.count()).select_from(EngineBinding).where(EngineBinding.tenant_id == UUID(context.tenant_id)))
        entitlement.enforce_limit("instances", count or 0)
        existing = await session.scalar(
            select(EngineBinding).where(EngineBinding.instance_name == payload.instance_name)
        )
        if existing is not None:
            if str(existing.tenant_id) == context.tenant_id:
                raise APIError("ENGINE_BINDING_EXISTS", "Esta instância já pertence a este tenant.", 409)
            raise APIError("ENGINE_INSTANCE_ALREADY_BOUND", "Esta instância já pertence a outro tenant.", 409)

        alias_conflict = await session.scalar(
            select(EngineBinding).where(
                EngineBinding.tenant_id == UUID(context.tenant_id),
                EngineBinding.alias == alias,
            )
        )
        if alias_conflict is not None:
            raise APIError("ENGINE_ALIAS_EXISTS", "Já existe uma instância com este alias neste tenant.", 409)

        item = EngineBinding(
            tenant_id=UUID(context.tenant_id),
            alias=alias,
            instance_name=payload.instance_name,
            provider=str(engine_item["provider"]),
            status="ADOPTED",
            last_state=engine_item.get("state"),
            last_seen_at=datetime.now(UTC),
            metadata_json={
                "ownership_token": secret_cipher.encrypt(token),
                "origin": "ADOPTED_EXISTING",
                "adopted_by": user.id,
                "engine_id": engine_item.get("engine_id"),
                "adopted_without_engine_mutation": True,
            },
        )
        session.add(item)
        await session.flush()
        await platform_audit(
            session,
            action="connect.engine.instance.adopt",
            entity_type="EngineBinding",
            entity_id=str(item.id),
            actor_id=user.id,
            tenant_id=context.tenant_id,
            after={
                "alias": item.alias,
                "instance_name": item.instance_name,
                "provider": item.provider,
                "origin": "ADOPTED_EXISTING",
            },
        )
        await session.commit()
        await session.refresh(item)

    return SuccessResponse(
        data={
            "id": str(item.id),
            "alias": item.alias,
            "instance_name": item.instance_name,
            "provider": item.provider,
            "state": item.last_state,
            "origin": "ADOPTED_EXISTING",
            "engine_mutated": False,
        }
    )


@router.delete("/connect/instances/{binding_id}/detach", response_model=SuccessResponse[dict])
async def detach_adopted_engine_instance(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    async with PlatformSessionLocal() as session:
        item = await session.get(EngineBinding, binding_id)
        if item is None or str(item.tenant_id) != context.tenant_id:
            raise APIError("ENGINE_BINDING_NOT_FOUND", "Instância não encontrada para este tenant.", 404)
        if (item.metadata_json or {}).get("origin") != "ADOPTED_EXISTING":
            raise APIError(
                "ENGINE_BINDING_NOT_ADOPTED",
                "Somente instâncias adotadas podem ser desvinculadas sem remover o Engine.",
                409,
            )
        before = {
            "alias": item.alias,
            "instance_name": item.instance_name,
            "provider": item.provider,
            "origin": "ADOPTED_EXISTING",
        }
        instance_name = item.instance_name
        await platform_audit(
            session,
            action="connect.engine.instance.detach",
            entity_type="EngineBinding",
            entity_id=str(item.id),
            actor_id=user.id,
            tenant_id=context.tenant_id,
            before=before,
        )
        await session.delete(item)
        await session.commit()

    return SuccessResponse(data={"detached": True, "instance_name": instance_name, "engine_mutated": False})


@router.get("/manifest.webmanifest", include_in_schema=False)
async def manifest(context: TenantContext = Depends(get_tenant_context_dep)) -> ORJSONResponse:
    branding = await _tenant_branding(context)
    name = str(branding.get("manifest_name") or branding.get("name") or "Application")
    return ORJSONResponse(content={
        "name": name, "short_name": name[:30], "description": "Connect|API Platform — Communication & Integration Platform",
        "start_url": "/", "scope": "/", "display": "standalone",
        "background_color": "#F8FAFC", "theme_color": branding.get("primary_color") or "#475569",
        "icons": [
            {"src": branding.get("pwa_icon_192_url") or "/icons/icon-192.png", "sizes":"192x192","type":"image/png","purpose":"any"},
            {"src": branding.get("pwa_icon_512_url") or "/icons/icon-512.png", "sizes":"512x512","type":"image/png","purpose":"any maskable"},
        ],
    }, media_type="application/manifest+json")
