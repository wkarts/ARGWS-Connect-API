"""Read-only Control Plane presentation of the services' generated TLS evidence."""
from __future__ import annotations

from datetime import UTC, datetime

from app.core.tls_diagnostics import error_details
from app.services.tls_status import diagnostic_summary

# Field NAMES only. No environment values, keys, certificates or arbitrary paths.
FIELDS = {
    "CLOUDFLARE_TOKEN_REQUIRED": ("CLOUDFLARE_API_TOKEN",),
    "ACME_EMAIL_AND_CLOUDFLARE_TOKEN_REQUIRED": ("ACME_EMAIL", "CLOUDFLARE_API_TOKEN"),
    "INVALID_CLOUDFLARE_ZONE_ID": ("CLOUDFLARE_ZONE_ID",),
    "CLOUDFLARE_ZONE_NOT_AUTHORIZED": ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"),
    "DNS_ZONE_NOT_AUTHORIZED": ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"),
    "INVALID_DOMAIN": ("ACME_DOMAIN", "TENANT_DOMAIN_ROOT", "PLATFORM_DOMAIN", "ACME_ADDITIONAL_DOMAINS"),
    "CLOUDPANEL_WILDCARD_NOT_IN_CERTIFICATE_NAMES": ("ACME_DOMAIN", "TENANT_DOMAIN_ROOT", "CLOUDPANEL_WILDCARD_DOMAIN"),
    "SITE_AND_ACME_ROOT_MUST_MATCH": ("ACME_DOMAIN", "CLOUDPANEL_SITE_DOMAIN"),
    "TLS_AUTOMATION_DISABLED": ("PLATFORM_TLS_AUTOMATION_ENABLED",),
    "REVERSE_PROXY_MUST_BE_LOCAL_HTTP": ("CLOUDPANEL_REVERSE_PROXY_URL", "PLATFORM_GATEWAY_PORT"),
    "BASE_REVERSE_PROXY_MISSING": ("CLOUDPANEL_SITE_DOMAIN", "CLOUDPANEL_REVERSE_PROXY_URL"),
}
ORIGIN_CODES = {
    "PLATFORM_ORIGIN_DNS_MISSING", "PLATFORM_ORIGIN_MUST_BE_PUBLIC",
    "PLATFORM_ORIGIN_CHAIN_PROXIED", "PLATFORM_ORIGIN_CHAIN_TOO_LONG", "PLATFORM_DNS_CNAME_LOOP",
}
WAITING_CODES = {
    "CERTIFICATE_NOT_READY", "TLS_STATUS_MISSING", "WILDCARD_DNS_PROOF_PENDING",
    "BASE_REVERSE_PROXY_MISSING", "CLOUDFLARE_ZONE_NOT_ACTIVE", "DNS_ZONE_NOT_ACTIVE",
}


def env_fields(code: str | None) -> list[str]:
    if code in ORIGIN_CODES:
        return ["CLOUDFLARE_TENANT_RECORD_TARGET", "CLOUDFLARE_ORIGIN_IPV4", "CLOUDFLARE_ORIGIN_IPV6"]
    if code in {"CLOUDFLARE_HTTP_401", "CLOUDFLARE_HTTP_403", "CLOUDFLARE_OPERATION_FAILED"}:
        return ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"]
    return list(FIELDS.get(code, ()))


def diagnostic_report() -> dict:
    """No network calls, subprocesses, mutations or artificial READY/ACTIVE evidence."""
    summary = diagnostic_summary()
    now = datetime.now(UTC)
    services = []
    for key, title in (("dns", "DNS e wildcard"), ("acme", "Emissão e renovação ACME"),
                       ("cloudpanel", "Instalação no CloudPanel")):
        original = summary["services"][key]
        status = original["status"]
        code = original.get("error")
        state = "WAITING"
        message = "O serviço ainda não publicou uma confirmação."
        if not original["present"]:
            code = "TLS_STATUS_MISSING"
        elif not original["fresh"]:
            state, code = "STALE", "TLS_STATUS_STALE"
        elif status == "DISABLED":
            state, code = "DISABLED", "TLS_AUTOMATION_DISABLED"
        elif status == "STAGING":
            state, code = "STAGING", None
            message = "Modo de teste ACME. O certificado de teste não é instalado como SSL de produção."
        elif code:
            state = "WAITING" if code in WAITING_CODES else "ERROR"
        elif status == "READY":
            state, message = "READY", "Confirmação recente publicada pelo serviço."
            if key != "dns":
                try:
                    expires = datetime.fromisoformat(original["expires_at"])
                    if expires <= now:
                        state, code = "ERROR", "CERTIFICATE_EXPIRED"
                except (KeyError, TypeError, ValueError):
                    state, code = "WAITING", "TLS_STATUS_INVALID"
        elif status == "ISSUING":
            state, message = "RUNNING", "O serviço está executando a emissão; aguarde a próxima verificação."
        elif status == "WAITING_CERTIFICATE":
            code = "CERTIFICATE_NOT_READY"
        else:
            state, code = "ERROR", "TLS_UNEXPECTED_ERROR"
        safe = error_details(code) if code else {}
        item = {
            "id": key, "title": title, "state": state,
            "code": safe.get("error"), "message": safe.get("message", message),
            "stage": original.get("stage"), "env_fields": env_fields(safe.get("error")),
        }
        # The summary validates timestamps; no full receipt/message is forwarded.
        for field in ("checked_at", "expires_at", "last_installed_at", "last_verified_at"):
            item[field] = original.get(field)
        if state == "STAGING":
            item["env_fields"] = ["ACME_STAGING"]
        services.append(item)
    return {
        "schema_version": 1, "scope": "PLATFORM_SERVICES", "read_only": True,
        "operator_files": ["compose.yaml", ".env"], "requires_manual_proof": False,
        "services_confirmed": all(item["state"] == "READY" for item in services),
        "queried_at": now.isoformat(), "services": services,
        "note": "A consulta lê o estado gerado pelos serviços. Não reemite certificados, não altera DNS e não ativa clientes.",
    }
