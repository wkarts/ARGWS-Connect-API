from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.providers.banking.core.capabilities import BankingCapability, BankingIntegrationMode
from app.providers.banking.registry import banking_providers
from app.providers.cnab.cnab240 import CNAB240ReturnParser
from app.providers.cnab.cnab400 import CNAB400ReturnParser


def _digits(value: object) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _normalized_bank_code(value: object) -> str:
    raw = _digits(value)
    return raw.zfill(3)[-3:] if raw else ""


@dataclass(frozen=True, slots=True)
class CNABReturnParsingResult:
    layout: str
    bank_code: str
    provider_code: str | None
    provider_mode: str
    events: list[dict[str, object]]


def _layout_and_bank_code(content: bytes) -> tuple[str, str]:
    first_line = next(
        (line for line in content.decode("latin-1", errors="ignore").splitlines() if line.strip()),
        "",
    )
    if len(first_line) == 240:
        return "240", _normalized_bank_code(first_line[:3])
    if len(first_line) == 400:
        # CNAB400 de cobrança usa o código do banco no header em 77-79.
        return "400", _normalized_bank_code(first_line[76:79])
    raise ValueError("Não foi possível identificar o layout CNAB 240/400 pelo tamanho do registro.")


def _provider_for_bank_code(bank_code: str) -> str | None:
    candidates: list[str] = []
    for manifest in banking_providers.manifests():
        institution = manifest.institution
        if institution is None or not institution.bank_code:
            continue
        if _normalized_bank_code(institution.bank_code) != bank_code:
            continue
        if not banking_providers.mode_available(manifest.code, BankingIntegrationMode.CNAB):
            continue
        candidates.append(manifest.code)
    if len(candidates) > 1:
        raise ValueError(
            "Mais de um provider CNAB executável foi associado ao mesmo código bancário: "
            + ", ".join(sorted(candidates))
        )
    return candidates[0] if candidates else None


def parse_cnab_return(content: bytes) -> CNABReturnParsingResult:
    """Seleciona parser pelo próprio código bancário do arquivo.

    O usuário não escolhe manualmente qual provider deve interpretar o retorno.
    Quando há adapter CNAB específico instalado para o banco, ele é obrigatório.
    Sem adapter especializado, o parser legado permanece como fallback, sem
    promover manifest/catalog a driver.
    """

    layout, bank_code = _layout_and_bank_code(content)
    provider_code = _provider_for_bank_code(bank_code)
    if provider_code is None:
        events = (
            CNAB240ReturnParser().parse(content)
            if layout == "240"
            else CNAB400ReturnParser().parse(content)
        )
        return CNABReturnParsingResult(
            layout=layout,
            bank_code=bank_code,
            provider_code=None,
            provider_mode="LEGACY_GENERIC_CNAB",
            events=events,
        )

    manifest = banking_providers.manifest(provider_code)
    required_capability = (
        BankingCapability.CNAB_240 if layout == "240" else BankingCapability.CNAB_400
    )
    if required_capability not in manifest.capabilities:
        raise ValueError(
            f"Provider {provider_code} não implementa retorno CNAB{layout} nesta versão."
        )
    provider = banking_providers.get_for_mode(provider_code, BankingIntegrationMode.CNAB)
    parser = getattr(provider, f"parse_cnab{layout}_return", None)
    if parser is None:
        raise ValueError(
            f"Provider {provider_code} anuncia CNAB{layout}, mas não possui parser de retorno instalado."
        )
    events = parser(content)
    if not isinstance(events, list):
        raise ValueError(f"Parser CNAB do provider {provider_code} retornou contrato inválido.")

    for event in events:
        if not isinstance(event, dict):
            raise ValueError(f"Parser CNAB do provider {provider_code} retornou evento inválido.")
        declared_provider = str(event.get("provider") or provider_code).strip().upper()
        declared_bank_code = _normalized_bank_code(event.get("bank_code") or bank_code)
        if declared_provider != provider_code:
            raise ValueError(
                f"Parser CNAB {provider_code} tentou produzir evento de outro provider: {declared_provider}."
            )
        if declared_bank_code != bank_code:
            raise ValueError(
                f"Parser CNAB {provider_code} retornou código bancário divergente: {declared_bank_code}."
            )
        event["provider"] = provider_code
        event["bank_code"] = bank_code

    return CNABReturnParsingResult(
        layout=layout,
        bank_code=bank_code,
        provider_code=provider_code,
        provider_mode="PROVIDER_CNAB",
        events=events,
    )
