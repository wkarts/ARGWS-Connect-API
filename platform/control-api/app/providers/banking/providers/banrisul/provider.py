from __future__ import annotations

from typing import Any

from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


class BanrisulBankingProvider(BacenPixCobMTLSProvider):
    name = "BANRISUL"
    driver_version = "1.0.0-rc.28"
    allowed_hosts = {"mtls-api.banrisul.com.br", "mtls-api-h.banrisul.com.br"}
    certificate_required = False

    _endpoints = {
        "HOMOLOGATION": (
            "https://mtls-api-h.banrisul.com.br/auth/oauth/v2/token",
            "https://mtls-api-h.banrisul.com.br/pix/api-mtls",
        ),
        "PRODUCTION": (
            "https://mtls-api.banrisul.com.br/auth/oauth/v2/token",
            "https://mtls-api.banrisul.com.br/pix/api-mtls",
        ),
    }

    @classmethod
    def endpoints(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any],
    ) -> tuple[str, str]:
        del credentials, settings
        endpoints = cls._endpoints.get(environment.upper())
        if endpoints is None:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "O driver Banrisul aceita somente HOMOLOGATION ou PRODUCTION.",
                details={"environment": environment},
            )
        return endpoints
