from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.providers.banking.core.capabilities import (
    BankingCapability,
    BankingIntegrationMode,
    ProviderStatus,
)
from app.providers.banking.registry import banking_providers
from app.providers.cnab.c6_400 import (
    C6CNAB400Generator,
    C6CNAB400ReturnParser,
    C6CNAB400Settings,
)
from app.providers.cnab.cnab240 import CNABCompany, CNABTitle


def _company() -> CNABCompany:
    return CNABCompany(
        bank_code="336",
        tax_id="12345678000199",
        name="EMPRESA TESTE LTDA",
        agreement="",
        branch="1",
        branch_digit="",
        account="123456",
        account_digit="0",
    )


def _title() -> CNABTitle:
    return CNABTitle(
        document_number="REC-202608-ABC1234567",
        our_number="",
        due_date=date(2026, 9, 10),
        amount=Decimal("123.45"),
        payer_name="CLIENTE TESTE",
        payer_tax_id="12345678901",
        payer_address="RUA TESTE 100",
        payer_zip_code="44570000",
        payer_city="SANTO ANTONIO DE JESUS",
        payer_state="BA",
        issue_date=date(2026, 8, 24),
    )


@pytest.mark.bank_contract
def test_c6_is_real_cnab_only_provider() -> None:
    manifest = banking_providers.manifest("C6")
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert manifest.implementation_available is True
    assert manifest.capabilities == frozenset({BankingCapability.CNAB_400})
    assert manifest.effective_implemented_modes() == frozenset({BankingIntegrationMode.CNAB})
    assert banking_providers.mode_available("C6", BankingIntegrationMode.CNAB) is True
    assert banking_providers.mode_available("C6", BankingIntegrationMode.DIRECT_API) is False
    assert "C6" not in {item.code for item in banking_providers.connectable_manifests()}


@pytest.mark.bank_contract
def test_c6_cnab400_remittance_matches_official_positions() -> None:
    settings = C6CNAB400Settings.from_agreement(
        "10",
        {
            "beneficiary_code": "123456",
            "collection_account": "987654",
            "species_code": "02",
            "acceptance": "N",
        },
    )
    generator = C6CNAB400Generator(
        _company(),
        sequence=27,
        generation_date=date(2026, 8, 24),
        settings=settings,
    )
    content = generator.generate([_title()])
    lines = content.decode("ascii").splitlines()

    assert len(lines) == 3
    assert all(len(line) == 400 for line in lines)

    header, detail, trailer = lines
    assert header[0:1] == "0"
    assert header[1:2] == "1"
    assert header[2:9] == "REMESSA"
    assert header[9:11] == "01"
    assert header[11:19] == "COBRANCA"
    assert header[26:38] == "000000123456"
    assert header[76:79] == "336"
    assert header[94:100] == "240826"
    assert header[108:120] == "000000987654"
    assert header[386:394] == "00000027"
    assert header[394:400] == "000001"

    assert detail[0:1] == "1"
    assert detail[1:3] == "02"
    assert detail[3:17] == "12345678000199"
    assert detail[17:29] == "000000123456"
    assert detail[37:62].strip() == "REC-202608-ABC1234567"
    assert detail[62:73] == " " * 11
    assert detail[82:85] == "336"
    assert detail[106:108] == "10"
    assert detail[108:110] == "01"
    assert detail[110:120].strip() == "ABC1234567"
    assert detail[120:126] == "100926"
    assert detail[126:139] == "0000000012345"
    assert detail[147:149] == "02"
    assert detail[149:150] == "N"
    assert detail[150:156] == "240826"
    assert detail[218:220] == "01"
    assert detail[220:234] == "00012345678901"
    assert detail[326:334] == "44570000"
    assert detail[349:351] == "BA"
    assert detail[394:400] == "000002"

    assert trailer[0:1] == "9"
    assert trailer[394:400] == "000003"


@pytest.mark.bank_contract
def test_c6_cnab400_rejects_wallet_20_until_our_number_dv_is_implemented() -> None:
    with pytest.raises(ValueError, match="Carteira 10"):
        C6CNAB400Settings.from_agreement(
            "20",
            {
                "beneficiary_code": "123456",
                "collection_account": "987654",
                "species_code": "02",
                "acceptance": "N",
            },
        )


@pytest.mark.bank_contract
def test_c6_return_parser_uses_beneficiary_control_and_c6_bank_code() -> None:
    parser = C6CNAB400ReturnParser()
    header = list(" " * 400)
    header[0] = "0"
    header[76:79] = list("336")
    detail = list(" " * 400)
    detail[0] = "1"
    detail[37:62] = list("REC-202608-ABC1234567".ljust(25))
    detail[62:73] = list("00012345678")
    detail[108:110] = list("06")
    detail[110:116] = list("250826")
    detail[146:152] = list("100926")
    detail[152:165] = list("0000000012345")
    detail[253:266] = list("0000000012345")
    detail[295:301] = list("260826")
    detail[394:400] = list("000002")
    trailer = list(" " * 400)
    trailer[0] = "9"
    trailer[394:400] = list("000003")

    content = ("\r\n".join(("".join(header), "".join(detail), "".join(trailer))) + "\r\n").encode("ascii")
    events = parser.parse(content)

    assert len(events) == 1
    event = events[0]
    assert event["provider"] == "C6"
    assert event["bank_code"] == "336"
    assert event["document_number"] == "REC-202608-ABC1234567"
    assert event["occurrence_code"] == "06"
    assert event["amount"] == Decimal("123.45")
    assert event["credit_date"] == date(2026, 8, 26)
