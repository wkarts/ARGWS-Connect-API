from __future__ import annotations

import re
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any, AsyncIterator
from urllib.parse import urlparse

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider


class BS2BankingProvider:
    name = "BS2"
    driver_version = "1.0.0-rc.28"
    _official_suffixes = (".bs2.com", ".bancobonsucesso.com.br")

    @classmethod
    def _validated_url(cls, value: str, *, field: str) -> tuple[str, str]:
        parsed = urlparse(value)
        host = (parsed.hostname or "").casefold()
        if parsed.scheme != "https" or not host or not host.endswith(cls._official_suffixes):
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                f"{field} do BS2 precisa usar HTTPS em domínio oficial BS2/Banco Bonsucesso.",
                details={"field": field, "host": host or "ausente"},
            )
        return value.rstrip("/"), host

    @classmethod
    def _configuration(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
    ) -> tuple[str, str, str, str, tuple[str, ...], str, str | None, set[str]]:
        normalized = environment.upper()
        if normalized not in {"HOMOLOGATION", "PRODUCTION"}:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "O driver BS2 aceita somente HOMOLOGATION ou PRODUCTION.",
                details={"environment": normalized},
            )
        values = {
            key: str(credentials.get(key) or "").strip()
            for key in (
                "client_id",
                "client_secret",
                "scope",
                "token_url",
                "resource_base_url",
                "pix_key",
                "user_agent",
            )
        }
        required = ("client_id", "client_secret", "scope", "token_url", "resource_base_url", "pix_key")
        missing = [key for key in required if not values[key]]
        if normalized == "PRODUCTION" and not values["user_agent"]:
            missing.append("user_agent")
        if missing:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "Credenciais BS2 incompletas para o ambiente selecionado.",
                details={"missing_fields": sorted(set(missing))},
            )
        token_url, token_host = cls._validated_url(values["token_url"], field="token_url")
        resource_base_url, resource_host = cls._validated_url(
            values["resource_base_url"], field="resource_base_url"
        )
        scopes = tuple(item for item in values["scope"].split() if item)
        if not scopes:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "O scope liberado pelo API Banking BS2 precisa ser informado.",
            )
        return (
            token_url,
            resource_base_url,
            values["client_id"],
            values["client_secret"],
            scopes,
            values["pix_key"],
            values["user_agent"] or None,
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
            resource_base_url,
            client_id,
            client_secret,
            scopes,
            pix_key,
            user_agent,
            allowed_hosts,
        ) = cls._configuration(environment=environment, credentials=credentials)
        auth = OAuth2ClientCredentials(
            provider=cls.name,
            environment=environment.upper(),
            token_url=token_url,
            allowed_hosts=allowed_hosts,
            client_id=client_id,
            client_secret=client_secret,
            redis=None,
            scopes=scopes,
            client_auth="BASIC",
            body_mode="FORM",
        )
        material = await auth.material()
        headers = {
            **material.headers,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if user_agent:
            headers["User-Agent"] = user_agent
        async with BankHTTPClient(
            provider=cls.name,
            base_url=resource_base_url,
            allowed_hosts=allowed_hosts,
            headers=headers,
        ) as client:
            yield client, pix_key

    @staticmethod
    def _agreement(agreement: dict[str, Any] | None) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = agreement or {}
        return (
            str(agreement.get("environment") or "HOMOLOGATION").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    @staticmethod
    def _qr_code(data: dict[str, Any]) -> str | None:
        for key in ("qrCode", "qrcode", "qr_code"):
            value = data.get(key)
            if value not in (None, ""):
                return str(value)
        pix = data.get("pix")
        if isinstance(pix, dict):
            for key in ("qrCode", "qrcode", "qr_code"):
                value = pix.get(key)
                if value not in (None, ""):
                    return str(value)
        return None

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
                "O driver BS2 rc.28 implementa cobrança somente via Pix Cob imediata.",
                422,
                {"provider": self.name, "charge_type": request.charge_type.upper()},
            )
        if Decimal(request.amount) <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor da cobrança precisa ser maior que zero.", 422)
        environment, credentials, settings = self._agreement(request.agreement)
        txid = BacenPixCobMTLSProvider.txid(request.internal_id)
        try:
            expiration = int(settings.get("pix_expiration_seconds", 3600))
        except (TypeError, ValueError) as exc:
            raise APIError("BANK_INVALID_CONFIGURATION", "pix_expiration_seconds deve ser inteiro.", 422) from exc
        if expiration <= 0:
            raise APIError("BANK_INVALID_CONFIGURATION", "pix_expiration_seconds deve ser maior que zero.", 422)

        debtor = BacenPixCobMTLSProvider.debtor(request)
        try:
            async with self._client(environment=environment, credentials=credentials) as (client, pix_key):
                cobranca: dict[str, Any] = {
                    "calendario": {"expiracao": expiration},
                    "valor": {"original": f"{Decimal(request.amount):.2f}"},
                    "chave": pix_key,
                }
                if debtor:
                    cobranca["devedor"] = debtor
                if request.description:
                    cobranca["solicitacaoPagador"] = request.description[:140]
                payload = {
                    "txId": txid,
                    "cobranca": cobranca,
                    "validaPagador": bool(debtor),
                }
                data = (
                    await client.request(
                        "POST",
                        "/pix/direto/forintegration/v1/qrcodes/dinamico",
                        json=payload,
                    )
                ).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        provider_txid = str(data.get("txId") or data.get("txid") or txid)
        return BankChargeResult(
            provider=self.name,
            external_id=provider_txid,
            status=str(data.get("status") or "ATIVA").upper(),
            txid=provider_txid,
            pix_copy_paste=self._qr_code(data),
            raw={
                "id": data.get("id"),
                "txId": data.get("txId") or data.get("txid"),
                "status": data.get("status"),
                "location": data.get("location"),
            },
        )

    async def get_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> BankChargeResult:
        environment, credentials, _ = self._agreement(agreement)
        txid = re.sub(r"[^A-Za-z0-9]", "", external_id)
        if not txid:
            raise APIError("BANK_INVALID_REQUEST", "TxId BS2 inválido.", 422)
        try:
            async with self._client(environment=environment, credentials=credentials) as (client, _):
                data = (
                    await client.request(
                        "GET",
                        f"/pix/direto/forintegration/v1/cob/{txid}",
                    )
                ).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        provider_txid = str(data.get("txId") or data.get("txid") or txid)
        return BankChargeResult(
            provider=self.name,
            external_id=provider_txid,
            status=str(data.get("status") or "ATIVA").upper(),
            txid=provider_txid,
            pix_copy_paste=self._qr_code(data),
            raw={
                "txId": data.get("txId") or data.get("txid"),
                "status": data.get("status"),
                "location": data.get("location"),
                "revisao": data.get("revisao"),
            },
        )

    async def cancel_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> None:
        environment, credentials, _ = self._agreement(agreement)
        txid = re.sub(r"[^A-Za-z0-9]", "", external_id)
        if not txid:
            raise APIError("BANK_INVALID_REQUEST", "TxId BS2 inválido.", 422)
        try:
            async with self._client(environment=environment, credentials=credentials) as (client, pix_key):
                await client.request(
                    "PATCH",
                    f"/pix/direto/forintegration/v1/cob/{txid}",
                    json={
                        "status": "REMOVIDA_PELO_USUARIO_RECEBEDOR",
                        "chave": pix_key,
                    },
                )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
