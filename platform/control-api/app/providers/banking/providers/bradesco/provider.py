from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


class BradescoBankingProvider(BacenPixCobMTLSProvider):
    name = "BRADESCO"
    driver_version = "1.0.0-rc.28"
    certificate_required = True
    scopes = ("cob.write", "cob.read")
    allowed_hosts = {
        "qrpix-h.bradesco.com.br",
        "qrpix.bradesco.com.br",
    }

    @classmethod
    def endpoints(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any],
    ) -> tuple[str, str]:
        del settings
        normalized = environment.upper()
        if normalized == "HOMOLOGATION":
            return (
                "https://qrpix-h.bradesco.com.br/oauth/token",
                "https://qrpix-h.bradesco.com.br/v2",
            )
        if normalized == "PRODUCTION":
            token_url = str(credentials.get("production_token_url") or "").strip()
            if not token_url:
                raise BankProviderError(
                    "BANK_INVALID_CONFIGURATION",
                    "Informe o endpoint OAuth de produção fornecido/confirmado no onboarding Bradesco.",
                    details={"missing_fields": ["production_token_url"]},
                )
            parsed = urlparse(token_url)
            if parsed.scheme != "https" or (parsed.hostname or "").casefold() != "qrpix.bradesco.com.br":
                raise BankProviderError(
                    "BANK_INVALID_CONFIGURATION",
                    "O endpoint OAuth de produção Bradesco deve usar HTTPS no host qrpix.bradesco.com.br.",
                    details={"host": parsed.hostname or "ausente"},
                )
            return token_url, "https://qrpix.bradesco.com.br/v2"
        raise BankProviderError(
            "BANK_INVALID_REQUEST",
            "O driver Bradesco aceita somente HOMOLOGATION ou PRODUCTION.",
            details={"environment": normalized},
        )
