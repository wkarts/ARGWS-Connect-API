from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant_context_dep, get_tenant_db
from app.core.config import settings
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.tenant_context import TenantContext
from app.core.webhook_security import validate_webhook_timestamp
from app.models.tenant import Charge, IntegrationSetting, Notification, Receivable, WebhookEvent
from app.services.billing import BillingService

router = APIRouter(prefix="/api/v1/webhooks", tags=["Webhooks"])


def payload_event_id(provider: str, payload: dict[str, Any], raw: bytes) -> str:
    return str(
        payload.get("event_id")
        or payload.get("id")
        or payload.get("key", {}).get("id")
        or payload.get("data", {}).get("key", {}).get("id")
        or f"{provider}-{hashlib.sha256(raw).hexdigest()}"
    )[:180]


async def persist_webhook(
    session: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    payload: dict[str, Any],
    raw: bytes,
    signature_valid: bool,
) -> tuple[WebhookEvent, bool]:
    item_id = uuid4()
    statement = (
        pg_insert(WebhookEvent)
        .values(
            id=item_id,
            provider=provider,
            event_id=event_id,
            event_type=event_type,
            signature_valid=signature_valid,
            payload_hash=hashlib.sha256(raw).hexdigest(),
            payload=payload,
            status="RECEIVED",
            received_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(constraint="uq_webhook_provider_event")
        .returning(WebhookEvent.id)
    )
    inserted_id = await session.scalar(statement)
    if inserted_id is None:
        existing = await session.scalar(
            select(WebhookEvent).where(
                WebhookEvent.provider == provider,
                WebhookEvent.event_id == event_id,
            )
        )
        if existing is None:
            raise APIError(
                "WEBHOOK_IDEMPOTENCY_CONFLICT",
                "Não foi possível recuperar o evento idempotente.",
                409,
            )
        return existing, False
    item = await session.get(WebhookEvent, inserted_id)
    if item is None:
        raise APIError("WEBHOOK_PERSISTENCE_FAILED", "Falha ao persistir webhook.", 500)
    return item, True


async def configured_webhook_secrets(
    session: AsyncSession,
    providers: list[str],
    global_secret: str = "",
) -> list[str]:
    values = [global_secret] if global_secret else []
    items = list(
        (
            await session.execute(
                select(IntegrationSetting).where(
                    IntegrationSetting.provider.in_([item.upper() for item in providers]),
                    IntegrationSetting.is_enabled.is_(True),
                )
            )
        ).scalars()
    )
    for item in items:
        if not item.encrypted_secrets:
            continue
        try:
            data = json.loads(secret_cipher.decrypt(item.encrypted_secrets))
            value = str(data.get("webhook_secret") or data.get("auth_token") or "")
            if value:
                values.append(value)
        except Exception:  # segredo inválido é tratado como integração sem credencial
            continue
    return list(dict.fromkeys(values))


def valid_shared_secret(provided: str, expected: list[str]) -> bool:
    return bool(
        provided
        and any(hmac.compare_digest(provided, value) for value in expected if value)
    )


def parse_provider_datetime(value: Any) -> datetime:
    if value in (None, ""):
        return datetime.now(UTC)
    text = str(value).strip().replace("Z", "+00:00")
    for candidate in (text, text.replace(" ", "T")):
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return datetime.now(UTC)


@router.post("/evolution", response_model=dict)
async def evolution_webhook(
    request: Request,
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
    x_webhook_secret: str = Header(default=""),
    x_webhook_timestamp: str = Header(default=""),
) -> dict:
    try:
        validate_webhook_timestamp(
            x_webhook_timestamp,
            max_age_seconds=settings.webhook_max_age_seconds,
        )
    except ValueError as exc:
        raise APIError("STALE_WEBHOOK", "Timestamp do webhook inválido ou expirado.", 401) from exc
    raw = await request.body()
    try:
        payload: dict[str, Any] = json.loads(raw or b"{}")
    except json.JSONDecodeError as exc:
        raise APIError("INVALID_WEBHOOK_JSON", "Payload JSON inválido.", 400) from exc
    expected = await configured_webhook_secrets(
        session,
        ["EVOLUTION"],
        settings.evolution_webhook_secret,
    )
    signature_valid = valid_shared_secret(x_webhook_secret, expected)
    if not expected and settings.app_env == "production":
        raise APIError("WEBHOOK_SECRET_NOT_CONFIGURED", "Webhook Evolution sem segredo configurado.", 503)
    if expected and not signature_valid:
        raise APIError("INVALID_WEBHOOK_SIGNATURE", "Assinatura do webhook inválida.", 401)
    event_type = str(payload.get("event") or payload.get("type") or "UNKNOWN").upper()
    event_id = payload_event_id("EVOLUTION", payload, raw)
    event, created = await persist_webhook(
        session,
        provider="EVOLUTION",
        event_id=event_id,
        event_type=event_type,
        payload=payload,
        raw=raw,
        signature_valid=signature_valid or not bool(expected),
    )
    if not created:
        return {"success": True, "idempotent": True, "event_id": event_id}
    message_id = (
        payload.get("data", {}).get("key", {}).get("id")
        or payload.get("key", {}).get("id")
        or payload.get("messageId")
    )
    status_map = {
        "MESSAGES.UPDATE": "DELIVERED",
        "SEND_MESSAGE": "SENT",
        "MESSAGE.DELIVERED": "DELIVERED",
        "MESSAGE.READ": "READ",
        "MESSAGES_UPSERT": "DELIVERED",
    }
    if message_id:
        notification = await session.scalar(
            select(Notification).where(Notification.external_id == str(message_id))
        )
        if notification:
            notification.status = status_map.get(event_type, notification.status)
            now = datetime.now(UTC)
            if notification.status == "DELIVERED":
                notification.delivered_at = now
            elif notification.status == "READ":
                notification.read_at = now
    event.status = "PROCESSED"
    event.processed_at = datetime.now(UTC)
    await session.commit()
    return {"success": True, "event_id": event_id, "tenant_id": context.tenant_id}


async def process_asaas_event(
    session: AsyncSession,
    *,
    payload: dict[str, Any],
    event_type: str,
    event_id: str,
) -> None:
    payment = payload.get("payment") if isinstance(payload.get("payment"), dict) else {}
    external_charge_id = str(payment.get("id") or "")
    charge = None
    receivable_id: str | None = None
    if external_charge_id:
        charge = await session.scalar(
            select(Charge).where(
                Charge.provider == "ASAAS",
                Charge.external_id == external_charge_id,
            )
        )
        if charge:
            receivable_id = str(charge.receivable_id)

    paid_events = {
        "PAYMENT_CONFIRMED",
        "PAYMENT_RECEIVED",
        "PAYMENT_RECEIVED_IN_CASH",
        "PAYMENT_DUNNING_RECEIVED",
    }
    if event_type in paid_events:
        if not charge or not receivable_id:
            raise APIError(
                "WEBHOOK_RECEIVABLE_NOT_RESOLVED",
                "A cobrança Asaas recebida não está vinculada a um recebível local.",
                422,
                {"external_charge_id": external_charge_id},
            )
        amount = Decimal(str(payment.get("value") or payment.get("netValue") or "0"))
        if amount <= 0:
            raise APIError("WEBHOOK_PAYMENT_AMOUNT_INVALID", "Valor recebido no webhook é inválido.", 422)
        paid_at = parse_provider_datetime(
            payment.get("paymentDate")
            or payment.get("clientPaymentDate")
            or payment.get("confirmedDate")
            or payload.get("dateCreated")
        )
        await BillingService(session).register_payment(
            receivable_id=receivable_id,
            charge_id=str(charge.id),
            provider="ASAAS",
            # O ID da cobrança é estável entre PAYMENT_CONFIRMED e PAYMENT_RECEIVED,
            # evitando dupla baixa quando os dois eventos forem enviados.
            external_id=external_charge_id,
            end_to_end_id=payment.get("pixTransaction") or payment.get("endToEndIdentifier"),
            amount=amount,
            paid_at=paid_at,
            payment_method=str(payment.get("billingType") or "UNDEFINED"),
            raw_payload=payload,
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
    }.get(event_type)
    if charge_status:
        charge.status = charge_status
        receivable = await session.get(Receivable, charge.receivable_id)
        if receivable and charge_status == "OVERDUE" and receivable.status not in {"PAID", "CANCELLED"}:
            receivable.status = "OVERDUE"


@router.post("/banking/{provider}", response_model=dict)
async def banking_webhook(
    provider: str,
    request: Request,
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
    x_webhook_secret: str = Header(default=""),
    x_webhook_timestamp: str = Header(default=""),
    asaas_access_token: str = Header(default="", alias="asaas-access-token"),
) -> dict:
    provider_name = provider.upper()
    if provider_name != "ASAAS":
        try:
            validate_webhook_timestamp(
                x_webhook_timestamp,
                max_age_seconds=settings.webhook_max_age_seconds,
            )
        except ValueError as exc:
            raise APIError("STALE_WEBHOOK", "Timestamp do webhook inválido ou expirado.", 401) from exc
    raw = await request.body()
    try:
        payload: dict[str, Any] = json.loads(raw or b"{}")
    except json.JSONDecodeError as exc:
        raise APIError("INVALID_WEBHOOK_JSON", "Payload JSON inválido.", 400) from exc

    expected = await configured_webhook_secrets(
        session,
        [provider_name, f"BANKING_{provider_name}"],
        settings.banking_webhook_secret,
    )
    provided_secret = asaas_access_token if provider_name == "ASAAS" else x_webhook_secret
    if not expected and settings.app_env == "production":
        raise APIError("WEBHOOK_SECRET_NOT_CONFIGURED", "Webhook bancário sem segredo configurado.", 503)
    signature_valid = valid_shared_secret(provided_secret, expected) if expected else settings.app_env != "production"
    if expected and not signature_valid:
        raise APIError("INVALID_WEBHOOK_SIGNATURE", "Assinatura do webhook inválida.", 401)

    event_id = payload_event_id(provider_name, payload, raw)
    event_type = str(payload.get("event") or payload.get("type") or "PAYMENT").upper()
    event, created = await persist_webhook(
        session,
        provider=provider_name,
        event_id=event_id,
        event_type=event_type,
        payload=payload,
        raw=raw,
        signature_valid=signature_valid,
    )
    if not created:
        return {"success": True, "idempotent": True, "event_id": event_id}

    try:
        if provider_name == "ASAAS":
            await process_asaas_event(
                session,
                payload=payload,
                event_type=event_type,
                event_id=event_id,
            )
        elif event_type in {"PAYMENT", "PAID", "CHARGE.PAID", "PIX_RECEIVED"}:
            receivable_id = payload.get("receivable_id")
            charge_external_id = payload.get("charge_external_id") or payload.get("external_charge_id")
            charge = None
            if charge_external_id:
                charge = await session.scalar(
                    select(Charge).where(
                        Charge.provider == provider_name,
                        Charge.external_id == str(charge_external_id),
                    )
                )
                if charge:
                    receivable_id = str(charge.receivable_id)
            if not receivable_id:
                raise APIError(
                    "WEBHOOK_RECEIVABLE_NOT_RESOLVED",
                    "Não foi possível identificar o recebível.",
                    422,
                )
            await BillingService(session).register_payment(
                receivable_id=str(receivable_id),
                charge_id=str(charge.id) if charge else None,
                provider=provider_name,
                external_id=str(payload.get("payment_id") or event_id),
                end_to_end_id=payload.get("end_to_end_id") or payload.get("endToEndId"),
                amount=Decimal(str(payload["amount"])),
                paid_at=parse_provider_datetime(payload.get("paid_at")),
                payment_method=str(payload.get("payment_method") or "PIX"),
                raw_payload=payload,
            )
        event.status = "PROCESSED"
        event.processed_at = datetime.now(UTC)
    except Exception as exc:
        event.status = "FAILED"
        event.last_error = str(exc)[:2000]
        event.processed_at = datetime.now(UTC)
        await session.commit()
        raise
    await session.commit()
    return {"success": True, "event_id": event_id, "tenant_id": context.tenant_id}
