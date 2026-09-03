from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.deps import get_tenant_context_dep
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.models.platform import Tenant
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/api/v1/public", tags=["Área pública"])


def safe_external_url(value: object) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return url


@router.get("/site", response_model=SuccessResponse[dict])
async def tenant_public_site(
    context: TenantContext = Depends(get_tenant_context_dep),
) -> SuccessResponse[dict]:
    async with PlatformSessionLocal() as session:
        tenant = await session.get(Tenant, UUID(context.tenant_id))

    features = dict(tenant.features or {}) if tenant else {}
    mode = str(features.get("landing_mode") or "DISABLED").upper()
    if mode not in {"DISABLED", "PLATFORM", "EXTERNAL"}:
        mode = "DISABLED"

    return SuccessResponse(
        data={
            "name": tenant.name if tenant else context.slug,
            "hostname": context.hostname,
            "demo_mode": bool(features.get("demo_mode", False)),
            "landing": {
                "mode": mode,
                "url": safe_external_url(features.get("landing_url")) if mode == "EXTERNAL" else "",
                "title": str(features.get("landing_title") or (tenant.name if tenant else context.slug)),
                "subtitle": str(features.get("landing_subtitle") or "Gestão financeira, cobranças e recebíveis em um só lugar."),
                "cta_label": str(features.get("landing_cta_label") or "Acessar área financeira"),
                "cta_url": str(features.get("landing_cta_url") or "/login"),
            },
        }
    )
