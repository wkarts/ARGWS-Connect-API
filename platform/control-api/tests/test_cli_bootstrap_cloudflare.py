from __future__ import annotations

import httpx
import pytest

from app import cli as cli_module


@pytest.mark.asyncio
async def test_demo_bootstrap_cloudflare_403_is_nonblocking(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    request = httpx.Request(
        "GET",
        "https://api.cloudflare.com/client/v4/zones/zone/dns_records?name=connect-api.example.com",
    )
    response = httpx.Response(403, request=request)

    async def fail_with_cloudflare(_: str) -> None:
        raise httpx.HTTPStatusError(
            "Cloudflare denied DNS record listing",
            request=request,
            response=response,
        )

    monkeypatch.setattr(cli_module.provisioning_service, "provision", fail_with_cloudflare)

    assert await cli_module._provision_demo_job("job-id") is False
    output = capsys.readouterr().out
    assert "Cloudflare" in output
    assert "bootstrap da plataforma continuará" in output


@pytest.mark.asyncio
async def test_demo_bootstrap_non_cloudflare_http_error_remains_fatal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = httpx.Request("GET", "https://example.invalid/failure")
    response = httpx.Response(500, request=request)

    async def fail_elsewhere(_: str) -> None:
        raise httpx.HTTPStatusError(
            "unrelated upstream failure",
            request=request,
            response=response,
        )

    monkeypatch.setattr(cli_module.provisioning_service, "provision", fail_elsewhere)

    with pytest.raises(httpx.HTTPStatusError):
        await cli_module._provision_demo_job("job-id")
