from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.models.banking import BankConnection
from app.models.tenant import Charge, IntegrationSetting, Receivable
from app.providers.banking.contracts.webhooks import BankWebhookEvent, BankWebhookRequest
from app.providers.banking.core.credentials import decrypt_credentials
from app.providers.banking.core.normalization import sanitize_mapping
from app.services.billing import BillingService


class AsaasWebhookHandler:
    provider = "ASAAS"

    @staticmethod
    def _header(request: BankWebhookRequest, name: str) -> str:
        target = name.casefold()
        for key, value in request.headers.items():
            if key.casefold() == target:
                return str(value)
        return ""

    @staticmethod
    def _payment(payload: dict[str, Any]) -> dict[str, Any]:
        value = payload.get("payment")
        return value if isinstance(value, dict) else {}

    async def _connection_secret(self, session: AsyncSession, payload: dict[str, Any]) -> tuple[str | None, str | None]:
        payment = self._payment(payload)
        external_id = str(payment.get("id") or "")
        if not external_id:
            return None, None
        charge = await session.scalar(
            select(Charge).where(Charge.provider == "ASAAS", Charge.external_id == external_id)
        )
        if charge is None or charge.bank_agreement_id is None:
            return None, None
        result = await session.execute(
            text("SELECT bank_connection_id FROM bank_agreements WHERE id=:id"),
            {"id": str(charge.bank_agreement_id)},
        )
        connection_id = result.scalar_one_or_none()
        if not connection_id:
            return None, None
        connection = await session.get(BankConnection, UUID(str(connection_id)))
        if connection is None:
            return None, None
        credentials = decrypt_credentials(connection.encrypted_credentials)
        secret = str(
            credentials.get("webhook_token")
            or credentials.get("webhook_secret")
            or connection.settings.get("webhook_token")
            or ""
        ).strip()
        return secret or None, str(connection.id)

    async def _legacy_secrets(self, session: AsyncSession) -> list[str]:
        values: list[str] = []
        items = list((await session.scalars(
            select(IntegrationSetting).where(
                IntegrationSetting.provider.in_(["ASAAS", "BANKING_ASAAS"]),
                IntegrationSetting.is_enabled.is_(True),
            )
        )).all())
        for item in items:
            if not item.encrypted_secrets:
                continue
            try:
                secrets_data = json.loads(secret_cipher.decrypt(item.encrypted_secrets))
            except Exception:
                continue
            value = str(
                secrets_data.get("webhook_token")
                or secrets_data.get("webhook_secret")
                or secrets_data.get("auth_token")
                or ""
            ).strip()
            if value:
                values.append(value)
        if settings.banking_webhook_secret:
            values.append(settings.banking_webhook_secret)
        return list(dict.fromkeys(values))

    async def verify(
        self,
        session: AsyncSession,
        request: BankWebhookRequest,
        payload: dict[str, Any],
    ) -> tuple[bool, str | None]:
        provided = self._header(request, "asaas-access-token")
        connection_secret, connection_id = await self._connection_secret(session, payload)
        expected = [connection_secret] if connection_secret else await self._legacy_secrets(session)
        expected = [item for item in expected if item]
        if not expected:
            if settings.app_env == "production":
                raise APIError(
                    "BANK_WEBHOOK_INVALID",
                    "Webhook Asaas sem token de autenticação configurado.",
                    503,
                )
            return True, connection_id
        valid = bool(provided and any(hmac.compare_digest(provided, value) for value in expected))
        if not valid:
            raise APIError("BANK_WEBHOOK_INVALID", "Autenticidade do webhook Asaas inválida.", 401)
        return True, connection_id

    async def parse(
        self,
        request: BankWebhookRequest,
        payload: dict[str, Any],
        *,
        signature_valid: bool,
    ) -> BankWebhookEvent:
        raw_hash = hashlib.sha256(request.raw_body).hexdigest()
        event_type = str(payload.get("event") or "UNKNOWN").upper()
        event_id = str(payload.get("id") or f"ASAAS-{raw_hash}")[:180]
        headers = {
            "content-type": self._header(request, "content-type"),
            "user-agent": self._header(request, "user-agent")[:250],
        }
        return BankWebhookEvent(
            provider_event_id=event_id,
            event_type=event_type,
            signature_valid=signature_valid,
            payload_hash=raw_hash,
            payload=payload,
            normalized_payload={
                "event_type": event_type,
                "payment_id": self._payment(payload).get("id"),
                "status": self._payment(payload).get("status"),
            },
            headers_sanitized=sanitize_mapping(headers),
        )

    @staticmethod
    def _datetime(value: Any) -> datetime:
        if not value:
            return datetime.now(UTC)
        text_value = str(value).strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text_value)
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed
        except ValueError:
            return datetime.now(UTC)

    async def process(self, session: AsyncSession, event: BankWebhookEvent) -> None:
        payload = event.payload
        payment = self._payment(payload)
        external_id = str(payment.get("id") or "")
        charge = None
        if external_id:
            charge = await session.scalar(
                select(Charge).where(Charge.provider == "ASAAS", Charge.external_id == external_id)
            )

        paid_events = {
            "PAYMENT_CONFIRMED",
            "PAYMENT_RECEIVED",
            "PAYMENT_RECEIVED_IN_CASH",
            "PAYMENT_DUNNING_RECEIVED",
        }
        if event.event_type in paid_events:
            if charge is None:
                raise APIError(
                    "BANK_RESOURCE_NOT_FOUND",
                    "Cobrança Asaas do webhook não está vinculada a um título local.",
                    422,
                    {"provider_payment_id": external_id},
                )
            amount = Decimal(str(payment.get("value") or payment.get("netValue") or "0"))
            if amount <= 0:
                raise APIError("BANK_RESPONSE_INVALID", "Valor de pagamento inválido no webhook Asaas.", 422)
            await BillingService(session).register_payment(
                receivable_id=str(charge.receivable_id),
                charge_id=str(charge.id),
                provider="ASAAS",
                external_id=external_id,
                end_to_end_id=payment.get("pixTransaction") or payment.get("endToEndIdentifier"),
                amount=amount,
                paid_at=self._datetime(
                    payment.get("paymentDate")
                    or payment.get("clientPaymentDate")
                    or payment.get("confirmedDate")
                    or payload.get("dateCreated")
                ),
                payment_method=str(payment.get("billingType") or "UNDEFINED"),
                raw_payload=payload,
                commit=False,
            )
            charge.status = "PAID"
            return

        if charge is None:
            return
        charge_status = {
            "PAYMENT_CREATED": "PENDING",
            "PAYMENT_UPDATED": str(payment.get("status") or "PENDING").upper(),
            "PAYMENT_OVERDUE": "OVERDUE",
            "PAYMENT_DELETED": "CANCELLED",
            "PAYMENT_REFUNDED": "REFUNDED",
            "PAYMENT_REFUND_IN_PROGRESS": "REFUNDING",
            "PAYMENT_CHARGEBACK_REQUESTED": "CHARGEBACK",
        }.get(event.event_type)
        if charge_status:
            charge.status = charge_status
            receivable = await session.get(Receivable, charge.receivable_id)
            if receivable and charge_status == "OVERDUE" and receivable.status not in {"PAID", "CANCELLED"}:
                receivable.status = "OVERDUE"


asaas_webhook_handler = AsaasWebhookHandler()
