from __future__ import annotations

from sqlalchemy.orm import configure_mappers

from app.db.base import PlatformBase, TenantBase
from app.models import platform as _platform_models  # noqa: F401
from app.models import tenant as _tenant_models  # noqa: F401


def test_all_sqlalchemy_mappers_configure() -> None:
    configure_mappers()
    assert len(PlatformBase.metadata.tables) >= 9
    assert len(TenantBase.metadata.tables) >= 26
    assert "cnab_returns" in TenantBase.metadata.tables
    assert "company_id" in TenantBase.metadata.tables["cnab_returns"].c
