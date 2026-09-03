from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.providers.banking.core.manifest import ProviderManifest


def _digits(value: object, *, length: int | None = None) -> str:
    raw = "".join(ch for ch in str(value or "") if ch.isdigit())
    if length is not None and raw:
        raw = raw[-length:].zfill(length)
    return raw


def normalize_bank_code(value: object) -> str:
    return _digits(value, length=3)


def normalize_ispb(value: object) -> str:
    return _digits(value, length=8)


def assert_provider_matches_bank_identity(
    manifest: ProviderManifest,
    *,
    bank_code: object,
    ispb: object = None,
) -> None:
    """Impede que uma conta de uma instituição seja executada por outro provider.

    O código bancário é a primeira barreira quando o provider representa um banco
    com COMPE/FEBRABAN conhecido. O ISPB é uma segunda barreira quando já existe
    no cadastro da conta. Ausência de ISPB legado não autoriza divergência: ela
    apenas permite que a criação da conexão o complete com a referência oficial.
    """

    reference = manifest.institution
    if reference is None:
        return

    expected_bank_code = normalize_bank_code(reference.bank_code)
    actual_bank_code = normalize_bank_code(bank_code)
    if expected_bank_code and actual_bank_code != expected_bank_code:
        raise APIError(
            "BANK_PROVIDER_ACCOUNT_MISMATCH",
            "A conta bancária pertence a outra instituição e não pode ser associada a este provider.",
            409,
            {
                "provider": manifest.code,
                "expected_bank_code": expected_bank_code,
                "account_bank_code": actual_bank_code or None,
            },
        )

    expected_ispb = normalize_ispb(reference.ispb)
    actual_ispb = normalize_ispb(ispb)
    if expected_ispb and actual_ispb and actual_ispb != expected_ispb:
        raise APIError(
            "BANK_PROVIDER_ACCOUNT_MISMATCH",
            "O ISPB da conta bancária não corresponde à instituição do provider.",
            409,
            {
                "provider": manifest.code,
                "expected_ispb": expected_ispb,
                "account_ispb": actual_ispb,
            },
        )


def assert_provider_matches_institution(manifest: ProviderManifest, institution: Any) -> None:
    """Valida a instituição selecionada no Control Plane contra o provider."""

    reference = manifest.institution
    if reference is None:
        raise APIError(
            "BANK_PROVIDER_INSTITUTION_MISMATCH",
            "Este provider não representa uma instituição financeira catalogada e não aceita institution_id.",
            409,
            {"provider": manifest.code},
        )

    expected_bank_code = normalize_bank_code(reference.bank_code)
    expected_ispb = normalize_ispb(reference.ispb)
    actual_bank_code = normalize_bank_code(getattr(institution, "bank_code", None))
    actual_ispb = normalize_ispb(getattr(institution, "ispb", None))

    comparable = False
    if expected_bank_code and actual_bank_code:
        comparable = True
        if actual_bank_code != expected_bank_code:
            raise APIError(
                "BANK_PROVIDER_INSTITUTION_MISMATCH",
                "A instituição selecionada não corresponde ao código bancário do provider.",
                409,
                {
                    "provider": manifest.code,
                    "expected_bank_code": expected_bank_code,
                    "institution_bank_code": actual_bank_code,
                },
            )
    if expected_ispb and actual_ispb:
        comparable = True
        if actual_ispb != expected_ispb:
            raise APIError(
                "BANK_PROVIDER_INSTITUTION_MISMATCH",
                "A instituição selecionada não corresponde ao ISPB do provider.",
                409,
                {
                    "provider": manifest.code,
                    "expected_ispb": expected_ispb,
                    "institution_ispb": actual_ispb,
                },
            )
    if (expected_bank_code or expected_ispb) and not comparable:
        raise APIError(
            "BANK_PROVIDER_INSTITUTION_MISMATCH",
            "A instituição selecionada não possui identificadores suficientes para validar o provider.",
            409,
            {"provider": manifest.code},
        )


async def bank_account_identity(session: AsyncSession, bank_account_id: UUID | str) -> dict[str, Any]:
    result = await session.execute(
        text(
            "SELECT bank_code, ispb, institution_id "
            "FROM bank_accounts WHERE id=:bank_account_id"
        ),
        {"bank_account_id": str(bank_account_id)},
    )
    row = result.mappings().first()
    if row is None:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
    return {
        "bank_code": row.get("bank_code"),
        "ispb": row.get("ispb"),
        "institution_id": row.get("institution_id"),
    }


async def assert_bank_account_provider_binding(
    session: AsyncSession,
    *,
    bank_account_id: UUID | str,
    manifest: ProviderManifest,
) -> dict[str, Any]:
    identity = await bank_account_identity(session, bank_account_id)
    assert_provider_matches_bank_identity(
        manifest,
        bank_code=identity["bank_code"],
        ispb=identity["ispb"],
    )
    return identity
