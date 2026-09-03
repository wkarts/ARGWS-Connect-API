from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import ORJSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.platform import get_platform_session
from app.services.branding import NEUTRAL_BRAND, resolve_branding_by_hostname

router = APIRouter(prefix="/api/v1/public/branding", tags=["Public Branding"])


async def _resolve(request: Request, session: AsyncSession) -> dict:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.hostname or ""
    branding = await resolve_branding_by_hostname(session, host)
    return branding or dict(NEUTRAL_BRAND)


@router.get("", include_in_schema=False)
async def branding_json(request: Request, session: AsyncSession = Depends(get_platform_session)) -> ORJSONResponse:
    return ORJSONResponse(content=await _resolve(request, session), headers={"Cache-Control": "no-store"})


@router.get("/bootstrap.js", include_in_schema=False)
async def branding_bootstrap(request: Request, session: AsyncSession = Depends(get_platform_session)) -> Response:
    branding = await _resolve(request, session)
    body = "window.__CONNECT_API_BOOTSTRAP__=" + json.dumps({"branding": branding}, ensure_ascii=False, separators=(",", ":")) + ";"
    return Response(content=body, media_type="application/javascript", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/manifest.webmanifest", include_in_schema=False)
async def branding_manifest(request: Request, session: AsyncSession = Depends(get_platform_session)) -> ORJSONResponse:
    brand = await _resolve(request, session)
    icons = []
    if brand.get("pwa_icon_192_url"):
        icons.append({"src": brand["pwa_icon_192_url"], "sizes": "192x192", "type": "image/png", "purpose": "any"})
    if brand.get("pwa_icon_512_url"):
        icons.append({"src": brand["pwa_icon_512_url"], "sizes": "512x512", "type": "image/png", "purpose": "any maskable"})
    return ORJSONResponse(content={
        "name": brand.get("manifest_name") or "Application",
        "short_name": brand.get("manifest_short_name") or "App",
        "start_url": "/", "scope": "/", "display": "standalone",
        "background_color": brand.get("background_color") or "#F8FAFC",
        "theme_color": brand.get("primary_color") or "#475569",
        "icons": icons,
    }, media_type="application/manifest+json", headers={"Cache-Control": "no-store"})
