from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx

from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.banking.core.mtls import temporary_client_certificate
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


class SantanderBankingProvider(BacenPixCobMTLSProvider):
    name = "SANTANDER"
    driver_version = "1.0.0-rc.28"
    certificate_required = True
    allowed_hosts = {
        "trust-pix-h.santander.com.br",
        "trust-pix.santander.com.br",
    }
    _endpoints = {
        "HOMOLOGATION": (
            "https://trust-pix-h.santander.com.br/oauth/token?grant_type=client_credentials",
            "https://trust-pix-h.santander.com.br/api/v1",
        ),
        "PRODUCTION": (
            "https://trust-pix.santander.com.br/oauth/token?grant_type=client_credentials",
            "https://trust-pix.santander.com.br/api/v1",
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
                "O driver Santander aceita somente HOMOLOGATION ou PRODUCTION.",
                details={"environment": environment},
            )
        return endpoints

    @classmethod
    @asynccontextmanager
    async def client(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> AsyncIterator[tuple[BankHTTPClient, str, int]]:
        (
            token_url,
            resource_base_url,
            client_id,
            client_secret,
            certificate,
            private_key,
            expiration,
        ) = cls.configuration(environment=environment, credentials=credentials, settings=settings)
        async with temporary_client_certificate(
            certificate,
            private_key,
            prefix="connect-api-santander",
        ) as cert:
            try:
                async with httpx.AsyncClient(
                    cert=cert,
                    timeout=15.0,
                    follow_redirects=False,
                ) as oauth_client:
                    response = await oauth_client.post(
                        token_url,
                        data={"client_id": client_id, "client_secret": client_secret},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )
            except httpx.TimeoutException as exc:
                raise BankProviderError(
                    "BANK_REQUEST_TIMEOUT",
                    "Timeout ao obter token Santander Pix.",
                    retryable=True,
                ) from exc
            except httpx.NetworkError as exc:
                raise BankProviderError(
                    "BANK_PROVIDER_UNAVAILABLE",
                    "Servidor de autenticação Santander Pix indisponível.",
                    retryable=True,
                ) from exc
            if response.status_code >= 400:
                raise BankProviderError(
                    "BANK_AUTHENTICATION_FAILED",
                    "O Santander recusou a autenticação Pix.",
                    provider_http_status=response.status_code,
                )
            try:
                token = str(response.json()["access_token"])
            except (ValueError, KeyError, TypeError) as exc:
                raise BankProviderError(
                    "BANK_RESPONSE_INVALID",
                    "Resposta de token Santander Pix inválida.",
                ) from exc
            async with BankHTTPClient(
                provider=cls.name,
                base_url=resource_base_url,
                allowed_hosts=cls.allowed_hosts,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "Connect-API-Platform/1.0",
                },
                cert=cert,
            ) as bank_client:
                yield bank_client, str(credentials["pix_key"]).strip(), expiration
