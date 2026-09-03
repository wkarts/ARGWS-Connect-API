from __future__ import annotations

from typing import Any

from app.core.errors import APIError
from app.models.tenant import Company


def digits(value: object) -> str:
    return "".join(char for char in str(value or "") if char.isdigit())


def _valid_ddd(value: object) -> str | None:
    raw = digits(value)
    if len(raw) == 2 and raw[0] not in {"0", "1"}:
        return raw
    return None


def default_company_ddd(company: Company | None) -> str | None:
    if company is None:
        return None
    settings = dict(company.settings or {})
    communication = settings.get("communication") if isinstance(settings.get("communication"), dict) else {}
    address = dict(company.address or {})
    for candidate in (
        communication.get("default_ddd"),
        settings.get("default_ddd"),
        address.get("ddd"),
        address.get("area_code"),
    ):
        resolved = _valid_ddd(candidate)
        if resolved:
            return resolved

    phone = digits(company.phone)
    if phone.startswith("55") and len(phone) in {12, 13}:
        return _valid_ddd(phone[2:4])
    if len(phone) in {10, 11}:
        return _valid_ddd(phone[:2])
    return None


def normalize_brazil_phone(
    value: str,
    *,
    company: Company | None = None,
    default_ddd: str | None = None,
    field_name: str = "número do WhatsApp",
) -> str:
    """Normaliza número brasileiro para E.164 sem o sinal de `+`.

    Regras operacionais da plataforma:
    - país ausente: assume Brasil (`55`);
    - número já com `55`: preserva;
    - DDD ausente (8/9 dígitos): usa o DDD padrão da empresa emissora;
    - prefixos `+`, espaços, pontuação e `00` são removidos;
    - não adivinha DDD quando a empresa não possui parametrização.
    """
    raw = digits(value)
    if not raw:
        raise APIError("PHONE_REQUIRED", f"Informe o {field_name}.", 422)

    while raw.startswith("00"):
        raw = raw[2:]
    if raw.startswith("0") and len(raw) in {11, 12}:
        # Prefixo nacional antigo/operadora. Mantemos os últimos 10/11 dígitos.
        raw = raw[-11:]

    if raw.startswith("55"):
        national = raw[2:]
    else:
        national = raw

    if len(national) in {8, 9}:
        ddd = _valid_ddd(default_ddd) or default_company_ddd(company)
        if not ddd:
            raise APIError(
                "DEFAULT_DDD_REQUIRED",
                "O número foi informado sem DDD e a empresa emissora não possui DDD padrão parametrizado.",
                422,
                {"field": field_name},
            )
        national = f"{ddd}{national}"

    if len(national) not in {10, 11}:
        raise APIError(
            "PHONE_INVALID",
            f"O {field_name} deve conter DDD + número, ou apenas o número quando houver DDD padrão na empresa.",
            422,
        )
    if not _valid_ddd(national[:2]):
        raise APIError("DDD_INVALID", "DDD inválido para número brasileiro.", 422)

    subscriber = national[2:]
    if len(subscriber) not in {8, 9}:
        raise APIError("PHONE_INVALID", f"O {field_name} possui quantidade de dígitos inválida.", 422)

    return f"55{national}"


def company_communication_settings(company: Company) -> dict[str, Any]:
    settings = dict(company.settings or {})
    communication = settings.get("communication") if isinstance(settings.get("communication"), dict) else {}
    return {
        "default_ddd": default_company_ddd(company),
        "country_code": "55",
        **dict(communication),
    }
