from __future__ import annotations

from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any, AsyncIterator
from urllib.parse import urlparse

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.banking.core.mtls import temporary_client_certificate
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


@asynccontextmanager
async def _without_certificate() -> AsyncIterator[None]:
    yield None


class CaixaBankingProvider:
    name = "CAIXA"
    driver_version = "1.0.0-rc.28"

    _resource_bases = {
        "SANDBOX": "https://api.caixa.gov.br:8443/sandbox/servicos-bancarios/requisicoes/pix-automatico",
        "PRODUCTION": "https://api.caixa.gov.br:8443/servicos-bancarios/requisicoes/pix-automatico",
    }

    @staticmethod
    def _official_url(value: str, *, field: str) -> tuple[str, str]:
        parsed = urlparse(value)
        host = (parsed.hostname or "").casefold()
        if parsed.scheme != "https" or not host or not (host == "caixa.gov.br" or host.endswith(".caixa.gov.br")):
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                f"{field} da CAIXA precisa usar HTTPS em domínio oficial *.caixa.gov.br.",
                details={"field": field, "host": host or "ausente"},
            )
        return value.rstrip("/"), host

    @classmethod
    def _configuration(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
    ) -> tuple[str, str, str, str, tuple[str, ...], str, str, str, str, str, str, str, set[str]]:
        normalized = environment.upper()
        resource_base = cls._resource_bases.get(normalized)
        if resource_base is None:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "O driver CAIXA aceita somente SANDBOX ou PRODUCTION.",
                details={"environment": normalized},
            )
        values = {
            key: str(credentials.get(key) or "").strip()
            for key in (
                "client_id",
                "client_secret",
                "token_url",
                "scope",
                "oauth_client_auth",
                "oauth_body_mode",
                "oauth_client_id_field",
                "oauth_client_secret_field",
                "pix_key",
                "user_agent",
                "certificate",
                "private_key",
            )
        }
        required = (
            "client_id",
            "client_secret",
            "token_url",
            "scope",
            "oauth_client_auth",
            "oauth_body_mode",
            "pix_key",
            "user_agent",
        )
        missing = [field for field in required if not values[field]]
        if bool(values["certificate"]) != bool(values["private_key"]):
            missing.extend(field for field in ("certificate", "private_key") if not values[field])
        if missing:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "Credenciais CAIXA incompletas para o ambiente selecionado.",
                details={"missing_fields": sorted(set(missing))},
            )
        client_auth = values["oauth_client_auth"].upper()
        body_mode = values["oauth_body_mode"].upper()
        if client_auth not in {"BASIC", "BODY"}:
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                "oauth_client_auth da CAIXA deve ser BASIC ou BODY conforme onboarding.",
            )
        if body_mode not in {"FORM", "JSON"}:
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                "oauth_body_mode da CAIXA deve ser FORM ou JSON conforme onboarding.",
            )
        token_url, token_host = cls._official_url(values["token_url"], field="token_url")
        resource_url, resource_host = cls._official_url(resource_base, field="resource_base_url")
        scopes = tuple(item for item in values["scope"].split() if item)
        if not scopes:
            raise BankProviderError("BANK_INVALID_CREDENTIALS", "Scope OAuth CAIXA não informado.")
        id_field = values["oauth_client_id_field"] or "cliente_id"
        secret_field = values["oauth_client_secret_field"] or "cliente_secret"
        return (
            token_url,
            resource_url,
            values["client_id"],
            values["client_secret"],
            scopes,
            values["pix_key"],
            values["user_agent"],
            client_auth,
            body_mode,
            id_field,
            secret_field,
            values["certificate"],
            values["private_key"],
            {token_host, resource_host},
        )

    @classmethod
    @asynccontextmanager
    async def _client(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
    ) -> AsyncIterator[tuple[BankHTTPClient, str]]:
        (
            token_url,
            resource_base,
            client_id,
            client_secret,
            scopes,
            pix_key,
            user_agent,
            client_auth,
            body_mode,
            client_id_field,
            client_secret_field,
            certificate,
            private_key,
            allowed_hosts,
        ) = cls._configuration(environment=environment, credentials=credentials)
        certificate_context = (
            temporary_client_certificate(certificate, private_key, prefix="connect-api-caixa")
            if certificate and private_key
            else _without_certificate()
        )
        async with certificate_context as cert:
            auth = OAuth2ClientCredentials(
                provider=cls.name,
                environment=environment.upper(),
                token_url=token_url,
                allowed_hosts=allowed_hosts,
                client_id=client_id,
                client_secret=client_secret,
                redis=None,
                scopes=scopes,
                client_auth=client_auth,
                body_mode=body_mode,
                client_id_field=client_id_field,
                client_secret_field=client_secret_field,
                cert=cert,
            )
            material = await auth.material()
            async with BankHTTPClient(
                provider=cls.name,
                base_url=resource_base,
                allowed_hosts=allowed_hosts,
                headers={
                    **material.headers,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": user_agent,
                },
                cert=cert,
            ) as client:
                yield client, pix_key

    @staticmethod
    def _agreement(agreement: dict[str, Any] | None) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = agreement or {}
        return (
            str(agreement.get("environment") or "SANDBOX").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    async def health_check(self, context: Any) -> dict[str, Any]:
        async with self._client(
            environment=context.environment.value,
            credentials=context.credentials,
        ):
            pass
        return {
            "status": "CONNECTED",
            "provider": self.name,
            "authentication_verified": True,
            "financial_operation": False,
        }

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "O driver CAIXA rc.28 implementa somente Pix Cob imediata.",
                422,
                {"provider": self.name, "charge_type": request.charge_type.upper()},
            )
        if Decimal(request.amount) <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor da cobrança precisa ser maior que zero.", 422)
        environment, credentials, settings = self._agreement(request.agreement)
        try:
            expiration = int(settings.get("pix_expiration_seconds", 3600))
        except (TypeError, ValueError) as exc:
            raise APIError("BANK_INVALID_CONFIGURATION", "pix_expiration_seconds deve ser inteiro.", 422) from exc
        if expiration <= 0:
            raise APIError("BANK_INVALID_CONFIGURATION", "pix_expiration_seconds deve ser maior que zero.", 422)
        txid = BacenPixCobMTLSProvider.txid(request.internal_id)
        debtor = BacenPixCobMTLSProvider.debtor(request)
        try:
            async with self._client(environment=environment, credentials=credentials) as (client, pix_key):
                payload: dict[str, Any] = {
                    "calendario": {"expiracao": expiration},
                    "valor": {"original": f"{Decimal(request.amount):.2f}"},
                    "chave": pix_key,
                }
                if debtor:
                    payload["devedor"] = debtor
                if request.description:
                    payload["solicitacaoPagador"] = request.description[:140]
                data = (await client.request("PUT", f"/cob/{txid}", json=payload)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return BacenPixCobMTLSProvider.result_from_payload(self.name, txid, data)

    async def get_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> BankChargeResult:
        environment, credentials, _ = self._agreement(agreement)
        txid = BacenPixCobMTLSProvider.txid(external_id)
        try:
            async with self._client(environment=environment, credentials=credentials) as (client, _):
                data = (await client.request("GET", f"/cob/{txid}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return BacenPixCobMTLSProvider.result_from_payload(self.name, txid, data)

    async def cancel_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> None:
        environment, credentials, _ = self._agreement(agreement)
        txid = BacenPixCobMTLSProvider.txid(external_id)
        try:
            async with self._client(environment=environment, credentials=credentials) as (client, _):
                await client.request(
                    "PATCH",
                    f"/cob/{txid}",
                    json={"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"},
                )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
