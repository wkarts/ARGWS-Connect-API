from __future__ import annotations

import hashlib
import re
from decimal import Decimal
from typing import Any

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient


class PagBankBankingProvider:
    name = "PAGBANK"
    driver_version = "1.0.0-rc.28"
    _base_urls = {
        "SANDBOX": "https://sandbox.api.pagseguro.com",
        "PRODUCTION": "https://api.pagseguro.com",
    }
    _allowed_hosts = {"sandbox.api.pagseguro.com", "api.pagseguro.com"}

    @classmethod
    def _client(cls, environment: str, credentials: dict[str, Any]) -> BankHTTPClient:
        base_url = cls._base_urls.get(environment.upper())
        if base_url is None:
            raise APIError("BANK_INVALID_CONFIGURATION", "O PagBank aceita somente SANDBOX ou PRODUCTION.", 422)
        token = str(credentials.get("access_token") or "").strip()
        if not token:
            raise APIError("BANK_INVALID_CREDENTIALS", "Informe o token Bearer do PagBank.", 422)
        return BankHTTPClient(
            provider=cls.name,
            base_url=base_url,
            allowed_hosts=cls._allowed_hosts,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"},
        )

    @staticmethod
    def _agreement(value: dict[str, Any] | None) -> tuple[str, dict[str, Any], dict[str, Any]]:
        value = value or {}
        return str(value.get("environment") or "SANDBOX").upper(), dict(value.get("credentials") or {}), dict(value.get("settings") or {})

    @staticmethod
    def _tax_id(value: str | None) -> str:
        return re.sub(r"\D", "", value or "")

    @staticmethod
    def _idempotency(prefix: str, value: str) -> str:
        return hashlib.sha256(f"{prefix}:{value}".encode()).hexdigest()[:36]

    @staticmethod
    def _qr(data: dict[str, Any]) -> dict[str, Any]:
        values = data.get("qr_codes") or []
        return values[0] if values and isinstance(values[0], dict) else {}

    @staticmethod
    def _qr_image(qr: dict[str, Any]) -> str | None:
        for link in qr.get("links") or []:
            if isinstance(link, dict) and str(link.get("media") or "").upper() in {"IMAGE/PNG", "IMAGE/BASE64"}:
                return link.get("href")
        return None

    @classmethod
    def _result(cls, data: dict[str, Any], fallback: str = "") -> BankChargeResult:
        qr = cls._qr(data)
        charges = data.get("charges") or []
        charge = charges[0] if charges and isinstance(charges[0], dict) else {}
        return BankChargeResult(
            provider=cls.name,
            external_id=str(data.get("id") or fallback),
            status=str(charge.get("status") or ("ACTIVE" if qr else data.get("status") or "PENDING")).upper(),
            txid=str(qr.get("id") or "") or None,
            pix_copy_paste=qr.get("text"),
            document_url=cls._qr_image(qr),
            raw={"id": data.get("id"), "qr_code_id": qr.get("id"), "expiration_date": qr.get("expiration_date"), "charge_id": charge.get("id"), "charge_status": charge.get("status")},
        )

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        client = self._client(context.environment.value, context.credentials)
        await client.aclose()
        return {"status": "CONFIGURED", "provider": self.name, "authentication_verified": False, "financial_operation": False}

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError("BANK_CAPABILITY_NOT_SUPPORTED", "O driver PagBank rc.28 implementa somente Pix via Orders.", 422)
        amount = int((Decimal(request.amount) * 100).quantize(Decimal("1")))
        if amount <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor precisa ser maior que zero.", 422)
        environment, credentials, settings = self._agreement(request.agreement)
        tax_id = self._tax_id(request.customer.tax_id)
        customer: dict[str, Any] = {"name": request.customer.name}
        if request.customer.email:
            customer["email"] = request.customer.email
        if tax_id:
            customer["tax_id"] = tax_id
        payload: dict[str, Any] = {
            "reference_id": request.internal_id[:64],
            "customer": customer,
            "qr_codes": [{"amount": {"value": amount}}],
        }
        expiration = str(settings.get("pix_expiration_date") or "").strip()
        if expiration:
            payload["qr_codes"][0]["expiration_date"] = expiration
        client = self._client(environment, credentials)
        try:
            async with client:
                data = (await client.request("POST", "/orders", json=payload, headers={"x-idempotency-key": self._idempotency("order", request.internal_id)})).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data)

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult:
        environment, credentials, _ = self._agreement(agreement)
        try:
            async with self._client(environment, credentials) as client:
                data = (await client.request("GET", f"/orders/{external_id}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data, external_id)

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        environment, credentials, _ = self._agreement(agreement)
        try:
            async with self._client(environment, credentials) as client:
                order = (await client.request("GET", f"/orders/{external_id}")).json()
                charges = order.get("charges") or []
                charge = charges[0] if charges and isinstance(charges[0], dict) else {}
                charge_id = str(charge.get("id") or "").strip()
                amount = ((charge.get("amount") or {}).get("value"))
                if not charge_id or amount is None:
                    raise APIError(
                        "BANK_CAPABILITY_NOT_SUPPORTED",
                        "O pedido PagBank ainda não possui charge cancelável; o QR Pix permanece sujeito à expiração configurada.",
                        422,
                        {"provider": self.name, "order_id": external_id},
                    )
                await client.request(
                    "POST",
                    f"/charges/{charge_id}/cancel",
                    json={"amount": {"value": int(amount)}},
                    headers={"x-idempotency-key": self._idempotency("cancel", charge_id)},
                )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
