from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.secrets import secret_cipher
from app.models.tenant import OutboundWebhook, WebhookDelivery


class OutboundWebhookService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def enqueue(self, event_type: str, event_id: str, payload: dict, *, commit: bool = True) -> int:
        webhooks = list((await self.session.scalars(select(OutboundWebhook).where(OutboundWebhook.is_active.is_(True)))).all())
        created = 0
        for webhook in webhooks:
            if event_type not in webhook.events and "*" not in webhook.events:
                continue
            exists = await self.session.scalar(select(WebhookDelivery.id).where(WebhookDelivery.webhook_id == webhook.id, WebhookDelivery.event_id == event_id, WebhookDelivery.event_type == event_type))
            if exists:
                continue
            self.session.add(WebhookDelivery(webhook_id=webhook.id, event_type=event_type, event_id=event_id, payload=payload, status="PENDING", next_attempt_at=datetime.now(UTC)))
            created += 1
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()
        return created

    async def dispatch_pending(self, *, limit: int = 100) -> int:
        now = datetime.now(UTC)
        deliveries = list((await self.session.scalars(select(WebhookDelivery).where(WebhookDelivery.status.in_(["PENDING", "RETRY"]), WebhookDelivery.next_attempt_at <= now).order_by(WebhookDelivery.next_attempt_at).limit(limit).with_for_update(skip_locked=True))).all())
        delivered = 0
        async with httpx.AsyncClient(follow_redirects=False) as client:
            for delivery in deliveries:
                webhook = await self.session.get(OutboundWebhook, delivery.webhook_id)
                if webhook is None or not webhook.is_active:
                    delivery.status = "CANCELLED"
                    continue
                body = json.dumps(delivery.payload, ensure_ascii=False, separators=(",", ":")).encode()
                secret = secret_cipher.decrypt(webhook.encrypted_secret) if webhook.encrypted_secret else ""
                signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest() if secret else ""
                headers = {"Content-Type": "application/json", "User-Agent": "Connect-API-Platform-Webhook/1.0", "X-Connect-API-Event": delivery.event_type, "X-Connect-API-Delivery": str(delivery.id), **(webhook.headers or {})}
                if signature:
                    headers["X-Connect-API-Signature"] = f"sha256={signature}"
                delivery.attempts += 1
                try:
                    response = await client.post(webhook.url, content=body, headers=headers, timeout=webhook.timeout_seconds)
                    delivery.response_status = response.status_code
                    delivery.response_body = response.text[:4000]
                    if 200 <= response.status_code < 300:
                        delivery.status = "DELIVERED"
                        delivery.delivered_at = datetime.now(UTC)
                        delivery.last_error = None
                        delivered += 1
                    else:
                        raise RuntimeError(f"HTTP {response.status_code}")
                except Exception as exc:  # noqa: BLE001
                    delivery.last_error = str(exc)[:4000]
                    if delivery.attempts >= webhook.max_attempts:
                        delivery.status = "FAILED"
                    else:
                        delivery.status = "RETRY"
                        delivery.next_attempt_at = datetime.now(UTC) + timedelta(minutes=min(60, 2 ** delivery.attempts))
            await self.session.commit()
        return delivered
