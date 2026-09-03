from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from starlette.requests import Request

from app.api.routes.tenant_contract_actions import _date_score, _document_match
from app.core.rate_limit import RateLimit, consume_rate_limit, request_scope
from app.models.tenant import BankTransaction, Receivable
from app.services.exports import ExportService


def _request(path: str, method: str = "GET") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [(b"host", b"demo.connect-api.example.com")],
            "client": ("127.0.0.1", 12345),
            "server": ("demo.connect-api.example.com", 443),
        }
    )


def test_rate_limit_only_classifies_sensitive_surfaces() -> None:
    assert request_scope(_request("/api/v1/receivables")) == "interactive"
    assert request_scope(_request("/api/v1/reports")) == "interactive"
    assert request_scope(_request("/api/v1/auth/login", "POST")) == "auth-login"
    assert request_scope(_request("/api/v1/webhooks/asaas", "POST")) == "webhook"


@pytest.mark.asyncio
async def test_interactive_navigation_does_not_consume_global_counter() -> None:
    class RedisMustNotBeTouched:
        async def incr(self, _: str) -> int:  # pragma: no cover - falha se chamado
            raise AssertionError("Navegação interativa não deve consumir o contador global")

    allowed, remaining, retry_after = await consume_rate_limit(
        RedisMustNotBeTouched(),  # type: ignore[arg-type]
        key="rate-limit:interactive:demo:127.0.0.1:1",
        rule=RateLimit(limit=120, window_seconds=60),
    )
    assert allowed is True
    assert remaining == 120
    assert retry_after == 0


def test_report_export_serializes_uuid_decimal_and_structured_values() -> None:
    identifier = uuid4()
    assert ExportService._value(identifier) == str(identifier)
    assert ExportService._value(Decimal("123.45")) == 123.45
    assert ExportService._value({"ok": True}) == '{"ok": true}'
    assert ExportService._display("status", "PARTIALLY_PAID") == "Pago parcialmente"
    assert ExportService._display("amount", Decimal("1234.56")) == "R$ 1.234,56"


def test_reconciliation_document_and_date_scoring() -> None:
    transaction = BankTransaction(
        bank_account_id=uuid4(),
        external_id="extrato-1",
        transaction_date=__import__("datetime").date(2026, 8, 23),
        amount=Decimal("700.00"),
        transaction_type="CREDIT",
        description="Recebimento DOC-00042 cliente",
        document_number="DOC-00042",
        reconciliation_status="UNMATCHED",
    )
    receivable = Receivable(
        company_id=uuid4(),
        customer_id=uuid4(),
        document_number="DOC-00042",
        competence="2026-08",
        description="Parcela negociada",
        issue_date=__import__("datetime").date(2026, 8, 1),
        due_date=__import__("datetime").date(2026, 8, 25),
        original_amount=Decimal("700.00"),
        paid_amount=Decimal("0"),
        balance=Decimal("700.00"),
        status="OPEN",
        source="MANUAL",
    )
    assert _document_match(transaction, receivable) is True
    assert _date_score(transaction, receivable) == 5


def test_public_landing_contains_no_administrative_or_provider_disclosure() -> None:
    root = Path(__file__).resolve().parents[2]
    landing = (root / "infrastructure" / "docker" / "gateway" / "landing" / "index.html").read_text(encoding="utf-8")
    lowered = landing.casefold()
    forbidden = [
        "control.connect-api.example.com",
        "demo.connect-api.example.com",
        "evolution api",
        "rabbitmq",
        "postgresql",
        "minio",
        "celery",
        "github.com/wkarts",
    ]
    for value in forbidden:
        assert value not in lowered
    assert "/api/public/platform/landing" in landing
