from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.core.errors import APIError
from app.providers.banking.core.capabilities import (
    BankingCapability,
    BankingIntegrationMode,
    ProviderStatus,
)
from app.providers.banking.providers.safra.provider import SafraBankingProvider
from app.providers.banking.registry import banking_providers
from app.providers.cnab.cnab240 import CNABCompany, CNABTitle
from app.providers.cnab.safra240 import SafraCNAB240Generator, SafraCNAB240Settings


@pytest.fixture
def company() -> CNABCompany:
    return CNABCompany(
        bank_code="422",
        tax_id="12345678000199",
        name="EMPRESA TESTE LTDA",
        agreement="CONVENIO123",
        branch="1234",
        branch_digit="5",
        account="12345678",
        account_digit="9",
    )


@pytest.fixture
def settings() -> SafraCNAB240Settings:
    return SafraCNAB240Settings(
        wallet="1",
        registration_mode="1",
        document_type="2",
        boleto_emission="2",
        boleto_distribution="2",
        species_code="02",
        acceptance="N",
        protest_code="3",
        protest_days=0,
        writeoff_code="2",
        writeoff_days=0,
    )


@pytest.fixture
def title() -> CNABTitle:
    return CNABTitle(
        document_number="FAT0000001",
        our_number="",
        due_date=date(2026, 9, 15),
        amount=Decimal("1234.56"),
        payer_name="CLIENTE TESTE",
        payer_tax_id="12345678909",
        payer_address="RUA TESTE 100",
        payer_zip_code="44570000",
        payer_city="SANTO ANTONIO",
        payer_state="BA",
    )


@pytest.mark.bank_contract
def test_safra_is_installed_only_for_cnab_mode() -> None:
    manifest = banking_providers.manifest("SAFRA")
    assert banking_providers.installed("SAFRA") is True
    assert manifest.implementation_available is True
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert manifest.capabilities == frozenset({BankingCapability.CNAB_240})
    assert manifest.effective_implemented_modes() == frozenset({BankingIntegrationMode.CNAB})
    assert banking_providers.mode_available("SAFRA", BankingIntegrationMode.CNAB) is True
    assert banking_providers.mode_available("SAFRA", BankingIntegrationMode.DIRECT_API) is False
    assert "SAFRA" not in {item.code for item in banking_providers.connectable_manifests()}
    assert manifest.status is not ProviderStatus.HOMOLOGATED
    assert manifest.status is not ProviderStatus.PRODUCTION_READY


@pytest.mark.bank_contract
def test_safra_direct_api_is_explicitly_rejected() -> None:
    provider = banking_providers.get_for_mode("SAFRA", BankingIntegrationMode.CNAB)
    assert isinstance(provider, SafraBankingProvider)
    with pytest.raises(APIError) as exc:
        raise provider._direct_api_not_available()
    assert exc.value.code == "BANKING_PROVIDER_MODE_NOT_AVAILABLE"


@pytest.mark.bank_contract
def test_safra_requires_explicit_agreement_business_settings() -> None:
    with pytest.raises(ValueError) as exc:
        SafraCNAB240Settings.from_agreement("1", {})
    assert "registration_mode" in str(exc.value)
    assert "protest_code" in str(exc.value)


@pytest.mark.bank_contract
def test_safra_validates_wallet_specific_protest_rules() -> None:
    with pytest.raises(ValueError):
        SafraCNAB240Settings(
            wallet="1",
            registration_mode="1",
            document_type="2",
            boleto_emission="2",
            boleto_distribution="2",
            species_code="02",
            acceptance="N",
            protest_code="1",
            protest_days=5,
            writeoff_code="2",
            writeoff_days=0,
        ).validate()


@pytest.mark.bank_contract
def test_safra_cnab240_matches_official_fixed_positions(
    company: CNABCompany,
    settings: SafraCNAB240Settings,
    title: CNABTitle,
) -> None:
    generator = SafraCNAB240Generator(
        company,
        sequence=7,
        generation_date=date(2026, 8, 23),
        generation_time="231500",
        settings=settings,
    )
    content = generator.generate([title])
    lines = content.decode("ascii").splitlines()

    assert len(lines) == 6
    assert all(len(line) == 240 for line in lines)

    file_header = lines[0]
    assert file_header[0:3] == "422"
    assert file_header[3:7] == "0000"
    assert file_header[7] == "0"
    assert file_header[17] == "2"
    assert file_header[102:132].strip() == "BANCO SAFRA S/A"
    assert file_header[142] == "1"
    assert file_header[143:151] == "23082026"
    assert file_header[151:157] == "231500"
    assert file_header[157:163] == "000007"
    assert file_header[163:166] == "103"

    lot_header = lines[1]
    assert lot_header[0:3] == "422"
    assert lot_header[3:7] == "0001"
    assert lot_header[7] == "1"
    assert lot_header[8] == "R"
    assert lot_header[9:11] == "01"
    assert lot_header[13:16] == "060"
    assert lot_header[183:191] == "00000007"
    assert lot_header[191:199] == "23082026"

    segment_p = lines[2]
    assert segment_p[13] == "P"
    assert segment_p[15:17] == "01"
    assert segment_p[37:57] == "0" * 20
    assert segment_p[57] == "1"  # carteira simples
    assert segment_p[58] == "1"  # com cadastramento
    assert segment_p[59] == "2"  # escritural
    assert segment_p[60] == "2"  # cliente emite
    assert segment_p[61] == "2"  # cliente distribui
    assert segment_p[62:77] == "FAT0000001".ljust(15)
    assert segment_p[77:85] == "15092026"
    assert segment_p[85:100] == "000000000123456"
    assert segment_p[106:108] == "02"
    assert segment_p[108] == "N"
    assert segment_p[117] == "3"  # juros isentos na capacidade implementada
    assert segment_p[220] == "3"  # não protestar
    assert segment_p[223] == "2"  # não baixar/não devolver
    assert segment_p[227:229] == "09"  # Real

    segment_q = lines[3]
    assert segment_q[13] == "Q"
    assert segment_q[15:17] == "01"
    assert segment_q[17] == "1"
    assert segment_q[18:33] == "000012345678909"
    assert segment_q[128:133] == "44570"
    assert segment_q[133:136] == "000"
    assert segment_q[136:151].strip() == "SANTO ANTONIO"
    assert segment_q[151:153] == "BA"

    lot_trailer = lines[4]
    assert lot_trailer[7] == "5"
    assert lot_trailer[17:23] == "000004"  # header lote + P + Q + trailer
    assert lot_trailer[23:29] == "000001"
    assert lot_trailer[29:46] == "00000000000123456"
    assert lot_trailer[46:52] == "000000"

    file_trailer = lines[5]
    assert file_trailer[3:7] == "9999"
    assert file_trailer[7] == "9"
    assert file_trailer[17:23] == "000001"
    assert file_trailer[23:29] == "000006"


@pytest.mark.bank_contract
def test_safra_rejects_document_over_ten_available_positions(
    company: CNABCompany,
    settings: SafraCNAB240Settings,
    title: CNABTitle,
) -> None:
    generator = SafraCNAB240Generator(
        company,
        sequence=1,
        generation_date=date(2026, 8, 23),
        settings=settings,
    )
    too_long = CNABTitle(
        document_number="DOCUMENTO12345",
        our_number=title.our_number,
        due_date=title.due_date,
        amount=title.amount,
        payer_name=title.payer_name,
        payer_tax_id=title.payer_tax_id,
        payer_address=title.payer_address,
        payer_zip_code=title.payer_zip_code,
        payer_city=title.payer_city,
        payer_state=title.payer_state,
    )
    with pytest.raises(ValueError) as exc:
        generator.generate([too_long])
    assert "10 posições" in str(exc.value)


@pytest.mark.bank_contract
def test_safra_return_parser_reads_official_t_u_positions() -> None:
    def fixed() -> list[str]:
        return [" "] * 240

    header = fixed()
    header[0:3] = "422"
    header[3:7] = "0000"
    header[7] = "0"

    t = fixed()
    t[0:3] = "422"
    t[3:7] = "0001"
    t[7] = "3"
    t[8:13] = "00001"
    t[13] = "T"
    t[15:17] = "06"
    t[37:57] = list("00000000000123456789")
    t[57] = "1"
    t[58:73] = list("FAT0000001".ljust(15))
    t[73:81] = list("15092026")
    t[81:96] = list("000000000123456")
    t[132] = "1"
    t[133:148] = list("000012345678909")
    t[148:188] = list("CLIENTE TESTE".ljust(40))

    u = fixed()
    u[0:3] = "422"
    u[3:7] = "0001"
    u[7] = "3"
    u[8:13] = "00002"
    u[13] = "U"
    u[15:17] = "06"
    u[77:92] = list("000000000123456")
    u[92:107] = list("000000000123000")
    u[137:145] = list("23082026")
    u[145:153] = list("24082026")

    trailer = fixed()
    trailer[0:3] = "422"
    trailer[3:7] = "9999"
    trailer[7] = "9"

    content = ("\r\n".join("".join(line) for line in (header, t, u, trailer)) + "\r\n").encode("ascii")
    events = SafraBankingProvider.parse_cnab240_return(content)
    assert len(events) == 1
    event = events[0]
    assert event["provider"] == "SAFRA"
    assert event["occurrence_code"] == "06"
    assert event["document_number"] == "FAT0000001"
    assert event["payer_tax_id"] == "000012345678909"
    assert event["payer_name"] == "CLIENTE TESTE"
    assert event["amount"] == Decimal("1234.56")
    assert event["net_amount"] == Decimal("1230.00")
    assert event["occurrence_date"] == date(2026, 8, 23)
    assert event["credit_date"] == date(2026, 8, 24)
