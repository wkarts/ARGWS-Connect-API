from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

platform_engine = create_async_engine(
    settings.platform_database_url,
    pool_pre_ping=True,
    pool_size=settings.postgres_pool_size,
    max_overflow=settings.postgres_max_overflow,
    echo=settings.app_debug,
)
PlatformSessionLocal = async_sessionmaker(platform_engine, class_=AsyncSession, expire_on_commit=False)


async def get_platform_session() -> AsyncIterator[AsyncSession]:
    async with PlatformSessionLocal() as session:
        yield session
