from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": settings.app_env,
    }


@router.get("/capabilities")
async def capabilities() -> dict[str, list[str]]:
    return {
        "control_plane": [
            "partners",
            "tenants",
            "installations",
            "domains",
            "nodes",
            "provisioning",
            "observability",
        ],
        "messaging": ["rabbitmq", "nats"],
        "optional": ["kafka"],
    }
