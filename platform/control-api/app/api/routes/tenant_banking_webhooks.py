from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant_context_dep, get_tenant_db
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.models.tenant import OutboxEvent, WebhookEvent
from app.providers.banking.contracts.webhooks import BankWebhookRequest
from app.providers.banking.core.capabilities import BankingCapability
from app.providers.banking.core.observability import BANK_WEBHOOK_INVALID_TOTAL, BANK_WEBHOOK_TOTAL
from app.providers.banking.core.webhook import banking_webhooks
from app.providers.banking.providers.asaas.webhook import asaas_webhook_handler
from app.providers.banking.registry import banking_providers

router = APIRouter(prefix="/api/v1/webhooks", tags=["Webhooks bancários"])

# Somente handlers específicos e auditáveis entram no registry. Catalogar um
# provider não instala implicitamente um parser de webhook.
banking_webhooks.register(asaas_webhook_handler)


async def _persist(
    session: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    payload_hash: str,
    payload: dict[str, Any],
    signature_valid: bool,
    connection_id: str | None,
    headers_sanitized: dict[str, Any],
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
            payload_hash=payload_hash,
            payload=payload,
            status="RECEIVED",
            received_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(constraint="uq_webhook_provider_event")
        .returning(WebhookEvent.id)
    )
    inserted_id = await session.scalar(statement)
    created = inserted_id is not None
    item = (
        await session.get(WebhookEvent, inserted_id)
        if created
        else await session.scalar(
            select(WebhookEvent).where(WebhookEvent.provider == provider, WebhookEvent.event_id == event_id)
        )
    )
    if item is None:
        raise APIError("BANK_WEBHOOK_INVALID", "Falha ao persistir inbox de webhook bancário.", 500)
    if created:
        await session.execute(
            text(
                "UPDATE webhook_events "
                "SET bank_connection_id=:connection_id, headers_sanitized=CAST(:headers AS jsonb) "
                "WHERE id=:id"
            ),
            {
                "connection_id": connection_id,
                "headers": json.dumps(headers_sanitized, ensure_ascii=False),
                "id": str(item.id),
            },
        )
    return item, created


@router.post("/banking/{provider}", response_model=dict)
async def banking_provider_webhook(
    provider: str,
    request: Request,
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> dict:
    provider_code = provider.strip().upper()
    manifest = banking_providers.manifest(provider_code)
    if not manifest.supports(BankingCapability.WEBHOOK):
        raise APIError(
            "BANK_CAPABILITY_NOT_SUPPORTED",
            "O provider não anuncia webhook no contrato documental atual.",
            422,
            {"provider": provider_code},
        )
    handler = banking_webhooks.get(provider_code)
    raw = await request.body()
    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError as exc:
        BANK_WEBHOOK_INVALID_TOTAL.labels(provider_code, "UNKNOWN").inc()
        raise APIError("BANK_WEBHOOK_INVALID", "Payload JSON inválido.", 400) from exc
    if not isinstance(payload, dict):
        BANK_WEBHOOK_INVALID_TOTAL.labels(provider_code, "UNKNOWN").inc()
        raise APIError("BANK_WEBHOOK_INVALID", "Payload do webhook precisa ser um objeto JSON.", 400)

    request_contract = BankWebhookRequest(
        raw_body=raw,
        headers={key: value for key, value in request.headers.items()},
        query={key: value for key, value in request.query_params.items()},
    )
    try:
        signature_valid, connection_id = await handler.verify(session, request_contract, payload)
        normalized = await handler.parse(
            request_contract,
            payload,
            signature_valid=signature_valid,
        )
    except APIError:
        BANK_WEBHOOK_INVALID_TOTAL.labels(provider_code, "UNKNOWN").inc()
        raise

    event, created = await _persist(
        session,
        provider=provider_code,
        event_id=normalized.provider_event_id,
        event_type=normalized.event_type,
        payload_hash=normalized.payload_hash,
        payload=normalized.payload,
        signature_valid=normalized.signature_valid,
        connection_id=connection_id,
        headers_sanitized=normalized.headers_sanitized,
    )
    if not created:
        BANK_WEBHOOK_TOTAL.labels(provider_code, "IDEMPOTENT", "UNKNOWN").inc()
        await session.commit()
        return {
            "success": True,
            "idempotent": True,
            "event_id": normalized.provider_event_id,
            "tenant_id": str(context.tenant_id),
        }

    try:
        await handler.process(session, normalized)
        event.status = "PROCESSED"
        event.processed_at = datetime.now(UTC)
        session.add(
            OutboxEvent(
                aggregate_type="WebhookEvent",
                aggregate_id=str(event.id),
                event_type="bank.webhook.processed",
                payload={
                    "provider": provider_code,
                    "provider_event_id": normalized.provider_event_id,
                    "event_type": normalized.event_type,
                    "connection_id": connection_id,
                },
            )
        )
        BANK_WEBHOOK_TOTAL.labels(provider_code, "PROCESSED", "UNKNOWN").inc()
    except Exception as exc:
        event.status = "FAILED"
        event.processed_at = datetime.now(UTC)
        event.last_error = str(exc)[:2000]
        BANK_WEBHOOK_TOTAL.labels(provider_code, "FAILED", "UNKNOWN").inc()
        await session.commit()
        raise
    await session.commit()
    return {
        "success": True,
        "idempotent": False,
        "event_id": normalized.provider_event_id,
        "tenant_id": str(context.tenant_id),
    }
