from __future__ import annotations

from datetime import date

from app.models.tenant import Contract
from app.services.recurrence import due_date_from_generation, next_generation, safe_day


def test_safe_day_handles_end_of_month() -> None:
    assert safe_day(2026, 2, 31) == date(2026, 2, 28)
    assert safe_day(2028, 2, 31) == date(2028, 2, 29)


def test_next_generation_frequency() -> None:
    assert next_generation(date(2026, 1, 31), "MONTHLY") == date(2026, 2, 28)
    assert next_generation(date(2026, 1, 15), "QUARTERLY") == date(2026, 4, 15)
    assert next_generation(date(2026, 1, 15), "ANNUAL") == date(2027, 1, 15)


def test_due_date_from_generation_uses_safe_due_day() -> None:
    contract = Contract(due_day=31, issue_days_before_due=10)
    assert due_date_from_generation(contract, date(2026, 2, 18)) == date(2026, 2, 28)
