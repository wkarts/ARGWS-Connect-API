from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import ORJSONResponse

from app.api.deps import current_tenant_user, get_tenant_context_dep
from app.core.config import settings
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.models.platform import Tenant
from app.services.branding import resolve_tenant_branding
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/api/v1", tags=["Connect|API Platform"])

async def _tenant_branding(context: TenantContext) -> dict:
    async with PlatformSessionLocal() as session:
        tenant = await session.get(Tenant, UUID(context.tenant_id))
        if tenant is None:
            return {}
        return await resolve_tenant_branding(session, tenant)

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
