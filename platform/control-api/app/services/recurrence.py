from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Contract, OutboxEvent, Receivable


FREQUENCY_DELTAS: dict[str, relativedelta] = {
    "WEEKLY": relativedelta(weeks=1),
    "BIWEEKLY": relativedelta(weeks=2),
    "MONTHLY": relativedelta(months=1),
    "BIMONTHLY": relativedelta(months=2),
    "QUARTERLY": relativedelta(months=3),
    "SEMIANNUAL": relativedelta(months=6),
    "ANNUAL": relativedelta(years=1),
}


def safe_day(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_generation(current: date, frequency: str, interval_count: int = 1) -> date:
    base = FREQUENCY_DELTAS.get(frequency.upper(), relativedelta(months=1))
    result = current
    for _ in range(max(interval_count, 1)):
        result = result + base
    return result


def due_date_from_generation(contract: Contract, generation_date: date) -> date:
    target = generation_date + timedelta(days=contract.issue_days_before_due)
    return safe_day(target.year, target.month, contract.due_day)


class RecurrenceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def generate_due(
        self,
        today: date | None = None,
        limit: int = 1000,
        company_ids: list[UUID] | None = None,
    ) -> list[Receivable]:
        today = today or datetime.now(UTC).date()
        filters = [Contract.status == "ACTIVE", Contract.next_generation_date <= today]
        if company_ids is not None:
            if not company_ids:
                return []
            filters.append(Contract.company_id.in_(company_ids))
        stmt = (
            select(Contract)
            .where(*filters)
            .order_by(Contract.next_generation_date)
            .with_for_update(skip_locked=True)
            .limit(limit)
        )
        contracts = list((await self.session.execute(stmt)).scalars())
        generated: list[Receivable] = []
        for contract in contracts:
            if contract.end_date and contract.next_generation_date > contract.end_date:
                contract.status = "COMPLETED"
                continue
            due_date = due_date_from_generation(contract, contract.next_generation_date)
            competence = due_date.strftime("%Y-%m")
            exists = await self.session.scalar(
                select(Receivable.id).where(
                    Receivable.contract_id == contract.id,
                    Receivable.competence == competence,
                )
            )
            if exists is None:
                amount = Decimal(contract.amount)
                discount = Decimal(contract.discount_amount)
                balance = max(amount - discount, Decimal("0"))
                receivable = Receivable(
                    company_id=contract.company_id,
                    customer_id=contract.customer_id,
                    contract_id=contract.id,
                    document_number=f"REC-{competence.replace('-', '')}-{uuid4().hex[:10].upper()}",
                    competence=competence,
                    description=contract.description or f"Contrato {contract.code}",
                    issue_date=today,
                    due_date=due_date,
                    original_amount=amount,
                    discount_amount=discount,
                    interest_amount=Decimal("0"),
                    fine_amount=Decimal("0"),
                    abatement_amount=Decimal("0"),
                    paid_amount=Decimal("0"),
                    balance=balance,
                    status="OPEN",
                    source="RECURRENCE",
                    metadata_json={"contract_code": contract.code, "billing_method": contract.billing_method},
                )
                self.session.add(receivable)
                await self.session.flush()
                self.session.add(
                    OutboxEvent(
                        aggregate_type="Receivable",
                        aggregate_id=str(receivable.id),
                        event_type="financial.receivable.created",
                        payload={
                            "receivable_id": str(receivable.id),
                            "contract_id": str(contract.id),
                            "company_id": str(contract.company_id),
                            "billing_method": contract.billing_method,
                        },
                    )
                )
                generated.append(receivable)
            contract.next_generation_date = next_generation(
                contract.next_generation_date, contract.frequency, contract.interval_count
            )
        await self.session.commit()
        return generated
