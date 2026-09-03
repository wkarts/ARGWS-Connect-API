from __future__ import annotations

import json
import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.models.platform import PlatformIntegration
from app.providers.evolution import EvolutionConfig, EvolutionWhatsAppProvider


@dataclass(frozen=True, slots=True)
class ManagedWhatsApp:
    provider: EvolutionWhatsAppProvider
    instance: str
    instance_mode: str
    managed_instance: bool
    configured: bool


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    return cleaned[:48] or "tenant"


def _tenant_instance(slug: str, tenant_id: str | UUID, prefix: str) -> str:
    """Preserva o padrão introduzido na PR #36 para não perder instâncias já conectadas."""
    compact = str(tenant_id).replace("-", "")[:10]
    safe_prefix = _slug(prefix or "connect-api")[:24]
    return f"{safe_prefix}-{_slug(slug)[:32]}-{compact}"[:80]


async def _platform_configuration() -> tuple[dict, dict[str, str]]:
    public: dict = {}
    secrets_data: dict[str, str] = {}
    async with PlatformSessionLocal() as session:
        item = await session.scalar(
            select(PlatformIntegration).where(PlatformIntegration.provider == "EVOLUTION")
        )
        if item is not None and item.is_enabled:
            public = dict(item.public_config or {})
            if item.encrypted_secrets:
                try:
                    secrets_data = json.loads(secret_cipher.decrypt(item.encrypted_secrets))
                except Exception:
                    secrets_data = {}
    return public, secrets_data


async def managed_whatsapp_for_tenant(slug: str, tenant_id: str | UUID) -> ManagedWhatsApp:
    public, secrets_data = await _platform_configuration()
    base_url = str(public.get("base_url") or settings.evolution_base_url or "").strip()
    api_key = str(secrets_data.get("api_key") or settings.evolution_api_key or "").strip()
    instance_mode = str(public.get("instance_mode") or "TENANT").upper()

    if instance_mode == "SHARED":
        instance = str(public.get("instance") or settings.evolution_instance or "connect-api-platform").strip()
    else:
        instance = _tenant_instance(
            slug,
            tenant_id,
            str(public.get("instance_prefix") or "connect-api"),
        )

    if not base_url or not api_key:
        raise APIError(
            "WHATSAPP_PLATFORM_NOT_CONFIGURED",
            "O serviço de WhatsApp da plataforma ainda não foi configurado.",
            503,
        )

    config = EvolutionConfig(
        base_url=base_url,
        api_key=api_key,
        instance=instance,
        send_text_path=str(public.get("send_text_path") or settings.evolution_send_text_path),
        send_media_path=str(public.get("send_media_path") or settings.evolution_send_media_path),
        create_path=str(public.get("create_path") or "/instance/create"),
        connect_path=str(public.get("connect_path") or "/instance/connect/{instance}"),
        logout_path=str(public.get("logout_path") or "/instance/logout/{instance}"),
        restart_path=str(public.get("restart_path") or "/instance/restart/{instance}"),
        delete_path=str(public.get("delete_path") or "/instance/delete/{instance}"),
        state_path=str(public.get("state_path") or "/instance/connectionState/{instance}"),
        fetch_instances_path=str(public.get("fetch_instances_path") or "/instance/fetchInstances"),
        timeout=settings.evolution_timeout_seconds,
    )
    return ManagedWhatsApp(
        provider=EvolutionWhatsAppProvider(config),
        instance=instance,
        instance_mode=instance_mode,
        managed_instance=instance_mode != "SHARED",
        configured=True,
    )


async def managed_whatsapp(context: TenantContext) -> ManagedWhatsApp:
    return await managed_whatsapp_for_tenant(context.slug, context.tenant_id)
