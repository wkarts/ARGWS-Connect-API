from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.providers.banking.core.capabilities import BankingCapability, BankingIntegrationMode, ProviderStatus
from app.providers.banking.providers.banco_do_brasil.provider import BancoDoBrasilCBR641ProviderGenerator
from app.providers.banking.registry import banking_providers
from app.providers.cnab.banco_do_brasil_400 import (
    BancoDoBrasilCBR641Settings,
    BancoDoBrasilCBR643ReturnParser,
)
from app.providers.cnab.cnab240 import CNABCompany, CNABTitle


BB_IDENTIFICATION = "001BANCO DO BRASIL"


def _company() -> CNABCompany:
    return CNABCompany(
        bank_code="001",
        tax_id="12345678000199",
        name="EMPRESA TESTE LTDA",
        agreement="1234567",
        branch="1234",
        branch_digit="5",
        account="12345678",
        account_digit="9",
    )


def _settings() -> BancoDoBrasilCBR641Settings:
    return BancoDoBrasilCBR641Settings.from_agreement(
        "1234567",
        "17",
        {
            "leader_agreement": "1234567",
            "wallet_variation": "019",
            "species_code": "01",
            "acceptance": "N",
        },
    )


def _title() -> CNABTitle:
    return CNABTitle(
        document_number="REC-202608-BB1234567",
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
def test_banco_do_brasil_keeps_cnab400_alongside_direct_api_executor() -> None:
    manifest = banking_providers.manifest("BANCO_DO_BRASIL")
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert BankingCapability.CNAB_400 in manifest.capabilities
    assert BankingCapability.BOLETO_CREATE in manifest.capabilities
    assert BankingCapability.BOLETO_GET in manifest.capabilities
    assert BankingCapability.BOLETO_UPDATE in manifest.capabilities
    assert BankingCapability.BOLETO_CANCEL in manifest.capabilities
    assert BankingCapability.BOLETO_HYBRID in manifest.capabilities
    assert manifest.effective_implemented_modes() == frozenset(
        {BankingIntegrationMode.DIRECT_API, BankingIntegrationMode.CNAB}
    )
    assert banking_providers.mode_available("BANCO_DO_BRASIL", BankingIntegrationMode.CNAB)
    assert banking_providers.mode_available("BANCO_DO_BRASIL", BankingIntegrationMode.DIRECT_API)
    assert "BANCO_DO_BRASIL" in {item.code for item in banking_providers.connectable_manifests()}


@pytest.mark.bank_contract
def test_bb_cbr641_exact_official_positions() -> None:
    generator = BancoDoBrasilCBR641ProviderGenerator(
        _company(),
        sequence=27,
        generation_date=date(2026, 8, 24),
        settings=_settings(),
    )
    header, detail, trailer = generator.generate([_title()]).decode("ascii").splitlines()

    assert all(len(line) == 400 for line in (header, detail, trailer))
    assert header[0] == "0"
    assert header[1] == "1"
    assert header[2:9] == "REMESSA"
    assert header[9:11] == "01"
    assert header[11:19] == "COBRANCA"
    assert header[26:30] == "1234"
    assert header[30] == "5"
    assert header[31:39] == "12345678"
    assert header[39] == "9"
    assert header[76:94] == BB_IDENTIFICATION
    assert header[94:100] == "240826"
    assert header[100:107] == "0000027"
    assert header[129:136] == "1234567"
    assert header[394:400] == "000001"

    assert detail[0] == "7"
    assert detail[1:3] == "02"
    assert detail[3:17] == "12345678000199"
    assert detail[17:21] == "1234"
    assert detail[21] == "5"
    assert detail[22:30] == "12345678"
    assert detail[30] == "9"
    assert detail[31:38] == "1234567"
    assert detail[38:63].strip() == "REC-202608-BB1234567"
    assert detail[63:80] == "0" * 17
    assert detail[91:94] == "019"
    assert detail[101:106] == " " * 5
    assert detail[106:108] == "17"
    assert detail[108:110] == "01"
    assert detail[110:120].strip() == "BB1234567"
    assert detail[120:126] == "100926"
    assert detail[126:139] == "0000000012345"
    assert detail[139:142] == "001"
    assert detail[147:149] == "01"
    assert detail[149] == "N"
    assert detail[150:156] == "240826"
    assert detail[156:160] == "0000"
    assert detail[218:220] == "01"
    assert detail[220:234] == "00012345678901"
    assert detail[326:334] == "44570000"
    assert detail[349:351] == "BA"
    assert detail[393] == " "
    assert detail[394:400] == "000002"
    assert trailer[0] == "9"
    assert trailer[394:400] == "000003"


@pytest.mark.bank_contract
def test_bb_cbr643_return_preserves_company_control_and_paid_amount() -> None:
    header = list(" " * 400)
    header[0] = "0"
    header[76:94] = list(BB_IDENTIFICATION)
    detail = list(" " * 400)
    detail[0] = "7"
    detail[31:38] = list("1234567")
    detail[38:63] = list("REC-202608-BB1234567".ljust(25))
    detail[63:80] = list("00000000000012345")
    detail[91:94] = list("019")
    detail[106:108] = list("17")
    detail[108:110] = list("06")
    detail[110:116] = list("250826")
    detail[116:126] = list("BB1234567".ljust(10))
    detail[146:152] = list("100926")
    detail[152:165] = list("0000000012345")
    detail[165:168] = list("001")
    detail[168:172] = list("1234")
    detail[175:181] = list("260826")
    detail[253:266] = list("0000000012345")
    detail[392:394] = list("61")
    detail[394:400] = list("000002")
    trailer = list(" " * 400)
    trailer[0] = "9"
    trailer[394:400] = list("000003")

    content = ("\r\n".join(("".join(header), "".join(detail), "".join(trailer))) + "\r\n").encode("ascii")
    events = BancoDoBrasilCBR643ReturnParser().parse(content)

    assert len(events) == 1
    event = events[0]
    assert event["provider"] == "BANCO_DO_BRASIL"
    assert event["bank_code"] == "001"
    assert event["document_number"] == "REC-202608-BB1234567"
    assert event["occurrence_code"] == "06"
    assert event["amount"] == Decimal("123.45")
    assert event["credit_date"] == date(2026, 8, 26)
    assert event["channel"] == "61"


@pytest.mark.bank_contract
def test_bb_requires_bank_supplied_wallet_variation() -> None:
    with pytest.raises(ValueError, match="wallet_variation"):
        BancoDoBrasilCBR641Settings.from_agreement(
            "1234567",
            "17",
            {"leader_agreement": "1234567", "species_code": "01", "acceptance": "N"},
        )
