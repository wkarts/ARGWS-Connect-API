from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Any

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient


class MercadoPagoBankingProvider:
    name = "MERCADO_PAGO"
    driver_version = "1.0.0-rc.28"
    base_url = "https://api.mercadopago.com"
    allowed_hosts = {"api.mercadopago.com"}

    @classmethod
    def _client(cls, credentials: dict[str, Any]) -> BankHTTPClient:
        token = str(credentials.get("access_token") or "").strip()
        if not token:
            raise APIError("BANK_INVALID_CREDENTIALS", "Informe o Access Token do Mercado Pago.", 422)
        return BankHTTPClient(
            provider=cls.name,
            base_url=cls.base_url,
            allowed_hosts=cls.allowed_hosts,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"},
        )

    @staticmethod
    def _agreement(value: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
        value = value or {}
        return dict(value.get("credentials") or {}), dict(value.get("settings") or {})

    @staticmethod
    def _payment(data: dict[str, Any]) -> dict[str, Any]:
        payments = ((data.get("transactions") or {}).get("payments") or [])
        return payments[0] if payments and isinstance(payments[0], dict) else {}

    @classmethod
    def _result(cls, data: dict[str, Any], fallback: str = "") -> BankChargeResult:
        payment = cls._payment(data)
        method = payment.get("payment_method") if isinstance(payment.get("payment_method"), dict) else {}
        return BankChargeResult(
            provider=cls.name,
            external_id=str(data.get("id") or fallback),
            status=str(payment.get("status") or data.get("status") or "ACTION_REQUIRED").upper(),
            txid=str(payment.get("id") or "") or None,
            pix_copy_paste=method.get("qr_code"),
            document_url=method.get("ticket_url"),
            raw={"id": data.get("id"), "status": data.get("status"), "payment_id": payment.get("id"), "payment_status": payment.get("status")},
        )

    @staticmethod
    def _key(prefix: str, value: str) -> str:
        return hashlib.sha256(f"{prefix}:{value}".encode()).hexdigest()[:32]

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        client = self._client(context.credentials)
        await client.aclose()
        return {"status": "CONFIGURED", "provider": self.name, "authentication_verified": False, "financial_operation": False}

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError("BANK_CAPABILITY_NOT_SUPPORTED", "O driver Mercado Pago rc.28 implementa somente Pix via Orders.", 422)
        email = str(request.customer.email or "").strip()
        amount = Decimal(request.amount)
        if not email:
            raise APIError("BANK_INVALID_REQUEST", "O Mercado Pago exige e-mail do pagador.", 422)
        if amount <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor precisa ser maior que zero.", 422)
        credentials, settings = self._agreement(request.agreement)
        payload = {
            "type": "online",
            "total_amount": f"{amount:.2f}",
            "external_reference": request.internal_id[:64],
            "processing_mode": "automatic",
            "transactions": {"payments": [{"amount": f"{amount:.2f}", "payment_method": {"id": "pix", "type": "bank_transfer"}, "expiration_time": str(settings.get("pix_expiration_iso8601") or "P1D")}]},
            "payer": {"email": email},
        }
        client = self._client(credentials)
        try:
            async with client:
                data = (await client.request("POST", "/v1/orders", json=payload, headers={"X-Idempotency-Key": self._key("create", request.internal_id)})).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data)

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult:
        credentials, _ = self._agreement(agreement)
        try:
            async with self._client(credentials) as client:
                data = (await client.request("GET", f"/v1/orders/{external_id}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data, external_id)

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        credentials, _ = self._agreement(agreement)
        try:
            async with self._client(credentials) as client:
                await client.request("POST", f"/v1/orders/{external_id}/cancel", json={}, headers={"X-Idempotency-Key": self._key("cancel", external_id)})
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
