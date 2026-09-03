from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


class SicrediBankingProvider(BacenPixCobMTLSProvider):
    name = "SICREDI"
    driver_version = "1.0.0-rc.28"
    allowed_hosts = {"api-pix.sicredi.com.br", "api-pix-h.sicredi.com.br"}
    certificate_required = True

    @classmethod
    def _validated_url(cls, value: str, *, label: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.hostname.casefold() not in cls.allowed_hosts:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                f"{label} Sicredi fora da allowlist oficial.",
                details={"host": parsed.hostname or ""},
            )
        return value.rstrip("/")

    @classmethod
    def endpoints(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any],
    ) -> tuple[str, str]:
        environment = environment.upper()
        token_override = str(credentials.get("token_url") or settings.get("token_url") or "").strip()
        resource_override = str(
            credentials.get("resource_base_url") or settings.get("resource_base_url") or ""
        ).strip()

        if environment == "PRODUCTION":
            token_url = token_override or "https://api-pix.sicredi.com.br/oauth/token"
            resource_base_url = resource_override or "https://api-pix.sicredi.com.br/api/v2"
        elif environment == "HOMOLOGATION":
            if not token_override or not resource_override:
                raise BankProviderError(
                    "BANK_INVALID_CONFIGURATION",
                    (
                        "A homologação Sicredi exige token_url e resource_base_url "
                        "fornecidos pelo credenciamento, pois o guia público não fixa "
                        "de forma inequívoca as duas URLs completas do ambiente."
                    ),
                )
            token_url = token_override
            resource_base_url = resource_override
        else:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "O driver Sicredi aceita somente HOMOLOGATION ou PRODUCTION.",
                details={"environment": environment},
            )

        return (
            cls._validated_url(token_url, label="Endpoint OAuth"),
            cls._validated_url(resource_base_url, label="Base da API Pix"),
        )
