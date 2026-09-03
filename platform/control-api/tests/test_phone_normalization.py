from __future__ import annotations

import pytest

from app.core.errors import APIError
from app.models.tenant import Company
from app.services.phones import default_company_ddd, normalize_brazil_phone


def company(*, ddd: str | None = None, phone: str | None = None) -> Company:
    communication = {"default_ddd": ddd} if ddd else {}
    return Company(
        legal_name="Empresa Teste",
        trade_name="Empresa Teste",
        tax_id="12345678000199",
        phone=phone,
        address={},
        branding={},
        settings={"communication": communication},
        is_active=True,
    )


def test_phone_with_country_code_is_preserved() -> None:
    assert normalize_brazil_phone("+55 (75) 99884-9231") == "5575998849231"


def test_phone_without_country_code_receives_55() -> None:
    assert normalize_brazil_phone("75 99884-9231") == "5575998849231"


def test_phone_without_ddd_uses_company_default_ddd() -> None:
    emitter = company(ddd="75")
    assert normalize_brazil_phone("99884-9231", company=emitter) == "5575998849231"


def test_company_ddd_can_be_derived_from_company_phone() -> None:
    emitter = company(phone="(75) 3631-0000")
    assert default_company_ddd(emitter) == "75"
    assert normalize_brazil_phone("99884-9231", company=emitter) == "5575998849231"


def test_phone_without_ddd_fails_when_company_has_no_default() -> None:
    with pytest.raises(APIError) as excinfo:
        normalize_brazil_phone("99884-9231", company=company())
    assert excinfo.value.code == "DEFAULT_DDD_REQUIRED"
