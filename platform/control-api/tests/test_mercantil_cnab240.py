from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.providers.banking.core.capabilities import BankingCapability, BankingIntegrationMode, ProviderStatus
from app.providers.banking.registry import banking_providers
from app.providers.cnab.cnab240 import CNABCompany, CNABTitle
from app.providers.cnab.mercantil240 import (
    MercantilCNAB240Generator,
    MercantilCNAB240ReturnParser,
    MercantilCNAB240Settings,
)


def _company() -> CNABCompany:
    return CNABCompany(
        bank_code="389",
        tax_id="12345678000199",
        name="EMPRESA TESTE LTDA",
        agreement="123456789",
        branch="1234",
        branch_digit="",
        account="123456789",
        account_digit="7",
    )


def _title() -> CNABTitle:
    return CNABTitle(
        document_number="REC-202608-MB12345678",
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


def _generator() -> MercantilCNAB240Generator:
    return MercantilCNAB240Generator(
        _company(),
        sequence=27,
        generation_date=date(2026, 8, 25),
        generation_time="123456",
        settings=MercantilCNAB240Settings.from_agreement(
            "123456789",
            "1",
            {"species_code": "01", "acceptance": "N"},
        ),
    )


@pytest.mark.bank_contract
def test_mercantil_is_cnab_only_executor() -> None:
    manifest = banking_providers.manifest("MERCANTIL")
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert manifest.capabilities == frozenset({BankingCapability.CNAB_240})
    assert manifest.effective_implemented_modes() == frozenset({BankingIntegrationMode.CNAB})
    assert banking_providers.mode_available("MERCANTIL", BankingIntegrationMode.CNAB)
    assert not banking_providers.mode_available("MERCANTIL", BankingIntegrationMode.DIRECT_API)
    assert "MERCANTIL" not in {item.code for item in banking_providers.connectable_manifests()}


@pytest.mark.bank_contract
def test_mercantil_cnab240_exact_core_positions() -> None:
    header, lot, segment_p, segment_q, lot_trailer, file_trailer = (
        _generator().generate([_title()]).decode("ascii").splitlines()
    )
    assert all(len(line) == 240 for line in (header, lot, segment_p, segment_q, lot_trailer, file_trailer))

    assert header[0:3] == "389"
    assert header[3:7] == "0000"
    assert header[7] == "0"
    assert header[17] == "2"
    assert header[32:36] == "1234"
    assert header[36:45] == "123456789"
    assert header[52:57] == "01234"
    assert header[58:70] == "000123456789"
    assert header[70] == "7"
    assert header[102:132].strip() == "MERCANTIL DO BRASIL"
    assert header[142] == "1"
    assert header[143:151] == "25082026"
    assert header[151:157] == "123456"
    assert header[157:163] == "000027"
    assert header[163:166] == "040"
    assert header[166:171] == "01600"

    assert lot[0:3] == "389"
    assert lot[3:7] == "0001"
    assert lot[7] == "1"
    assert lot[8] == "R"
    assert lot[9:11] == "01"
    assert lot[13:16] == "040"
    assert lot[37:46] == "123456789"

    assert segment_p[0:3] == "389"
    assert segment_p[13] == "P"
    assert segment_p[15:17] == "01"
    assert segment_p[37:47] == "0000000000"
    assert segment_p[47] == "0"
    assert segment_p[57] == "1"
    assert segment_p[62:72] == "MB12345678"
    assert segment_p[77:85] == "10092026"
    assert segment_p[85:100] == "000000000012345"
    assert segment_p[106:108] == "01"
    assert segment_p[108] == "N"
    assert segment_p[109:117] == "24082026"
    assert segment_p[195:220].strip() == "REC-202608-MB12345678"

    assert segment_q[13] == "Q"
    assert segment_q[15:17] == "01"
    assert segment_q[17] == "1"
    assert segment_q[18:33] == "000012345678901"
    assert segment_q[128:133] == "44570"
    assert segment_q[133:136] == "000"
    assert segment_q[151:153] == "BA"

    assert lot_trailer[7] == "5"
    assert lot_trailer[17:23] == "000004"
    assert lot_trailer[23:29] == "000001"
    assert lot_trailer[29:46] == "00000000000012345"
    assert file_trailer[3:7] == "9999"
    assert file_trailer[7] == "9"
    assert file_trailer[17:23] == "000001"
    assert file_trailer[23:29] == "000006"


@pytest.mark.bank_contract
def test_mercantil_return_pairs_t_u_and_preserves_company_control() -> None:
    header = list(" " * 240)
    header[0:3] = list("389")
    header[3:7] = list("0000")
    header[7] = "0"

    t = list(" " * 240)
    t[0:3] = list("389")
    t[3:7] = list("0001")
    t[7] = "3"
    t[8:13] = list("00001")
    t[13] = "T"
    t[15:17] = list("06")
    t[37:47] = list("1234567890")
    t[59:69] = list("MB12345678")
    t[73:81] = list("10092026")
    t[81:96] = list("000000000012345")
    t[105:130] = list("REC-202608-MB12345678".ljust(25))
    t[133:148] = list("000012345678901")
    t[148:188] = list("CLIENTE TESTE".ljust(40))
    t[227:236] = list("123456789")

    u = list(" " * 240)
    u[0:3] = list("389")
    u[3:7] = list("0001")
    u[7] = "3"
    u[8:13] = list("00002")
    u[13] = "U"
    u[15:17] = list("06")
    u[17:32] = list("0" * 15)
    u[32:47] = list("0" * 15)
    u[47:62] = list("0" * 15)
    u[62:77] = list("0" * 15)
    u[77:92] = list("000000000012345")
    u[92:107] = list("000000000012345")
    u[137:145] = list("25082026")
    u[145:153] = list("26082026")

    trailer = list(" " * 240)
    trailer[0:3] = list("389")
    trailer[3:7] = list("9999")
    trailer[7] = "9"

    assert all(len(line) == 240 for line in (header, t, u, trailer))
    content = ("\r\n".join(("".join(header), "".join(t), "".join(u), "".join(trailer))) + "\r\n").encode("ascii")
    events = MercantilCNAB240ReturnParser().parse(content)
    assert len(events) == 1
    event = events[0]
    assert event["provider"] == "MERCANTIL"
    assert event["bank_code"] == "389"
    assert event["document_number"] == "REC-202608-MB12345678"
    assert event["occurrence_code"] == "06"
    assert event["amount"] == Decimal("123.45")
    assert event["net_amount"] == Decimal("123.45")
    assert event["occurrence_date"] == date(2026, 8, 25)
    assert event["credit_date"] == date(2026, 8, 26)


@pytest.mark.bank_contract
def test_mercantil_rejects_non_scoped_wallet() -> None:
    with pytest.raises(ValueError, match="carteira 1"):
        MercantilCNAB240Settings.from_agreement(
            "123456789",
            "2",
            {"species_code": "01", "acceptance": "N"},
        )
