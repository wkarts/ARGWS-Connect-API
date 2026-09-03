from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.tenant_context import TenantContext
from app.models.platform import Tenant, TenantDomain


class TenantResolver:
    def __init__(self, session: AsyncSession, redis: Redis | None = None) -> None:
        self.session = session
        self.redis = redis

    @staticmethod
    def normalize_hostname(hostname: str) -> str:
        value = hostname.split(",", maxsplit=1)[0].strip().lower().rstrip(".")
        if value.startswith("[") and "]" in value:
            return value[1 : value.index("]")]
        if ":" in value:
            value = value.rsplit(":", maxsplit=1)[0]
        return value

    @staticmethod
    def _validate(tenant: Tenant, domain: TenantDomain) -> None:
        if domain.status != "ACTIVE":
            raise APIError(
                "DOMAIN_NOT_ACTIVE",
                "O domínio ainda não está ativo.",
                503,
                {"domain_status": domain.status},
            )
        if tenant.status == "SUSPENDED":
            raise APIError("TENANT_SUSPENDED", "Tenant suspenso.", 423)
        if tenant.status not in {"ACTIVE"}:
            raise APIError(
                "TENANT_NOT_ACTIVE",
                "Tenant ainda não está ativo.",
                503,
                {"tenant_status": tenant.status},
            )
        if tenant.database is None or tenant.database.status != "ACTIVE":
            raise APIError("TENANT_DATABASE_NOT_ACTIVE", "Banco do tenant indisponível.", 503)
        if tenant.storage is None or tenant.storage.status != "ACTIVE":
            raise APIError("TENANT_STORAGE_NOT_ACTIVE", "Storage do tenant indisponível.", 503)

    def _to_context(self, tenant: Tenant, domain: TenantDomain) -> TenantContext:
        assert tenant.database is not None
        assert tenant.storage is not None
        return TenantContext(
            tenant_id=str(tenant.id),
            slug=tenant.slug,
            database=tenant.database.database_name,
            database_user=tenant.database.database_user,
            database_password=secret_cipher.decrypt(tenant.database.encrypted_password),
            storage_bucket=tenant.storage.bucket,
            hostname=domain.hostname,
            timezone=tenant.timezone,
            credential_version=tenant.database.credential_version,
        )

    async def _from_cache(self, hostname: str) -> TenantContext | None:
        if self.redis is None:
            return None
        try:
            raw = await self.redis.get(f"tenant-domain:{hostname}")
            if not raw:
                return None
            data: dict[str, Any] = json.loads(raw)
            data["database_password"] = secret_cipher.decrypt(data.pop("encrypted_password"))
            return TenantContext(**data)
        except Exception:  # noqa: BLE001 - cache nunca derruba resolução de tenant
            return None

    async def _cache(self, context: TenantContext) -> None:
        if self.redis is None:
            return
        data = {
            "tenant_id": context.tenant_id,
            "slug": context.slug,
            "database": context.database,
            "database_user": context.database_user,
            "encrypted_password": secret_cipher.encrypt(context.database_password),
            "storage_bucket": context.storage_bucket,
            "hostname": context.hostname,
            "timezone": context.timezone,
            "credential_version": context.credential_version,
        }
        try:
            await self.redis.setex(
                f"tenant-domain:{context.hostname}", settings.redis_cache_ttl_seconds, json.dumps(data)
            )
        except Exception:  # noqa: BLE001
            return

    async def resolve(self, hostname: str) -> TenantContext:
        hostname = self.normalize_hostname(hostname)
        cached = await self._from_cache(hostname)
        if cached is not None:
            return cached

        stmt = (
            select(TenantDomain)
            .where(TenantDomain.hostname == hostname)
            .options(
                selectinload(TenantDomain.tenant).selectinload(Tenant.database),
                selectinload(TenantDomain.tenant).selectinload(Tenant.storage),
            )
        )
        domain = (await self.session.execute(stmt)).scalar_one_or_none()
        if domain is None:
            raise APIError(
                "TENANT_NOT_FOUND",
                "Nenhum tenant ativo foi encontrado para o domínio informado.",
                404,
                {"hostname": hostname},
            )
        self._validate(domain.tenant, domain)
        context = self._to_context(domain.tenant, domain)
        await self._cache(context)
        return context

    async def resolve_by_id(self, tenant_id: str, require_active: bool = True) -> TenantContext:
        stmt = (
            select(Tenant)
            .where(Tenant.id == tenant_id)
            .options(selectinload(Tenant.database), selectinload(Tenant.storage), selectinload(Tenant.domains))
        )
        tenant = (await self.session.execute(stmt)).scalar_one_or_none()
        if tenant is None:
            raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
        domain = next((item for item in tenant.domains if item.is_primary), None)
        domain = domain or next(iter(tenant.domains), None)
        if domain is None:
            raise APIError("TENANT_WITHOUT_DOMAIN", "Tenant sem domínio configurado.", 503)
        if require_active:
            self._validate(tenant, domain)
        if tenant.database is None or tenant.storage is None:
            raise APIError("TENANT_NOT_PROVISIONED", "Tenant ainda não foi provisionado.", 503)
        return self._to_context(tenant, domain)

    async def invalidate(self, hostname: str) -> None:
        if self.redis is not None:
            try:
                await self.redis.delete(f"tenant-domain:{self.normalize_hostname(hostname)}")
            except Exception:  # noqa: BLE001
                pass
