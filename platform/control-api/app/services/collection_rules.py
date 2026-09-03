from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Iterable
from uuid import UUID

from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.idempotency import compact_idempotency_key
from app.models.tenant import (
    Company,
    Contract,
    Customer,
    CustomerContact,
    Notification,
    NotificationRule,
    NotificationTemplate,
    Receivable,
)

_OPEN_RECEIVABLE_STATUSES = {"OPEN", "REGISTERED", "PARTIALLY_PAID", "OVERDUE"}
_ALLOWED_CHANNELS = {"EMAIL", "WHATSAPP"}
_TEMPLATE_ENV = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False)
_TEMPLATE_ENV.filters.clear()
_TEMPLATE_ENV.filters.update(
    {
        "upper": lambda value: str(value).upper(),
        "lower": lambda value: str(value).lower(),
    }
)


def default_notification_rule_events() -> list[dict[str, Any]]:
    """Eventos iniciais da régua padrão.

    O offset representa ``data_atual - vencimento``. Assim, ``-7`` significa
    sete dias antes do vencimento e ``1`` significa um dia após o vencimento.
    """

    return [
        {"offset_days": -7, "channels": ["EMAIL", "WHATSAPP"], "template": "DUE_SOON"},
        {"offset_days": -1, "channels": ["EMAIL", "WHATSAPP"], "template": "DUE_TOMORROW"},
        {"offset_days": 0, "channels": ["EMAIL", "WHATSAPP"], "template": "DUE_TODAY"},
        {"offset_days": 1, "channels": ["EMAIL", "WHATSAPP"], "template": "OVERDUE"},
        {"offset_days": 5, "channels": ["EMAIL", "WHATSAPP"], "template": "OVERDUE_5_DAYS"},
    ]


def default_notification_templates() -> list[dict[str, Any]]:
    return [
        {
            "code": "DUE_SOON",
            "channel": "EMAIL",
            "subject": "Cobrança com vencimento próximo — {{ empresa.nome }}",
            "body": (
                "Olá {{ cliente.nome }},<br><br>"
                "a cobrança <strong>{{ cobranca.documento }}</strong>, no valor de "
                "<strong>{{ cobranca.valor }}</strong>, vence em "
                "<strong>{{ cobranca.vencimento }}</strong>.<br><br>"
                "{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "DUE_SOON",
            "channel": "WHATSAPP",
            "subject": None,
            "body": (
                "Olá {{ cliente.nome }}. A cobrança {{ cobranca.documento }}, no valor de "
                "{{ cobranca.valor }}, vence em {{ cobranca.vencimento }}. "
                "{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "DUE_TOMORROW",
            "channel": "EMAIL",
            "subject": "Sua cobrança vence amanhã — {{ empresa.nome }}",
            "body": (
                "Olá {{ cliente.nome }},<br><br>"
                "lembramos que a cobrança <strong>{{ cobranca.documento }}</strong>, de "
                "<strong>{{ cobranca.valor }}</strong>, vence amanhã, "
                "{{ cobranca.vencimento }}.<br><br>{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "DUE_TOMORROW",
            "channel": "WHATSAPP",
            "subject": None,
            "body": (
                "Olá {{ cliente.nome }}. Sua cobrança {{ cobranca.documento }}, de "
                "{{ cobranca.valor }}, vence amanhã ({{ cobranca.vencimento }}). "
                "{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "DUE_TODAY",
            "channel": "EMAIL",
            "subject": "Cobrança com vencimento hoje — {{ empresa.nome }}",
            "body": (
                "Olá {{ cliente.nome }},<br><br>"
                "a cobrança <strong>{{ cobranca.documento }}</strong>, no valor de "
                "<strong>{{ cobranca.valor }}</strong>, vence hoje."
                "<br><br>{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "DUE_TODAY",
            "channel": "WHATSAPP",
            "subject": None,
            "body": (
                "Olá {{ cliente.nome }}. A cobrança {{ cobranca.documento }}, no valor de "
                "{{ cobranca.valor }}, vence hoje. {{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "OVERDUE",
            "channel": "EMAIL",
            "subject": "Cobrança vencida — {{ empresa.nome }}",
            "body": (
                "Olá {{ cliente.nome }},<br><br>"
                "não identificamos o pagamento da cobrança "
                "<strong>{{ cobranca.documento }}</strong>, vencida em "
                "<strong>{{ cobranca.vencimento }}</strong>, com saldo de "
                "<strong>{{ cobranca.saldo }}</strong>.<br><br>{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "OVERDUE",
            "channel": "WHATSAPP",
            "subject": None,
            "body": (
                "Olá {{ cliente.nome }}. Não identificamos o pagamento da cobrança "
                "{{ cobranca.documento }}, vencida em {{ cobranca.vencimento }}, com saldo "
                "de {{ cobranca.saldo }}. {{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "OVERDUE_5_DAYS",
            "channel": "EMAIL",
            "subject": "Pendência financeira em aberto — {{ empresa.nome }}",
            "body": (
                "Olá {{ cliente.nome }},<br><br>"
                "a cobrança <strong>{{ cobranca.documento }}</strong> permanece em aberto "
                "há cinco dias. Saldo atual: <strong>{{ cobranca.saldo }}</strong>."
                "<br><br>{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "OVERDUE_5_DAYS",
            "channel": "WHATSAPP",
            "subject": None,
            "body": (
                "Olá {{ cliente.nome }}. A cobrança {{ cobranca.documento }} permanece em "
                "aberto há cinco dias. Saldo: {{ cobranca.saldo }}. "
                "{{ cobranca.instrucoes }}"
            ),
        },
        {
            "code": "PAYMENT_CONFIRMED",
            "channel": "EMAIL",
            "subject": "Pagamento confirmado — {{ empresa.nome }}",
            "body": (
                "Olá {{ cliente.nome }},<br><br>"
                "recebemos o pagamento de <strong>{{ pagamento.valor }}</strong>, referente "
                "à cobrança {{ cobranca.documento }}. Obrigado."
            ),
        },
        {
            "code": "PAYMENT_CONFIRMED",
            "channel": "WHATSAPP",
            "subject": None,
            "body": (
                "Olá {{ cliente.nome }}. O pagamento de {{ pagamento.valor }}, referente à "
                "cobrança {{ cobranca.documento }}, foi confirmado. Obrigado."
            ),
        },
    ]


def normalize_channel(value: str) -> str:
    channel = value.strip().upper()
    if channel not in _ALLOWED_CHANNELS:
        raise ValueError(f"Canal de notificação não suportado: {value}")
    return channel


def normalize_destination(channel: str, value: str | None) -> str | None:
    if not value:
        return None
    channel = normalize_channel(channel)
    raw = value.strip()
    if channel == "EMAIL":
        normalized = raw.lower()
        return normalized if "@" in normalized and "." in normalized.rsplit("@", 1)[-1] else None

    digits = re.sub(r"\D", "", raw)
    if len(digits) in {10, 11}:
        digits = "55" + digits
    return digits if 12 <= len(digits) <= 15 else None


def offset_matches(today: date, due_date: date, offset_days: int) -> bool:
    return (today - due_date).days == offset_days


def format_brl(value: Decimal | int | float | str) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"))
    formatted = f"{amount:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"R$ {formatted}"


def render_notification_template(template: str, context: dict[str, Any]) -> str:
    """Renderiza template configurável em ambiente Jinja restrito."""

    return _TEMPLATE_ENV.from_string(template).render(**context).strip()


def validate_rule_events(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict):
            raise ValueError("Cada evento da régua deve ser um objeto.")
        offset = int(event.get("offset_days", 0))
        if not -365 <= offset <= 365:
            raise ValueError("O offset da régua deve estar entre -365 e 365 dias.")
        template = str(event.get("template") or "").strip().upper()
        if not template or not re.fullmatch(r"[A-Z0-9_\-]{2,80}", template):
            raise ValueError("Código de template inválido na régua.")
        channels = list(dict.fromkeys(normalize_channel(str(item)) for item in event.get("channels", [])))
        if not channels:
            raise ValueError("Cada evento da régua precisa de ao menos um canal.")
        normalized.append({"offset_days": offset, "channels": channels, "template": template})
    if not normalized:
        raise ValueError("A régua precisa possuir ao menos um evento.")
    return normalized


class CollectionRuleService:
    def __init__(self, session: AsyncSession) -> None:
        from app.services.notifications import NotificationService

        self.session = session
        self.notifications = NotificationService(session)

    @staticmethod
    def _context(
        *,
        company: Company,
        customer: Customer,
        receivable: Receivable,
        public_base_url: str | None,
    ) -> dict[str, Any]:
        instructions = "Consulte a cobrança no portal financeiro."
        if public_base_url:
            instructions = f"Acesse {public_base_url.rstrip('/')}/receivables para consultar ou emitir a segunda via."
        return {
            "empresa": {
                "nome": company.trade_name or company.legal_name,
                "razao_social": company.legal_name,
                "cnpj": company.tax_id,
                "email": company.email or "",
                "telefone": company.phone or "",
            },
            "cliente": {
                "nome": customer.trade_name or customer.name,
                "razao_social": customer.name,
                "documento": customer.tax_id or "",
                "email": customer.email or "",
                "whatsapp": customer.whatsapp or "",
            },
            "cobranca": {
                "id": str(receivable.id),
                "documento": receivable.document_number,
                "descricao": receivable.description,
                "competencia": receivable.competence,
                "valor": format_brl(receivable.original_amount),
                "saldo": format_brl(receivable.balance),
                "vencimento": receivable.due_date.strftime("%d/%m/%Y"),
                "instrucoes": instructions,
            },
        }

    @staticmethod
    def _destinations(
        customer: Customer,
        contacts: Iterable[CustomerContact],
        channel: str,
    ) -> list[str]:
        values: list[str | None]
        if channel == "EMAIL":
            values = [customer.email, *[item.email for item in contacts if item.receive_billing]]
        else:
            values = [
                customer.whatsapp or customer.phone,
                *[(item.whatsapp or item.phone) for item in contacts if item.receive_billing],
            ]
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            destination = normalize_destination(channel, value)
            if destination and destination not in seen:
                seen.add(destination)
                normalized.append(destination)
        return normalized

    async def mark_overdue(self, today: date, company_ids: set[UUID] | None = None) -> int:
        stmt = (
            update(Receivable)
            .where(
                Receivable.status.in_(["OPEN", "REGISTERED", "PARTIALLY_PAID"]),
                Receivable.due_date < today,
                Receivable.balance > 0,
            )
            .values(status="OVERDUE", updated_at=datetime.now(UTC))
        )
        if company_ids is not None:
            if not company_ids:
                return 0
            stmt = stmt.where(Receivable.company_id.in_(company_ids))
        result = await self.session.execute(stmt)
        return int(result.rowcount or 0)

    async def schedule_due(
        self,
        *,
        today: date,
        public_base_url: str | None = None,
        company_ids: set[UUID] | None = None,
        limit: int = 5000,
    ) -> int:
        rules = list((await self.session.scalars(
            select(NotificationRule).where(NotificationRule.is_active.is_(True))
        )).all())
        if not rules:
            return 0
        rule_by_id = {item.id: item for item in rules}
        default_rule = next((item for item in rules if item.is_default), rules[0])

        all_events: list[dict[str, Any]] = []
        for rule in rules:
            try:
                all_events.extend(validate_rule_events(rule.events))
            except ValueError:
                continue
        if not all_events:
            return 0
        offsets = [int(item["offset_days"]) for item in all_events]
        due_start = today - max(offsets) * date.resolution
        due_end = today - min(offsets) * date.resolution

        stmt = (
            select(Receivable, Customer, Company, Contract)
            .join(Customer, Customer.id == Receivable.customer_id)
            .join(Company, Company.id == Receivable.company_id)
            .outerjoin(Contract, Contract.id == Receivable.contract_id)
            .where(
                Receivable.status.in_(sorted(_OPEN_RECEIVABLE_STATUSES)),
                Receivable.balance > 0,
                Receivable.due_date.between(due_start, due_end),
                Customer.is_active.is_(True),
                Company.is_active.is_(True),
            )
            .order_by(Receivable.due_date, Receivable.id)
            .limit(limit)
        )
        if company_ids is not None:
            if not company_ids:
                return 0
            stmt = stmt.where(Receivable.company_id.in_(company_ids))
        rows = list((await self.session.execute(stmt)).all())
        if not rows:
            await self.mark_overdue(today, company_ids)
            await self.session.commit()
            return 0

        customer_ids = {receivable.customer_id for receivable, _, _, _ in rows}
        contacts_by_customer: dict[UUID, list[CustomerContact]] = defaultdict(list)
        if customer_ids:
            contacts = list((await self.session.scalars(
                select(CustomerContact).where(
                    CustomerContact.customer_id.in_(customer_ids),
                    CustomerContact.receive_billing.is_(True),
                )
            )).all())
            for contact in contacts:
                contacts_by_customer[contact.customer_id].append(contact)

        template_rows = list((await self.session.scalars(
            select(NotificationTemplate).where(NotificationTemplate.is_active.is_(True))
        )).all())
        templates = {(item.code.upper(), item.channel.upper()): item for item in template_rows}

        queued = 0
        for receivable, customer, company, contract in rows:
            rule = rule_by_id.get(contract.notification_rule_id) if contract and contract.notification_rule_id else default_rule
            if rule is None or not rule.is_active:
                rule = default_rule
            try:
                events = validate_rule_events(rule.events)
            except ValueError:
                continue
            context = self._context(
                company=company,
                customer=customer,
                receivable=receivable,
                public_base_url=public_base_url,
            )
            for event in events:
                offset = int(event["offset_days"])
                if not offset_matches(today, receivable.due_date, offset):
                    continue
                for channel in event["channels"]:
                    template = templates.get((str(event["template"]).upper(), channel))
                    if template is None:
                        continue
                    subject = render_notification_template(template.subject, context) if template.subject else None
                    body = render_notification_template(template.body, context)
                    for destination in self._destinations(
                        customer,
                        contacts_by_customer.get(customer.id, []),
                        channel,
                    ):
                        key = compact_idempotency_key(
                            f"collection:{rule.id}:{receivable.id}:{offset}:"
                            f"{channel}:{destination}"
                        )
                        before = await self.session.scalar(
                            select(Notification.id).where(Notification.idempotency_key == key)
                        )
                        if before is not None:
                            continue
                        await self.notifications.queue(
                            channel=channel,
                            destination=destination,
                            subject=subject,
                            body=body,
                            company_id=str(receivable.company_id),
                            customer_id=str(receivable.customer_id),
                            receivable_id=str(receivable.id),
                            idempotency_key=key,
                            commit=False,
                        )
                        queued += 1

        await self.mark_overdue(today, company_ids)
        await self.session.commit()
        return queued
