from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class BBProviderPayload(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)


class BBReturnMovementRequest(BaseModel):
    dataMovimentoRetornoInicial: str = Field(min_length=10, max_length=10)
    dataMovimentoRetornoFinal: str = Field(min_length=10, max_length=10)
    codigoPrefixoAgencia: int | None = Field(default=None, ge=0)
    numeroContaCorrente: int | None = Field(default=None, ge=0)
    numeroCarteiraCobranca: int | None = Field(default=None, ge=0)
    numeroVariacaoCarteiraCobranca: int | None = Field(default=None, ge=0)
    numeroRegistroPretendido: int | None = Field(default=None, ge=1)
    quantidadeRegistroPretendido: int | None = Field(default=None, ge=1, le=10000)

    @field_validator("dataMovimentoRetornoInicial", "dataMovimentoRetornoFinal")
    @classmethod
    def validate_bb_date(cls, value: str) -> str:
        import datetime as _dt

        try:
            _dt.datetime.strptime(value, "%d.%m.%Y")
        except ValueError as exc:
            raise ValueError("Data BB deve usar o formato dd.mm.aaaa.") from exc
        return value


class BBOperationalDownToggle(BaseModel):
    enabled: bool
