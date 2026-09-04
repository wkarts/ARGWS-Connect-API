from __future__ import annotations

import asyncio
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.api.deps import get_redis
from app.core.config import settings
from app.db.platform import get_platform_session
from app.models.landing import PlatformLandingPage
from app.models.platform import PlatformPlan, PlatformSetting
from app.providers.storage import S3StorageProvider
from app.schemas.common import HealthResponse, SuccessResponse
from app.services.landing_builder import default_document

router = APIRouter(tags=["Health"])


@router.get("/health/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, checks={"process": "ok"})


@router.get("/health/ready", response_model=HealthResponse)
async def ready(
    response: Response,
    session: AsyncSession = Depends(get_platform_session),
    redis: Redis = Depends(get_redis),
) -> HealthResponse:
    checks: dict[str, str] = {}
    status = "ok"
    try:
        await session.execute(text("select 1"))
        checks["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["postgres"] = f"error:{type(exc).__name__}"
        status = "error"
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error:{type(exc).__name__}"
        status = "error"
    try:
        broker = urlparse(settings.rabbitmq_url)
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(broker.hostname or "connect-rabbitmq", broker.port or 5672), timeout=3
        )
        del reader
        writer.close()
        await writer.wait_closed()
        checks["rabbitmq"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["rabbitmq"] = f"error:{type(exc).__name__}"
        status = "error"
    try:
        await asyncio.wait_for(S3StorageProvider().healthcheck(), timeout=3)
        checks["s3"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["s3"] = f"error:{type(exc).__name__}"
        status = "error"
    if status != "ok":
        response.status_code = 503
    return HealthResponse(status=status, version=__version__, checks=checks)


@router.get("/health", response_model=HealthResponse)
async def health(
    response: Response,
    session: AsyncSession = Depends(get_platform_session),
    redis: Redis = Depends(get_redis),
) -> HealthResponse:
    return await ready(response, session, redis)


@router.get("/api/public/platform/landing", response_model=SuccessResponse[dict])
async def public_landing_configuration(
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    """Entrega somente a versão publicada do documento comercial.

    O builder não publica URLs administrativas, credenciais, providers ou
    detalhes da infraestrutura. Blocos HTML são saneados no momento do save e
    da publicação; JavaScript arbitrário não faz parte do contrato público.
    """
    page = await session.scalar(select(PlatformLandingPage).where(PlatformLandingPage.key == "PUBLIC"))
    if page is not None and page.published_document:
        enabled = bool(page.enabled)
        document = dict(page.published_document or {})
        custom_css = page.published_css or ""
        revision = page.published_revision
        published_at = page.published_at.isoformat() if page.published_at else None
    else:
        legacy_item = await session.scalar(select(PlatformSetting).where(PlatformSetting.key == "PUBLIC.LANDING"))
        legacy = dict(legacy_item.value or {}) if legacy_item else {}
        enabled = bool(legacy.get("enabled", True))
        document = default_document(legacy)
        custom_css = ""
        revision = None
        published_at = None

    rows = list((await session.scalars(
        select(PlatformPlan)
        .where(PlatformPlan.is_active.is_(True), PlatformPlan.is_public.is_(True))
        .order_by(PlatformPlan.sort_order, PlatformPlan.name)
    )).all())
    plans = [
        {
            "name": plan.name,
            "description": plan.description or "",
            "monthly_price": str(plan.monthly_price),
            "annual_price": str(plan.annual_price),
        }
        for plan in rows
    ]
    return SuccessResponse(data={
        "enabled": enabled,
        "document": document,
        "custom_css": custom_css,
        "published_revision": revision,
        "published_at": published_at,
        "plans": plans,
    })


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    if not settings.prometheus_enabled:
        return Response(status_code=404)
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
