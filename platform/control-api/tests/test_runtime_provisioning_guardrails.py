from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from app.core.config import settings
from app.main import allowed_hosts
from app.models.platform import TenantDomain
from app.services.domains import domain_service
from app.services.provisioning import ProvisioningService


def test_internal_api_hostname_is_trusted_for_prometheus() -> None:
    assert "connect-api" in allowed_hosts


@pytest.mark.asyncio
async def test_provisioned_domain_reconciles_wildcard_before_activation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloudflare_enabled", True)
    monkeypatch.setattr(settings, "cloudflare_provisioning_mode", "wildcard")
    monkeypatch.setattr(settings, "cloudflare_api_token", "test-token")
    monkeypatch.setattr(settings, "cloudflare_zone_id", "test-zone")
    monkeypatch.setattr(settings, "public_scheme", "https")

    service = ProvisioningService()
    reconciled: list[str] = []

    async def fake_reconcile(session: object, domain: TenantDomain) -> TenantDomain:
        del session
        reconciled.append(domain.hostname)
        now = datetime.now(UTC)
        domain.provider_metadata = {
            "wildcard": "*.connect-api.example.com",
            "target": "proxy.connect-api.example.com",
        }
        domain.dns_target = "proxy.connect-api.example.com"
        domain.status = "ACTIVE"
        domain.dns_verified_at = now
        domain.ownership_verified_at = now
        domain.last_checked_at = now
        domain.last_reconciled_at = now
        domain.ssl_status = "ACTIVE"
        domain.ssl_issued_at = now
        domain.last_error = None
        return domain

    monkeypatch.setattr(domain_service, "reconcile", fake_reconcile)
    domain = TenantDomain(
        tenant_id=uuid4(),
        hostname="cliente.connect-api.example.com",
        domain_type="PROVISIONED",
        status="PENDING",
        is_primary=True,
        is_temporary=True,
    )

    detail = await service._activate_provisioned_domain(object(), domain)  # type: ignore[arg-type]

    assert reconciled == ["cliente.connect-api.example.com"]
    assert "*.connect-api.example.com" in detail
    assert domain.status == "ACTIVE"
    assert domain.dns_verified_at is not None
    assert domain.last_checked_at is not None
    assert domain.ssl_status == "ACTIVE"
    assert domain.last_error is None


def test_cloudpanel_agent_can_create_reverse_proxy() -> None:
    root = Path(__file__).resolve().parents[2]
    script = (root / "infrastructure" / "cloudpanel-agent" / "entrypoint.sh").read_text(encoding="utf-8")
    assert "clpctl site:add:reverse-proxy" in script
    assert "CLOUDPANEL_SITE_USER_PASSWORD" in script
    assert "GATEWAY_PORT:-18800" in script


def test_public_landing_is_mobile_and_does_not_expose_administrative_urls() -> None:
    root = Path(__file__).resolve().parents[2]
    landing = (root / "infrastructure" / "docker" / "gateway" / "landing" / "index.html").read_text(encoding="utf-8")
    assert 'name="viewport"' in landing
    assert "https://demo.connect-api.example.com/" not in landing
    assert "https://control.connect-api.example.com/" not in landing
    assert "Control Plane" not in landing
    assert "Evolution API" not in landing
    assert "/api/public/platform/landing" in landing
