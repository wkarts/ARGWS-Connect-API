from __future__ import annotations

import hashlib
import re
from decimal import Decimal
from typing import Any

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient


class PicPayBankingProvider:
    name = "PICPAY"
    driver_version = "1.0.0-rc.28"
    _base_urls = {
        "HOMOLOGATION": "https://ecommerce-api.svcp.ppay.me",
        "PRODUCTION": "https://ecommerce-api.svcp.picpay.com",
    }
    _allowed_hosts = {"ecommerce-api.svcp.ppay.me", "ecommerce-api.svcp.picpay.com"}

    @classmethod
    def _configuration(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
    ) -> tuple[str, str, str, int]:
        base_url = cls._base_urls.get(environment.upper())
        if base_url is None:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "O driver PicPay aceita somente HOMOLOGATION ou PRODUCTION.",
                details={"environment": environment},
            )
        client_id = str(credentials.get("client_id") or "").strip()
        client_secret = str(credentials.get("client_secret") or "").strip()
        if not client_id or not client_secret:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "Informe client_id e client_secret do PicPay.",
            )
        try:
            expiration = int((settings or {}).get("pix_expiration_seconds", 900))
        except (TypeError, ValueError) as exc:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "pix_expiration_seconds deve ser inteiro.",
            ) from exc
        if expiration <= 0:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "pix_expiration_seconds deve ser maior que zero.",
            )
        return base_url, client_id, client_secret, expiration

    @classmethod
    async def _client(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
    ) -> tuple[BankHTTPClient, int]:
        base_url, client_id, client_secret, expiration = cls._configuration(
            environment=environment,
            credentials=credentials,
            settings=settings,
        )
        auth = OAuth2ClientCredentials(
            provider=cls.name,
            environment=environment.upper(),
            token_url=f"{base_url}/oauth2/token",
            allowed_hosts=cls._allowed_hosts,
            client_id=client_id,
            client_secret=client_secret,
            redis=None,
            client_auth="BODY",
            body_mode="JSON",
        )
        material = await auth.material()
        return (
            BankHTTPClient(
                provider=cls.name,
                base_url=base_url,
                allowed_hosts=cls._allowed_hosts,
                headers={
                    **material.headers,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "Connect-API-Platform/1.0",
                },
            ),
            expiration,
        )

    @staticmethod
    def _merchant_charge_id(internal_id: str) -> str:
        candidate = re.sub(r"[^A-Za-z0-9-]", "", internal_id)
        if 6 <= len(candidate) <= 36:
            return candidate
        return hashlib.sha256(internal_id.encode("utf-8")).hexdigest()[:32]

    @staticmethod
    def _customer(request: BankChargeRequest) -> dict[str, Any]:
        tax_id = re.sub(r"\D", "", request.customer.tax_id or "")
        email = str(request.customer.email or "").strip()
        if not request.customer.name.strip() or not email:
            raise APIError(
                "BANK_INVALID_REQUEST",
                "O PicPay exige nome e e-mail do pagador.",
                422,
            )
        if len(tax_id) == 11:
            document_type = "CPF"
        elif len(tax_id) == 14:
            document_type = "CNPJ"
        else:
            raw = str(request.customer.tax_id or "").strip().upper()
            if not raw or len(raw) > 20:
                raise APIError(
                    "BANK_INVALID_REQUEST",
                    "O PicPay exige CPF, CNPJ ou passaporte do pagador.",
                    422,
                )
            document_type = "PASSPORT"
            tax_id = raw
        customer: dict[str, Any] = {
            "name": request.customer.name[:255],
            "email": email,
            "documentType": document_type,
            "document": tax_id,
        }
        phone = re.sub(r"\D", "", request.customer.phone or "")
        if len(phone) >= 10:
            national = phone[-11:]
            area = national[:2]
            number = national[2:]
            customer["phone"] = {
                "countryCode": "55",
                "areaCode": area,
                "number": number,
                "type": "MOBILE",
            }
        return customer

    @staticmethod
    def _pix_transaction(data: dict[str, Any]) -> dict[str, Any]:
        transactions = data.get("transactions") or []
        for item in transactions:
            if isinstance(item, dict) and str(item.get("paymentType") or "").upper() == "PIX":
                return item
        return {}

    @classmethod
    def _result(cls, merchant_charge_id: str, data: dict[str, Any]) -> BankChargeResult:
        transaction = cls._pix_transaction(data)
        pix = transaction.get("pix") if isinstance(transaction.get("pix"), dict) else {}
        return BankChargeResult(
            provider=cls.name,
            external_id=str(data.get("merchantChargeId") or merchant_charge_id),
            status=str(transaction.get("transactionStatus") or data.get("chargeStatus") or "PENDING").upper(),
            txid=str(transaction.get("transactionId") or "") or None,
            pix_copy_paste=pix.get("qrCode"),
            raw={
                "id": data.get("id"),
                "merchantChargeId": data.get("merchantChargeId"),
                "chargeStatus": data.get("chargeStatus"),
                "transactionId": transaction.get("transactionId"),
                "transactionStatus": transaction.get("transactionStatus"),
                "endToEndId": pix.get("endToEndId"),
            },
        )

    @staticmethod
    def _agreement(agreement: dict[str, Any] | None) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = agreement or {}
        return (
            str(agreement.get("environment") or "HOMOLOGATION").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        client, _ = await self._client(
            environment=context.environment.value,
            credentials=context.credentials,
            settings=context.settings,
        )
        await client.aclose()
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
                "O driver PicPay rc.28 implementa somente Pix Cob.",
                422,
            )
        cents = int((Decimal(request.amount) * 100).quantize(Decimal("1")))
        if cents <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor precisa ser maior que zero.", 422)
        environment, credentials, settings = self._agreement(request.agreement)
        client, expiration = await self._client(
            environment=environment,
            credentials=credentials,
            settings=settings,
        )
        merchant_charge_id = self._merchant_charge_id(request.internal_id)
        payload = {
            "paymentSource": "GATEWAY",
            "merchantChargeId": merchant_charge_id,
            "customer": self._customer(request),
            "transactions": [{"amount": cents, "pix": {"expiration": expiration}}],
        }
        try:
            async with client:
                data = (await client.request("POST", "/charge/pix", json=payload)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(merchant_charge_id, data)

    async def get_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> BankChargeResult:
        environment, credentials, settings = self._agreement(agreement)
        client, _ = await self._client(
            environment=environment,
            credentials=credentials,
            settings=settings,
        )
        try:
            async with client:
                data = (await client.request("GET", f"/charge/{external_id}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(external_id, data)

    async def cancel_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> None:
        environment, credentials, settings = self._agreement(agreement)
        client, _ = await self._client(
            environment=environment,
            credentials=credentials,
            settings=settings,
        )
        try:
            async with client:
                await client.request("POST", f"/charge/{external_id}/refund", json={})
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
