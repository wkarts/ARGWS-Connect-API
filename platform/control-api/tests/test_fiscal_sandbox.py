from __future__ import annotations

from decimal import Decimal

import pytest

from app.providers.fiscal.base import FiscalCustomer, FiscalIssueRequest, FiscalIssuer
from app.providers.fiscal.sandbox import SandboxNFSeProvider


@pytest.mark.asyncio
async def test_sandbox_nfse_generates_xml_and_pdf() -> None:
    request = FiscalIssueRequest(
        internal_id="receivable-1",
        competence="2026-08",
        amount=Decimal("1621.00"),
        service_description="Honorários contábeis",
        service_code="17.19",
        issuer=FiscalIssuer(legal_name="CONNECT API LTDA", tax_id="12345678000190", municipal_registration="123", municipality_code="2928701", address={}),
        customer=FiscalCustomer(name="Cliente Teste", tax_id="98765432000110", email="fiscal@example.com", address={}),
        environment="SANDBOX",
        settings={},
        credentials={},
    )
    result = await SandboxNFSeProvider().issue(request)
    assert result.status == "ISSUED"
    assert result.external_id.startswith("NFSE-SBX-")
    assert result.xml.startswith(b"<?xml")
    assert b"SANDBOX" in result.xml
    assert result.pdf.startswith(b"%PDF")
    assert result.number and result.verification_code
