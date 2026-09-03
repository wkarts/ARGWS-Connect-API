from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Charge, Customer, OutboxEvent, Payment, Receivable
from app.services.notifications import NotificationService
from app.services.outbound_webhooks import OutboundWebhookService


def money_br(value: Decimal) -> str:
    text = f"{value:,.2f}"
    return "R$ " + text.replace(",", "X").replace(".", ",").replace("X", ".")


class OutboxService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.notifications = NotificationService(session)
        self.outbound_webhooks = OutboundWebhookService(session)

    async def _handle_charge_registered(self, event: OutboxEvent) -> None:
        charge = await self.session.get(Charge, event.payload["charge_id"])
        if charge is None:
            return
        receivable = await self.session.get(Receivable, charge.receivable_id)
        if receivable is None:
            return
        customer = await self.session.get(Customer, receivable.customer_id)
        if customer is None:
            return
        body = (
            f"Olá {customer.name}. Sua cobrança de {money_br(Decimal(receivable.balance))} "
            f"vence em {receivable.due_date.strftime('%d/%m/%Y')}."
        )
        if charge.digitable_line:
            body += f"\nLinha digitável: {charge.digitable_line}"
        if charge.pix_copy_paste:
            body += f"\nPIX Copia e Cola: {charge.pix_copy_paste}"
        if customer.email:
            await self.notifications.queue(
                channel="EMAIL",
                destination=customer.email,
                subject=f"Cobrança {receivable.document_number}",
                body=f"<p>{body.replace(chr(10), '<br>')}</p>",
                company_id=str(receivable.company_id),
                customer_id=str(customer.id),
                receivable_id=str(receivable.id),
                idempotency_key=f"charge:{charge.id}:email:{customer.email}",
                commit=False,
            )
        destination = customer.whatsapp or customer.phone
        if destination:
            await self.notifications.queue(
                channel="WHATSAPP",
                destination=destination,
                body=body,
                company_id=str(receivable.company_id),
                customer_id=str(customer.id),
                receivable_id=str(receivable.id),
                idempotency_key=f"charge:{charge.id}:whatsapp:{destination}",
                commit=False,
            )

    async def _handle_payment_confirmed(self, event: OutboxEvent) -> None:
        payment = await self.session.get(Payment, event.payload["payment_id"])
        if payment is None:
            return
        receivable = await self.session.get(Receivable, payment.receivable_id)
        if receivable is None:
            return
        customer = await self.session.get(Customer, receivable.customer_id)
        if customer is None:
            return
        body = f"Olá {customer.name}. Confirmamos o pagamento de {money_br(Decimal(payment.amount))}. Obrigado."
        if customer.email:
            await self.notifications.queue(
                channel="EMAIL",
                destination=customer.email,
                subject="Pagamento confirmado",
                body=f"<p>{body}</p>",
                company_id=str(receivable.company_id),
                customer_id=str(customer.id),
                receivable_id=str(receivable.id),
                idempotency_key=f"payment:{payment.id}:email:{customer.email}",
                commit=False,
            )
        destination = customer.whatsapp or customer.phone
        if destination:
            await self.notifications.queue(
                channel="WHATSAPP",
                destination=destination,
                body=body,
                company_id=str(receivable.company_id),
                customer_id=str(customer.id),
                receivable_id=str(receivable.id),
                idempotency_key=f"payment:{payment.id}:whatsapp:{destination}",
                commit=False,
            )

    async def process_pending(self, limit: int = 100) -> int:
        processed = 0
        for _ in range(limit):
            stmt = (
                select(OutboxEvent)
                .where(
                    OutboxEvent.status.in_(["PENDING", "RETRY"]),
                    OutboxEvent.available_at <= datetime.now(UTC),
                )
                .order_by(OutboxEvent.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            event = (await self.session.execute(stmt)).scalar_one_or_none()
            if event is None:
                await self.session.rollback()
                break
            event.attempts += 1
            try:
                if event.event_type == "financial.charge.registered":
                    await self._handle_charge_registered(event)
                elif event.event_type == "financial.payment.confirmed":
                    await self._handle_payment_confirmed(event)
                await self.outbound_webhooks.enqueue(
                    event.event_type, str(event.id), event.payload, commit=False
                )
                event.status = "PROCESSED"
                event.processed_at = datetime.now(UTC)
                event.last_error = None
            except Exception as exc:  # noqa: BLE001
                event.status = "FAILED" if event.attempts >= 8 else "RETRY"
                event.last_error = str(exc)[:2000]
                if event.status == "RETRY":
                    event.available_at = datetime.now(UTC) + timedelta(
                        minutes=min(2 ** event.attempts, 120)
                    )
            await self.session.commit()
            processed += 1
        return processed
