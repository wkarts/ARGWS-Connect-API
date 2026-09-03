from __future__ import annotations

import time
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import ORJSONResponse
from starlette.responses import JSONResponse

from app import __version__
from app.api.deps import close_redis
from app.api.routes import (
    audit_details,
    control_auth,
    control_branding,
    control_landing,
    control_management,
    control_observability,
    control_operations,
    control_provisioning,
    control_resources,
    control_tenants,
    control_whatsapp,
    health,
    public_branding,
    tenant_admin,
    tenant_auth,
    tenant_connect,
    tenant_engine,
    tenant_observability,
    tenant_platform_services,
    tenant_public,
    tenant_registry,
    tenant_security,
    webhooks,
)
from app.core.config import settings

if settings.enable_reference_financial_domain:
    from app.api.routes import (
        control_banking,
        public_finance,
        tenant_banking,
        tenant_banking_bb,
        tenant_banking_inter,
        tenant_banking_lifecycle,
        tenant_banking_webhooks,
        tenant_catalog,
        tenant_cnab_providers,
        tenant_contract_actions,
        tenant_downloads,
        tenant_finance,
        tenant_imports,
        tenant_integrations,
        tenant_management,
        tenant_operations,
        tenant_pix_automatic,
    )
from app.core.errors import APIError, api_error_handler
from app.core.logging import configure_logging
from app.core.rate_limit import consume_rate_limit, parse_rate_limit, request_identity, request_scope
from app.db.platform import PlatformSessionLocal, platform_engine
from app.db.tenant import tenant_engines

configure_logging()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("application_started", version=__version__, environment=settings.app_env)
    yield
    await close_redis()
    await tenant_engines.dispose_all()
    await platform_engine.dispose()
    logger.info("application_stopped")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Connect|API Platform — Communication & Integration Platform multitenant.",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

configured_hosts = [f"*{item}" if item.startswith(".") else item for item in settings.trusted_host_list]
allowed_hosts = sorted(set(configured_hosts) | {"connect-api", "localhost", "127.0.0.1"})
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts or ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "X-Tenant-Host",
        "X-Webhook-Secret",
        "X-API-Key",
        "X-Platform-API-Key",
    ],
)


async def _record_runtime_request(
    request: Request,
    *,
    level: str,
    event: str,
    message: str,
    status_code: int | None,
    duration_ms: int,
    details: dict | None = None,
) -> None:
    if "/observability/logs/ingest" in request.url.path:
        return
    try:
        from app.services.observability import record_runtime_log

        tenant = getattr(request.state, "tenant", None)
        async with PlatformSessionLocal() as session:
            await record_runtime_log(
                session,
                source="backend",
                service="connect-api",
                level=level,
                event=event,
                message=message,
                tenant_id=getattr(tenant, "tenant_id", None),
                request_id=getattr(request.state, "request_id", None),
                correlation_id=request.headers.get("x-correlation-id"),
                method=request.method,
                path=request.url.path,
                status_code=status_code,
                duration_ms=duration_ms,
                details=details or {},
            )
    except Exception as exc:
        logger.debug("runtime_log_persist_failed", error=type(exc).__name__)


@app.middleware("http")
async def rate_limit_guard(request: Request, call_next):
    if request.url.path.startswith(("/health", "/metrics")):
        return await call_next(request)
    try:
        from app.api.deps import get_redis

        rule = parse_rate_limit(settings.rate_limit_default)
        redis = await get_redis()
        identity = request_identity(request)
        scope = request_scope(request)
        window = int(time.time()) // rule.window_seconds
        key = f"rate-limit:{scope}:{identity}:{window}"
        allowed, remaining, retry_after = await consume_rate_limit(redis, key=key, rule=rule)
    except Exception as exc:
        logger.warning("rate_limit_unavailable", error=type(exc).__name__)
        return await call_next(request)
    if not allowed:
        return ORJSONResponse(
            status_code=429,
            content={
                "success": False,
                "error": {
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "Limite de requisições excedido.",
                    "details": {"retry_after": retry_after},
                },
            },
            headers={"Retry-After": str(retry_after), "X-RateLimit-Remaining": "0"},
        )
    response = await call_next(request)
    response.headers["X-RateLimit-Limit"] = str(rule.limit)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    return response


@app.middleware("http")
async def maintenance_guard(request: Request, call_next):
    if request.url.path.startswith(("/health", "/metrics")):
        return await call_next(request)

    try:
        maintenance_enabled = settings.maintenance_file.exists()
    except OSError as exc:
        logger.error(
            "maintenance_file_unavailable",
            path=str(settings.maintenance_file),
            error=type(exc).__name__,
        )
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "MAINTENANCE_STATE_UNAVAILABLE",
                    "message": "Não foi possível validar o estado de manutenção da plataforma.",
                }
            },
            headers={"Retry-After": "60"},
        )

    if maintenance_enabled:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "MAINTENANCE_MODE",
                    "message": "Plataforma temporariamente indisponível para manutenção.",
                }
            },
            headers={"Retry-After": "300"},
        )
    return await call_next(request)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        path=request.url.path,
        method=request.method,
    )
    try:
        response = await call_next(request)
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        logger.exception("request_failed")
        await _record_runtime_request(
            request,
            level="CRITICAL",
            event="request_exception",
            message=f"Exceção não tratada em {request.method} {request.url.path}: {type(exc).__name__}",
            status_code=500,
            duration_ms=duration_ms,
            details={"exception": type(exc).__name__},
        )
        raise

    duration_ms = int((time.perf_counter() - started) * 1000)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    if response.status_code >= 500:
        await _record_runtime_request(
            request,
            level="ERROR",
            event="http_server_error",
            message=f"{request.method} {request.url.path} respondeu HTTP {response.status_code}.",
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
    elif response.status_code >= 400:
        await _record_runtime_request(
            request,
            level="WARNING",
            event="http_client_error",
            message=f"{request.method} {request.url.path} respondeu HTTP {response.status_code}.",
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
    elif duration_ms >= 1500:
        await _record_runtime_request(
            request,
            level="WARNING",
            event="slow_request",
            message=f"Requisição lenta: {request.method} {request.url.path} levou {duration_ms} ms.",
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
    return response


app.add_exception_handler(APIError, api_error_handler)  # type: ignore[arg-type]

app.include_router(health.router)
app.include_router(public_branding.router)
app.include_router(audit_details.router)
app.include_router(control_auth.router)
app.include_router(control_branding.router)
app.include_router(control_landing.router)
app.include_router(control_management.router)
app.include_router(control_observability.router)
app.include_router(control_operations.router)
app.include_router(control_provisioning.router)
app.include_router(control_resources.router)
app.include_router(control_tenants.router)
app.include_router(control_whatsapp.router)
app.include_router(tenant_auth.router)
app.include_router(tenant_admin.router)
app.include_router(tenant_connect.router)
app.include_router(tenant_engine.router)
app.include_router(tenant_observability.router)
app.include_router(tenant_platform_services.router)
app.include_router(tenant_registry.router)
app.include_router(tenant_security.router)
app.include_router(tenant_public.router)
app.include_router(webhooks.router)

# O domínio financeiro herdado permanece apenas como referência e é opt-in.
if settings.enable_reference_financial_domain:
    app.include_router(control_banking.router)
    app.include_router(tenant_banking.router)
    app.include_router(tenant_banking_bb.router)
    app.include_router(tenant_banking_inter.router)
    app.include_router(tenant_banking_lifecycle.router)
    app.include_router(tenant_banking_webhooks.router)
    app.include_router(tenant_catalog.router)
    app.include_router(tenant_cnab_providers.router)
    app.include_router(tenant_contract_actions.router)
    app.include_router(tenant_downloads.router)
    app.include_router(tenant_finance.router)
    app.include_router(tenant_integrations.router)
    app.include_router(tenant_management.router)
    app.include_router(tenant_imports.router)
    app.include_router(tenant_operations.router)
    app.include_router(tenant_pix_automatic.router)
    app.include_router(public_finance.router)

@app.get("/api", tags=["Platform"])
async def api_root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "version": __version__,
        "environment": settings.app_env,
        "docs": "/api/docs",
    }
