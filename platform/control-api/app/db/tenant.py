from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.tenant_context import TenantContext


@dataclass(slots=True)
class EngineEntry:
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    credential_version: int


class TenantEngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, EngineEntry] = {}
        self._lock = asyncio.Lock()

    async def get(self, context: TenantContext) -> EngineEntry:
        key = context.tenant_id
        current = self._engines.get(key)
        if current is not None and current.credential_version == context.credential_version:
            return current
        async with self._lock:
            current = self._engines.get(key)
            if current is not None and current.credential_version == context.credential_version:
                return current
            if current is not None:
                await current.engine.dispose()
            url = URL.create(
                drivername="postgresql+asyncpg",
                username=context.database_user,
                password=context.database_password,
                host=settings.postgres_host,
                port=settings.postgres_port,
                database=context.database,
            )
            engine = create_async_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=10)
            entry = EngineEntry(
                engine=engine,
                session_factory=async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False),
                credential_version=context.credential_version,
            )
            self._engines[key] = entry
            return entry

    async def invalidate(self, tenant_id: str) -> None:
        async with self._lock:
            entry = self._engines.pop(tenant_id, None)
            if entry:
                await entry.engine.dispose()

    async def dispose_all(self) -> None:
        async with self._lock:
            entries = list(self._engines.values())
            self._engines.clear()
        for entry in entries:
            await entry.engine.dispose()


tenant_engines = TenantEngineRegistry()


async def tenant_session(context: TenantContext) -> AsyncIterator[AsyncSession]:
    entry = await tenant_engines.get(context)
    async with entry.session_factory() as session:
        yield session
