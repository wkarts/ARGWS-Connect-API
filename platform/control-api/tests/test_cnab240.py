from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.providers.cnab.cnab240 import (
    CNAB240Generator,
    CNAB240ReturnParser,
    CNABCompany,
    CNABTitle,
    ascii_text,
    numeric,
)


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
        document_number="REC-202608-0001",
        our_number="12345678901234567",
        due_date=date(2026, 8, 25),
        amount=Decimal("1621.00"),
        payer_name="CLIENTE TESTE LTDA",
        payer_tax_id="98765432000110",
        payer_address="RUA DAS FLORES 100",
        payer_zip_code="44570000",
        payer_city="SANTO ANTONIO DE JESUS",
        payer_state="BA",
    )


def test_cnab240_generator_produces_fixed_width_crlf_file() -> None:
    content = CNAB240Generator(company(), 1, date(2026, 8, 20)).generate([title()])
    assert content.endswith(b"\r\n")
    lines = content.decode("ascii").splitlines()
    assert len(lines) == 6
    assert all(len(line) == 240 for line in lines)
    assert lines[0][:3] == "001"
    assert lines[2][13] == "P"
    assert lines[3][13] == "Q"


def test_cnab_helpers_normalize_accents_and_decimals() -> None:
    assert ascii_text("São João", 10).startswith("SAO JOAO")
    assert numeric(Decimal("10.50"), 8) == "00001050"


def test_return_parser_rejects_invalid_record_width() -> None:
    with pytest.raises(ValueError, match="tamanho inválido"):
        CNAB240ReturnParser().parse(b"001INVALIDO\r\n")


def test_return_parser_extracts_segment_t() -> None:
    line = list(" " * 240)
    line[0:3] = "001"
    line[7] = "3"
    line[8:13] = "00001"
    line[13] = "T"
    line[15:17] = "06"
    line[37:57] = "12345678901234567   "
    line[58:73] = "DOC-0001       "
    events = CNAB240ReturnParser().parse(("".join(line) + "\r\n").encode("latin-1"))
    assert len(events) == 1
    event = events[0]
    assert event["sequence"] == "00001"
    assert event["occurrence_code"] == "06"
    assert event["occurrence_description"] == "Liquidação"
    assert event["our_number"] == "12345678901234567"
    assert event["document_number"] == "DOC-0001"
    assert event["segments"] == {"T": "".join(line)}
