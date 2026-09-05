from __future__ import annotations

import asyncio
import json

from app.core.config import settings
from app.core.errors import APIError
from app.providers.cloudflare import CloudflareDNSProvider


async def reconcile_managed_wildcard() -> dict[str, str | bool]:
    if settings.platform_tls_automation_enabled:
        return {"status": "SERVICE_MANAGED", "reason": "acme_service_owns_platform_dns"}
    if not settings.cloudflare_enabled:
        return {"status": "SKIPPED", "reason": "cloudflare_disabled"}
    if settings.cloudflare_provisioning_mode != "wildcard":
        return {"status": "SKIPPED", "reason": "records_mode"}

    provider = CloudflareDNSProvider()
    if not provider.configured:
        raise RuntimeError("Cloudflare habilitado, mas token/zone_id não estão configurados.")

    result = await provider.ensure_managed_wildcard()
    return {
        "status": "READY",
        "hostname": result.name,
        "target": result.content,
        "proxied": result.proxied,
    }


def _degraded_report(exc: Exception) -> dict[str, object]:
    if isinstance(exc, APIError):
        return {
            "status": "DEGRADED",
            "component": "cloudflare_wildcard",
            "blocking": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            },
        }
    return {
        "status": "DEGRADED",
        "component": "cloudflare_wildcard",
        "blocking": False,
        "error": {
            "code": exc.__class__.__name__,
            "message": str(exc),
            "details": {},
        },
    }


async def main() -> int:
    try:
        report = await reconcile_managed_wildcard()
    except Exception as exc:  # falha externa de DNS não deve impedir o boot da plataforma
        report = _degraded_report(exc)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
