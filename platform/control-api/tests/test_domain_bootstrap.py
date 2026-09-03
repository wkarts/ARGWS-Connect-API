from __future__ import annotations

import pytest

from app import domain_bootstrap
from app.core.errors import APIError


@pytest.mark.asyncio
async def test_domain_bootstrap_success(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_reconcile() -> dict[str, str]:
        return {"status": "READY", "hostname": "*.connect-api.example.com"}

    monkeypatch.setattr(domain_bootstrap, "reconcile_managed_wildcard", fake_reconcile)

    assert await domain_bootstrap.main() == 0


@pytest.mark.asyncio
async def test_domain_bootstrap_cloudflare_failure_is_non_blocking(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_reconcile() -> dict[str, str]:
        raise APIError(
            "CLOUDFLARE_ORIGIN_NOT_FOUND",
            "Não foi possível derivar a origem DNS do domínio principal para criar o wildcard.",
            409,
            {"hostname": "connect-api.example.com"},
        )

    monkeypatch.setattr(domain_bootstrap, "reconcile_managed_wildcard", fake_reconcile)

    assert await domain_bootstrap.main() == 0
