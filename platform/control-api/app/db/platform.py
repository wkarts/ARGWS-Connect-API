from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.pooling import engine_options
from app.db.connection_retry import install_login_retry

platform_engine = create_async_engine(
    settings.platform_runtime_database_url,
    **engine_options(),
)
if settings.postgres_pgbouncer_enabled:
    install_login_retry(platform_engine)
PlatformSessionLocal = async_sessionmaker(platform_engine, class_=AsyncSession, expire_on_commit=False)


async def get_platform_session() -> AsyncIterator[AsyncSession]:
    async with PlatformSessionLocal() as session:
        yield session
