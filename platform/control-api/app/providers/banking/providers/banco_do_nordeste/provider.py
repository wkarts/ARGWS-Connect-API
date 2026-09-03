from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


class BancoDoNordesteBankingProvider:
    name = "BANCO_DO_NORDESTE"
    driver_version = "1.0.0-rc.28"

    _resource_bases = {
        "HOMOLOGATION": "https://api-h.bnb.gov.br/pix/v1",
        "PRODUCTION": "https://api.bnb.gov.br/pix/v1",
    }
    _header_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,126}$")

    @classmethod
    def _configuration(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
    ) -> tuple[str, str, str, str, str]:
        normalized = environment.upper()
        resource_base = cls._resource_bases.get(normalized)
        if resource_base is None:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "O driver Banco do Nordeste aceita somente HOMOLOGATION ou PRODUCTION.",
                details={"environment": normalized},
            )
        values = {
            key: str(credentials.get(key) or "").strip()
            for key in ("api_key", "api_secret", "api_key_header", "api_secret_header", "pix_key")
        }
        missing = [key for key, value in values.items() if not value]
        if missing:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "Credenciais BNB incompletas.",
                details={"missing_fields": missing},
            )
        for field in ("api_key_header", "api_secret_header"):
            if not cls._header_pattern.fullmatch(values[field]):
                raise BankProviderError(
                    "BANK_INVALID_CONFIGURATION",
                    "Nome de header de autenticação BNB inválido.",
                    details={"field": field},
                )
        if values["api_key_header"].casefold() == values["api_secret_header"].casefold():
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                "API Key e API Secret do BNB precisam usar headers distintos fornecidos pelo portal.",
            )
        return (
            resource_base,
            values["api_key"],
            values["api_secret"],
            values["api_key_header"],
            values["api_secret_header"],
        )

    @classmethod
    def _client(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
    ) -> tuple[BankHTTPClient, str]:
        resource_base, api_key, api_secret, api_key_header, api_secret_header = cls._configuration(
            environment=environment,
            credentials=credentials,
        )
        client = BankHTTPClient(
            provider=cls.name,
            base_url=resource_base,
            allowed_hosts={"api.bnb.gov.br", "api-h.bnb.gov.br"},
            headers={
                api_key_header: api_key,
                api_secret_header: api_secret,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "Connect-API-Platform/1.0",
            },
        )
        return client, str(credentials["pix_key"]).strip()

    @staticmethod
    def _agreement(agreement: dict[str, Any] | None) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = agreement or {}
        return (
            str(agreement.get("environment") or "HOMOLOGATION").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    async def health_check(self, context: Any) -> dict[str, Any]:
        # O portal BNB não publica um endpoint de introspecção/autenticação sem
        # efeito de negócio. Validamos configuração/hosts sem executar consulta financeira.
        self._configuration(environment=context.environment.value, credentials=context.credentials)
        return {
            "status": "CONFIGURED",
            "provider": self.name,
            "authentication_verified": False,
            "configuration_only": True,
            "financial_operation": False,
        }

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "O driver Banco do Nordeste rc.28 implementa somente Pix Cob imediata.",
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
        client: BankHTTPClient | None = None
        try:
            client, pix_key = self._client(environment=environment, credentials=credentials)
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
        finally:
            if client is not None:
                await client.aclose()
        return BacenPixCobMTLSProvider.result_from_payload(self.name, txid, data)

    async def get_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> BankChargeResult:
        environment, credentials, _ = self._agreement(agreement)
        txid = BacenPixCobMTLSProvider.txid(external_id)
        client: BankHTTPClient | None = None
        try:
            client, _ = self._client(environment=environment, credentials=credentials)
            data = (await client.request("GET", f"/cob/{txid}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        finally:
            if client is not None:
                await client.aclose()
        return BacenPixCobMTLSProvider.result_from_payload(self.name, txid, data)

    async def cancel_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> None:
        environment, credentials, _ = self._agreement(agreement)
        txid = BacenPixCobMTLSProvider.txid(external_id)
        client: BankHTTPClient | None = None
        try:
            client, _ = self._client(environment=environment, credentials=credentials)
            await client.request(
                "PATCH",
                f"/cob/{txid}",
                json={"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"},
            )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        finally:
            if client is not None:
                await client.aclose()
