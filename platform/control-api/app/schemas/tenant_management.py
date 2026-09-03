from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, SecretStr, HttpUrl, field_validator


class CompanyUpdate(BaseModel):
    legal_name: str | None = Field(default=None, min_length=2, max_length=200)
    trade_name: str | None = Field(default=None, max_length=160)
    state_registration: str | None = None
    municipal_registration: str | None = None
    tax_regime: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: dict[str, Any] | None = None
    branding: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class CustomerContactCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    role: str | None = None
    is_primary: bool = False
    receive_billing: bool = True
    receive_invoice: bool = True
    receive_receipt: bool = True


class CustomerContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    role: str | None = None
    is_primary: bool | None = None
    receive_billing: bool | None = None
    receive_invoice: bool | None = None
    receive_receipt: bool | None = None


class ServiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = None
    default_amount: Decimal | None = Field(default=None, ge=0)
    default_frequency: str | None = None
    fiscal_service_code: str | None = None
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class ContractUpdate(BaseModel):
    description: str | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    frequency: str | None = None
    interval_count: int | None = Field(default=None, ge=1, le=36)
    billing_method: str | None = None
    due_day: int | None = Field(default=None, ge=1, le=31)
    end_date: date | None = None
    next_generation_date: date | None = None
    issue_days_before_due: int | None = Field(default=None, ge=0, le=365)
    interest_percent_monthly: Decimal | None = Field(default=None, ge=0)
    fine_percent: Decimal | None = Field(default=None, ge=0)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    fiscal_trigger: str | None = None
    notification_rule_id: UUID | None = None
    settings: dict[str, Any] | None = None
    status: str | None = None


class ReceivableUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=2, max_length=255)
    issue_date: date | None = None
    due_date: date | None = None
    original_amount: Decimal | None = Field(default=None, gt=0)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    interest_amount: Decimal | None = Field(default=None, ge=0)
    fine_amount: Decimal | None = Field(default=None, ge=0)
    abatement_amount: Decimal | None = Field(default=None, ge=0)
    metadata: dict[str, Any] | None = None


class ReceivableActionInput(BaseModel):
    action: str
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("action")
    @classmethod
    def normalize_action(cls, value: str) -> str:
        action = value.strip().upper()
        allowed = {"CANCEL", "WRITE_OFF", "REOPEN", "MARK_OVERDUE"}
        if action not in allowed:
            raise ValueError(f"Ação inválida: {action}")
        return action


class ChargeActionInput(BaseModel):
    action: str
    reason: str | None = None

    @field_validator("action")
    @classmethod
    def normalize_action(cls, value: str) -> str:
        action = value.strip().upper()
        if action not in {"CANCEL", "REFRESH", "RESEND"}:
            raise ValueError("Ação de cobrança inválida.")
        return action


class PaymentReverseInput(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class BankAccountUpdate(BaseModel):
    bank_name: str | None = None
    branch: str | None = None
    branch_digit: str | None = None
    account: str | None = None
    account_digit: str | None = None
    account_type: str | None = None
    pix_key_type: str | None = None
    pix_key: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class BankAgreementUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    environment: str | None = None
    agreement_number: str | None = None
    wallet: str | None = None
    beneficiary_code: str | None = None
    cnab_layout: str | None = None
    settings: dict[str, Any] | None = None
    credentials: dict[str, Any] | None = None
    is_active: bool | None = None


class RoleInput(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    permissions: list[str] = Field(default_factory=list)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()


class ApiKeyInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    permissions: list[str] = Field(default_factory=list)
    company_ids: list[UUID] = Field(default_factory=list)
    allowed_ips: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None


class OutboundWebhookInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    url: HttpUrl
    events: list[str] = Field(min_length=1)
    secret: SecretStr | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    max_attempts: int = Field(default=5, ge=1, le=20)
    is_active: bool = True


class NegotiationInput(BaseModel):
    company_id: UUID
    customer_id: UUID
    receivable_ids: list[UUID] = Field(min_length=1)
    negotiated_amount: Decimal = Field(gt=0)
    installment_count: int = Field(default=1, ge=1, le=120)
    first_due_date: date
    terms: dict[str, Any] = Field(default_factory=dict)


class BankTransactionInput(BaseModel):
    bank_account_id: UUID
    external_id: str = Field(min_length=1, max_length=180)
    transaction_date: date
    posted_at: datetime | None = None
    amount: Decimal
    transaction_type: str
    description: str
    document_number: str | None = None
    end_to_end_id: str | None = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class ExportRequest(BaseModel):
    export_type: str
    format: str = "XLSX"
    filters: dict[str, Any] = Field(default_factory=dict)


class PaymentLinkInput(BaseModel):
    receivable_id: UUID
    expires_at: datetime | None = None
    max_views: int | None = Field(default=None, ge=1, le=100000)


class PixAutomaticMandateInput(BaseModel):
    company_id: UUID
    customer_id: UUID
    contract_id: UUID | None = None
    bank_agreement_id: UUID
    frequency: str
    start_date: date
    finish_date: date | None = None
    fixed_amount: Decimal | None = Field(default=None, gt=0)
    min_limit_value: Decimal | None = Field(default=None, gt=0)
    description: str = Field(min_length=3, max_length=35)
    immediate_amount: Decimal = Field(gt=0)
    immediate_due_date: date
    payment_creation_mode: str = "MANUAL"
    retry_policy: str = "NOT_ALLOWED"

    @field_validator("frequency")
    @classmethod
    def validate_frequency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUALLY", "ANNUALLY"}:
            raise ValueError("Frequência inválida para Pix Automático.")
        return normalized

    @field_validator("payment_creation_mode")
    @classmethod
    def validate_creation_mode(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"MANUAL", "SUBSCRIPTION"}:
            raise ValueError("Modo de criação inválido.")
        return normalized

    @field_validator("retry_policy")
    @classmethod
    def validate_retry_policy(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"NOT_ALLOWED", "ALLOW_THREE_IN_SEVEN_DAYS"}:
            raise ValueError("Política de retentativa inválida.")
        return normalized


class PixAutomaticInstructionInput(BaseModel):
    receivable_id: UUID | None = None
    due_date: date
    amount: Decimal = Field(gt=0)
