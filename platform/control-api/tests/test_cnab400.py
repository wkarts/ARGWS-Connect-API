from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.providers.cnab.cnab240 import CNABCompany, CNABTitle
from app.providers.cnab.cnab400 import CNAB400Generator, CNAB400Layout, CNAB400ReturnParser


def company() -> CNABCompany:
    return CNABCompany(
        bank_code="001",
        tax_id="12345678000190",
        name="CONNECT API SERVICOS LTDA",
        agreement="1234567",
        branch="1234",
        branch_digit="5",
        account="987654",
        account_digit="0",
    )


def title() -> CNABTitle:
    return CNABTitle(
        document_number="REC-0001",
        our_number="12345678901",
        due_date=date(2026, 8, 25),
        amount=Decimal("1621.00"),
        payer_name="CLIENTE TESTE LTDA",
        payer_tax_id="98765432000110",
        payer_address="RUA DAS FLORES 100",
        payer_zip_code="44570000",
        payer_city="SANTO ANTONIO DE JESUS",
        payer_state="BA",
    )


def test_cnab400_generator_produces_fixed_width_crlf_file() -> None:
    content = CNAB400Generator(
        company(), 1, date(2026, 8, 20), CNAB400Layout(wallet="17")
    ).generate([title()])
    assert content.endswith(b"\r\n")
    lines = content.decode("ascii").splitlines()
    assert len(lines) == 3
    assert all(len(line) == 400 for line in lines)
    assert lines[0][76:79] == "001"
    assert lines[1][0] == "1"
    assert lines[-1][0] == "9"


def test_cnab400_return_parser_normalizes_liquidation() -> None:
    line = list(" " * 400)
    line[0] = "1"
    line[62:73] = "12345678901"
    line[108:110] = "06"
    line[110:116] = "200826"
    line[116:126] = "DOC-0001  "
    line[152:165] = "0000000162100"
    line[253:266] = "0000000162100"
    line[295:301] = "210826"
    line[394:400] = "000002"

    events = CNAB400ReturnParser().parse(("".join(line) + "\r\n").encode("latin-1"))
    assert len(events) == 1
    event = events[0]
    assert event["occurrence_code"] == "06"
    assert event["occurrence_description"] == "Liquidação"
    assert event["our_number"] == "12345678901"
    assert event["document_number"] == "DOC-0001"
    assert event["amount"] == Decimal("1621.00")
    assert event["occurrence_date"] == date(2026, 8, 20)
    assert event["credit_date"] == date(2026, 8, 21)


def test_cnab400_return_parser_rejects_invalid_width() -> None:
    with pytest.raises(ValueError, match="tamanho inválido"):
        CNAB400ReturnParser().parse(b"1INVALIDO\r\n")
