from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.errors import APIError
from app.models.platform import BrandingProfile, Partner, Tenant, TenantDomain

HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")

PLATFORM_BRAND: dict[str, Any] = {
    "scope": "PLATFORM",
    "owner_id": None,
    "version": 1,
    "name": "Connect|API Platform",
    "short_name": "Connect|API",
    "logo_light_url": "/brand/connect-api-platform.png",
    "logo_dark_url": "/brand/connect-api-platform-dark.png",
    "favicon_url": "/favicon.ico",
    "apple_touch_icon_url": "/apple-touch-icon.png",
    "pwa_icon_192_url": "/icons/icon-192.png",
    "pwa_icon_512_url": "/icons/icon-512.png",
    "primary_color": "#2563EB",
    "accent_color": "#06B6D4",
    "background_color": "#F8FAFC",
    "surface_color": "#FFFFFF",
    "text_color": "#0F172A",
    "manifest_name": "Connect|API Platform",
    "manifest_short_name": "Connect|API",
    "resolved": True,
}

NEUTRAL_BRAND: dict[str, Any] = {
    "scope": "NEUTRAL", "owner_id": None, "version": 0, "name": "", "short_name": "",
    "logo_light_url": None, "logo_dark_url": None, "favicon_url": None, "apple_touch_icon_url": None,
    "pwa_icon_192_url": None, "pwa_icon_512_url": None, "primary_color": "#475569", "accent_color": "#64748B",
    "background_color": "#F8FAFC", "surface_color": "#FFFFFF", "text_color": "#0F172A",
    "manifest_name": "Application", "manifest_short_name": "App", "resolved": False,
}


def normalize_hostname(value: str) -> str:
    host = value.split(",", 1)[0].strip().lower().rstrip(".")
    if host.startswith("[") and "]" in host:
        return host[1:host.index("]")]
    if ":" in host:
        host = host.rsplit(":", 1)[0]
    return host


def validate_asset_url(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if value.startswith("/") and not value.startswith("//"):
        return value
    if value.lower().startswith("https://"):
        return value
    raise APIError("BRANDING_ASSET_URL_INVALID", "Assets de branding devem usar HTTPS ou caminho same-origin.", 422)


def validate_color(value: str) -> str:
    if not HEX_COLOR.fullmatch(value or ""):
        raise APIError("BRANDING_COLOR_INVALID", "Cor de branding deve usar formato HEX #RRGGBB.", 422)
    return value.upper()


def serialize_profile(profile: BrandingProfile, *, scope: str | None = None) -> dict[str, Any]:
    version = int(profile.version)
    def versioned(url: str | None) -> str | None:
        if not url:
            return None
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}brand_v={version}"
    return {
        "scope": scope or profile.owner_type, "owner_id": str(profile.owner_id), "version": version,
        "name": profile.name, "short_name": profile.short_name or profile.name[:30],
        "logo_light_url": versioned(profile.logo_light_url), "logo_dark_url": versioned(profile.logo_dark_url),
        "favicon_url": versioned(profile.favicon_url), "apple_touch_icon_url": versioned(profile.apple_touch_icon_url),
        "pwa_icon_192_url": versioned(profile.pwa_icon_192_url), "pwa_icon_512_url": versioned(profile.pwa_icon_512_url),
        "primary_color": profile.primary_color, "accent_color": profile.accent_color,
        "background_color": profile.background_color, "surface_color": profile.surface_color, "text_color": profile.text_color,
        "manifest_name": profile.manifest_name or profile.name,
        "manifest_short_name": profile.manifest_short_name or profile.short_name or profile.name[:30],
        "resolved": True,
    }


async def _published_profile(session: AsyncSession, profile_id: UUID | None) -> BrandingProfile | None:
    if not profile_id:
        return None
    profile = await session.get(BrandingProfile, profile_id)
    if profile is None or profile.status != "PUBLISHED":
        return None
    return profile


async def resolve_partner_branding(session: AsyncSession, partner: Partner) -> dict[str, Any]:
    if partner.branding_mode == "CUSTOM":
        profile = await _published_profile(session, partner.branding_profile_id)
        if profile is not None:
            return serialize_profile(profile, scope="PARTNER")
    return dict(PLATFORM_BRAND)


async def resolve_tenant_branding(session: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    if tenant.partner_id:
        partner = tenant.partner or await session.get(Partner, tenant.partner_id)
        if partner is not None:
            return await resolve_partner_branding(session, partner)
        return dict(PLATFORM_BRAND)
    if tenant.branding_mode == "CUSTOM":
        profile = await _published_profile(session, tenant.branding_profile_id)
        if profile is not None:
            return serialize_profile(profile, scope="TENANT")
    return dict(PLATFORM_BRAND)


def _is_platform_hostname(hostname: str) -> bool:
    host = normalize_hostname(hostname)
    platform_hosts = {
        normalize_hostname(settings.control_plane_host),
        normalize_hostname(settings.api_host),
        normalize_hostname(settings.platform_domain),
        "localhost", "127.0.0.1", "connect-api",
    }
    return host in platform_hosts or host.startswith("control.") or host.startswith("admin.")


async def resolve_branding_by_hostname(session: AsyncSession, hostname: str) -> dict[str, Any] | None:
    host = normalize_hostname(hostname)
    if _is_platform_hostname(host):
        return dict(PLATFORM_BRAND)

    partner = await session.scalar(select(Partner).where(Partner.hostname == host, Partner.status == "ACTIVE"))
    if partner is not None:
        return await resolve_partner_branding(session, partner)

    tenant = await session.scalar(
        select(Tenant)
        .join(TenantDomain, TenantDomain.tenant_id == Tenant.id)
        .where(TenantDomain.hostname == host)
        .options(selectinload(Tenant.partner))
    )
    if tenant is not None:
        return await resolve_tenant_branding(session, tenant)

    suffix = normalize_hostname(settings.tenant_domain_root)
    if suffix and (host == suffix or host.endswith(f".{suffix}")):
        return dict(PLATFORM_BRAND)
    return None


async def create_draft(session: AsyncSession, *, owner_type: str, owner_id: UUID, payload: dict[str, Any]) -> BrandingProfile:
    owner_type = owner_type.upper()
    if owner_type not in {"PARTNER", "TENANT"}:
        raise APIError("BRANDING_OWNER_INVALID", "Owner de branding inválido.", 422)
    if owner_type == "PARTNER":
        owner = await session.get(Partner, owner_id)
    else:
        owner = await session.get(Tenant, owner_id)
        if owner is not None and owner.partner_id is not None:
            raise APIError("TENANT_BRANDING_INHERITED", "Tenant vinculado a Partner deve herdar a identidade do Partner.", 409)
    if owner is None:
        raise APIError("BRANDING_OWNER_NOT_FOUND", "Owner de branding não encontrado.", 404)

    next_version = (await session.scalar(
        select(func.coalesce(func.max(BrandingProfile.version), 0) + 1).where(
            BrandingProfile.owner_type == owner_type, BrandingProfile.owner_id == owner_id
        )
    )) or 1
    data = dict(payload)
    for field in ("logo_light_url", "logo_dark_url", "favicon_url", "apple_touch_icon_url", "pwa_icon_192_url", "pwa_icon_512_url"):
        data[field] = validate_asset_url(data.get(field))
    for field in ("primary_color", "accent_color", "background_color", "surface_color", "text_color"):
        data[field] = validate_color(data[field])
    profile = BrandingProfile(owner_type=owner_type, owner_id=owner_id, version=int(next_version), status="DRAFT", **data)
    session.add(profile)
    await session.flush()
    return profile


async def publish_profile(session: AsyncSession, profile: BrandingProfile) -> None:
    if profile.status not in {"DRAFT", "ARCHIVED"}:
        if profile.status == "PUBLISHED":
            return
        raise APIError("BRANDING_PROFILE_STATE_INVALID", "Perfil não pode ser publicado neste estado.", 409)
    if profile.owner_type == "PARTNER":
        owner = await session.get(Partner, profile.owner_id)
    elif profile.owner_type == "TENANT":
        owner = await session.get(Tenant, profile.owner_id)
        if owner is not None and owner.partner_id is not None:
            raise APIError("TENANT_BRANDING_INHERITED", "Tenant vinculado a Partner deve herdar a identidade do Partner.", 409)
    else:
        owner = None
    if owner is None:
        raise APIError("BRANDING_OWNER_NOT_FOUND", "Owner de branding não encontrado.", 404)

    previous = await session.scalars(select(BrandingProfile).where(
        BrandingProfile.owner_type == profile.owner_type, BrandingProfile.owner_id == profile.owner_id,
        BrandingProfile.status == "PUBLISHED", BrandingProfile.id != profile.id
    ))
    now = datetime.now(UTC)
    for item in previous:
        item.status = "ARCHIVED"
        item.archived_at = now
    profile.status = "PUBLISHED"
    profile.published_at = now
    profile.archived_at = None
    owner.branding_mode = "CUSTOM"
    owner.branding_profile_id = profile.id


async def use_platform_brand(session: AsyncSession, *, owner_type: str, owner_id: UUID) -> None:
    owner_type = owner_type.upper()
    if owner_type == "PARTNER":
        owner = await session.get(Partner, owner_id)
        if owner is None:
            raise APIError("PARTNER_NOT_FOUND", "Partner não encontrado.", 404)
        owner.branding_mode = "PLATFORM"
        owner.branding_profile_id = None
        return
    if owner_type == "TENANT":
        owner = await session.get(Tenant, owner_id)
        if owner is None:
            raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
        if owner.partner_id is not None:
            raise APIError("TENANT_BRANDING_INHERITED", "Tenant vinculado a Partner deve herdar a identidade do Partner.", 409)
        owner.branding_mode = "INHERIT"
        owner.branding_profile_id = None
        return
    raise APIError("BRANDING_OWNER_INVALID", "Owner de branding inválido.", 422)
