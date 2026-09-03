from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


class InterBillingCancelRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


class InterBoletoPaymentRequest(BaseModel):
    barcode: str = Field(min_length=1, max_length=120)
    amount: Decimal = Field(gt=0)
    payment_date: date
    due_date: date
    beneficiary_tax_id: str = Field(min_length=11, max_length=18)

    def provider_payload(self) -> dict[str, Any]:
        return {
            "codBarraLinhaDigitavel": self.barcode,
            "valorPagar": str(self.amount.quantize(Decimal("0.01"))),
            "dataPagamento": self.payment_date.isoformat(),
            "dataVencimento": self.due_date.isoformat(),
            "cpfCnpjBeneficiario": "".join(ch for ch in self.beneficiary_tax_id if ch.isdigit()),
        }


class InterDarfPaymentRequest(BaseModel):
    cnpj_cpf: str | None = Field(default=None, max_length=18)
    revenue_code: str | None = Field(default=None, max_length=20)
    due_date: date | None = None
    description: str | None = Field(default=None, max_length=500)
    company_name: str | None = Field(default=None, max_length=300)
    company_phone: str | None = Field(default=None, max_length=30)
    assessment_period: str | None = Field(default=None, max_length=30)
    payment_date: date | None = None
    inclusion_date: date | None = None
    value: Decimal | None = Field(default=None, ge=0)
    total_value: Decimal | None = Field(default=None, ge=0)
    fine_amount: Decimal | None = Field(default=None, ge=0)
    interest_amount: Decimal | None = Field(default=None, ge=0)
    reference: str | None = Field(default=None, max_length=100)
    darf_type: str | None = Field(default=None, max_length=80)
    payment_type: str | None = Field(default=None, max_length=80)
    principal_value: Decimal | None = Field(default=None, ge=0)

    def provider_payload(self) -> dict[str, Any]:
        def money(value: Decimal | None) -> str | None:
            return str(value.quantize(Decimal("0.01"))) if value is not None else None

        payload = {
            "cnpjCpf": "".join(ch for ch in str(self.cnpj_cpf or "") if ch.isdigit()) or None,
            "codigoReceita": self.revenue_code,
            "dataVencimento": self.due_date.isoformat() if self.due_date else None,
            "descricao": self.description,
            "nomeEmpresa": self.company_name,
            "telefoneEmpresa": self.company_phone,
            "periodoApuracao": self.assessment_period,
            "dataPagamento": self.payment_date.isoformat() if self.payment_date else None,
            "dataInclusao": self.inclusion_date.isoformat() if self.inclusion_date else None,
            "valor": money(self.value),
            "valorTotal": money(self.total_value),
            "valorMulta": money(self.fine_amount),
            "valorJuros": money(self.interest_amount),
            "referencia": self.reference,
            "tipoDarf": self.darf_type,
            "tipo": self.payment_type,
            "valorPrincipal": money(self.principal_value),
        }
        return {key: value for key, value in payload.items() if value is not None}


class InterPixPaymentRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    payment_date: date
    recipient: dict[str, Any]
    description: str | None = Field(default=None, max_length=140)

    def provider_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "valor": str(self.amount.quantize(Decimal("0.01"))),
            "dataPagamento": self.payment_date.isoformat(),
            "destinatario": self.recipient,
        }
        if self.description:
            payload["descricao"] = self.description
        return payload


class InterPaymentBatchRequest(BaseModel):
    my_identifier: str = Field(min_length=1, max_length=100)
    payments: list[dict[str, Any]] = Field(min_length=1, max_length=500)


class InterPixRefundRequest(BaseModel):
    value: Decimal = Field(gt=0)
    nature: Literal["ORIGINAL", "RETIRADA"] | None = None
    description: str | None = Field(default=None, max_length=140)


class InterWebhookRequest(BaseModel):
    webhook_url: HttpUrl


class InterPixLocationRequest(BaseModel):
    billing_type: Literal["cob", "cobv"]


class InterProviderPayload(BaseModel):
    """Payload Pix/BACEN documentado pelo Inter sem inventar schema parcial.

    CobV e lote CobV possuem estruturas regulatórias extensas e versionadas.
    O endpoint/path é fixo no provider; apenas o corpo oficial é recebido aqui.
    """

    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def not_empty(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("payload não pode ser vazio")
        return value
