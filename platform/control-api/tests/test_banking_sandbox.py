from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.sandbox import SandboxBankingProvider


@pytest.mark.asyncio
async def test_sandbox_charge_is_deterministic_and_complete() -> None:
    request = BankChargeRequest(
        internal_id="11111111-1111-1111-1111-111111111111",
        document_number="REC-202608-0001",
        amount=Decimal("2500.00"),
        due_date=date(2026, 8, 25),
        description="Honorários contábeis",
        customer=BankCustomer(
            name="Cliente Teste",
            tax_id="12345678000190",
            email="financeiro@example.com",
            phone="5575999999999",
        ),
        charge_type="BOLETO_PIX",
    )
    provider = SandboxBankingProvider()
    first = await provider.create_charge(request)
    second = await provider.create_charge(request)
    assert first.external_id == second.external_id
    assert first.status == "REGISTERED"
    assert first.digitable_line
    assert first.barcode and len(first.barcode) == 44
    assert first.pix_copy_paste and first.pix_copy_paste.startswith("000201")
    assert first.document_url and first.external_id in first.document_url
