from __future__ import annotations

import pytest

from app.core.config import settings
from app.core.errors import APIError
from app.providers.cloudflare import CloudflareDNSProvider, DNSRecordResult


@pytest.mark.asyncio
async def test_managed_wildcard_derives_dns_only_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "platform_domain", "financeiro.example.com")
    monkeypatch.setattr(settings, "tenant_domain_root", "financeiro.example.com")
    monkeypatch.setattr(settings, "cloudflare_tenant_record_target", "proxy.financeiro.example.com")

    provider = CloudflareDNSProvider()
    calls: list[tuple[str, str, str, bool | None]] = []

    async def fake_list_records(hostname: str, record_type: str | None = None, *, zone_id: str | None = None):
        assert hostname == "financeiro.example.com"
        assert record_type is None
        assert zone_id is None
        return [{"id": "base", "type": "A", "name": hostname, "content": "203.0.113.10", "proxied": True}]

    async def fake_upsert_record(
        hostname: str,
        content: str,
        *,
        record_type: str = "CNAME",
        proxied: bool | None = None,
        zone_id: str | None = None,
    ) -> DNSRecordResult:
        assert zone_id is None
        calls.append((hostname, content, record_type, proxied))
        return DNSRecordResult("id", hostname, content, bool(proxied), record_type)

    monkeypatch.setattr(provider, "list_records", fake_list_records)
    monkeypatch.setattr(provider, "upsert_record", fake_upsert_record)

    result = await provider.ensure_managed_wildcard()

    assert calls == [
        ("proxy.financeiro.example.com", "203.0.113.10", "A", False),
        ("*.financeiro.example.com", "proxy.financeiro.example.com", "CNAME", False),
    ]
    assert result.name == "*.financeiro.example.com"
    assert result.proxied is False


@pytest.mark.asyncio
async def test_managed_wildcard_403_is_nonblocking_for_shared_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "platform_domain", "connect-api.example.com")
    monkeypatch.setattr(settings, "tenant_domain_root", "connect-api.example.com")
    monkeypatch.setattr(settings, "cloudflare_tenant_record_target", "proxy.connect-api.example.com")
    monkeypatch.setattr(settings, "cloudflare_provisioning_mode", "wildcard")

    provider = CloudflareDNSProvider()

    async def forbidden_list_records(hostname: str, record_type: str | None = None, *, zone_id: str | None = None):
        del hostname, record_type, zone_id
        raise APIError(
            "CLOUDFLARE_ERROR",
            "Cloudflare rejeitou a operação solicitada.",
            409,
            {"status_code": 403, "errors": [{"code": 9109, "message": "Forbidden"}]},
        )

    monkeypatch.setattr(provider, "list_records", forbidden_list_records)

    result = await provider.ensure_managed_wildcard()

    assert result.record_id == ""
    assert result.name == "*.connect-api.example.com"
    assert result.content == "proxy.connect-api.example.com"
    assert result.record_type == "EXTERNAL_WILDCARD"


@pytest.mark.asyncio
async def test_managed_wildcard_403_remains_fatal_outside_wildcard_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "platform_domain", "connect-api.example.com")
    monkeypatch.setattr(settings, "tenant_domain_root", "connect-api.example.com")
    monkeypatch.setattr(settings, "cloudflare_tenant_record_target", "proxy.connect-api.example.com")
    monkeypatch.setattr(settings, "cloudflare_provisioning_mode", "records")

    provider = CloudflareDNSProvider()

    async def forbidden_list_records(hostname: str, record_type: str | None = None, *, zone_id: str | None = None):
        del hostname, record_type, zone_id
        raise APIError(
            "CLOUDFLARE_ERROR",
            "Cloudflare rejeitou a operação solicitada.",
            409,
            {"status_code": 403, "errors": [{"code": 9109, "message": "Forbidden"}]},
        )

    monkeypatch.setattr(provider, "list_records", forbidden_list_records)

    with pytest.raises(APIError) as exc_info:
        await provider.ensure_managed_wildcard()

    assert exc_info.value.code == "CLOUDFLARE_ERROR"
