from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import ORMModel


def digits(value: str | None) -> str | None:
    return "".join(ch for ch in value if ch.isdigit()) if value else value


class CompanyCreate(BaseModel):
    legal_name: str = Field(min_length=2, max_length=200)
    trade_name: str | None = Field(default=None, max_length=160)
    tax_id: str = Field(min_length=11, max_length=20)
    state_registration: str | None = None
    municipal_registration: str | None = None
    tax_regime: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: dict[str, Any] = Field(default_factory=dict)
    branding: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("tax_id")
    @classmethod
    def normalize_tax_id(cls, value: str) -> str:
        return digits(value) or ""


class CompanyRead(ORMModel):
    id: UUID
    legal_name: str
    trade_name: str | None
    tax_id: str
    email: str | None
    phone: str | None
    address: dict[str, Any]
    branding: dict[str, Any]
    settings: dict[str, Any]
    is_active: bool
    created_at: datetime


class CustomerContactInput(BaseModel):
    name: str
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    role: str | None = None
    is_primary: bool = False
    receive_billing: bool = True
    receive_invoice: bool = True
    receive_receipt: bool = True


class CustomerCreate(BaseModel):
    person_type: str = "PJ"
    name: str = Field(min_length=2, max_length=220)
    trade_name: str | None = None
    tax_id: str | None = None
    state_registration: str | None = None
    municipal_registration: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    contacts: list[CustomerContactInput] = Field(default_factory=list)

    @field_validator("tax_id")
    @classmethod
    def normalize_tax_id(cls, value: str | None) -> str | None:
        return digits(value)


class CustomerUpdate(BaseModel):
    name: str | None = None
    trade_name: str | None = None
    tax_id: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: dict[str, Any] | None = None
    tags: list[str] | None = None
    notes: str | None = None
    is_active: bool | None = None


class CustomerRead(ORMModel):
    id: UUID
    person_type: str
    name: str
    trade_name: str | None
    tax_id: str | None
    email: str | None
    phone: str | None
    whatsapp: str | None
    address: dict[str, Any]
    tags: list[str]
    is_active: bool
    created_at: datetime


class ServiceCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=2, max_length=180)
    description: str | None = None
    default_amount: Decimal = Field(ge=0)
    default_frequency: str = "MONTHLY"
    fiscal_service_code: str | None = None


class ServiceRead(ORMModel):
    id: UUID
    code: str
    name: str
    description: str | None
    default_amount: Decimal
    default_frequency: str
    is_active: bool


class ContractCreate(BaseModel):
    company_id: UUID
    customer_id: UUID
    service_id: UUID
    code: str = Field(min_length=1, max_length=64)
    description: str | None = None
    amount: Decimal = Field(gt=0)
    frequency: str = "MONTHLY"
    interval_count: int = Field(default=1, ge=1, le=36)
    billing_method: str = "BOLETO_PIX"
    due_day: int = Field(default=10, ge=1, le=31)
    start_date: date
    end_date: date | None = None
    next_generation_date: date | None = None
    issue_days_before_due: int = Field(default=10, ge=0, le=365)
    interest_percent_monthly: Decimal = Field(default=Decimal("0"), ge=0)
    fine_percent: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    fiscal_trigger: str = "ON_PAYMENT"
    settings: dict[str, Any] = Field(default_factory=dict)


class ContractRead(ORMModel):
    id: UUID
    company_id: UUID
    customer_id: UUID
    service_id: UUID
    code: str
    amount: Decimal
    frequency: str
    billing_method: str
    due_day: int
    start_date: date
    end_date: date | None
    next_generation_date: date
    status: str
    created_at: datetime


class ReceivableCreate(BaseModel):
    company_id: UUID
    customer_id: UUID
    contract_id: UUID | None = None
    competence: str = Field(pattern=r"^\d{4}-\d{2}$")
    description: str = Field(min_length=2, max_length=255)
    issue_date: date
    due_date: date
    original_amount: Decimal = Field(gt=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)


class ReceivableRead(ORMModel):
    id: UUID
    company_id: UUID
    customer_id: UUID
    contract_id: UUID | None
    document_number: str
    competence: str
    description: str
    issue_date: date
    due_date: date
    original_amount: Decimal
    discount_amount: Decimal
    interest_amount: Decimal
    fine_amount: Decimal
    paid_amount: Decimal
    balance: Decimal
    status: str
    source: str
    created_at: datetime


class ChargeCreate(BaseModel):
    receivable_id: UUID
    bank_agreement_id: UUID | None = None
    charge_type: str = "BOLETO_PIX"
    provider: str = "SANDBOX"


class ChargeRead(ORMModel):
    id: UUID
    receivable_id: UUID
    charge_type: str
    provider: str
    external_id: str
    our_number: str | None
    txid: str | None
    digitable_line: str | None
    barcode: str | None
    pix_copy_paste: str | None
    document_url: str | None
    status: str
    registered_at: datetime | None


class PaymentCreate(BaseModel):
    receivable_id: UUID
    charge_id: UUID | None = None
    provider: str = "MANUAL"
    external_id: str = Field(min_length=4, max_length=180)
    end_to_end_id: str | None = None
    amount: Decimal = Field(gt=0)
    paid_at: datetime
    payment_method: str = "TRANSFER"


class PaymentRead(ORMModel):
    id: UUID
    receivable_id: UUID
    charge_id: UUID | None
    provider: str
    external_id: str
    amount: Decimal
    paid_at: datetime
    payment_method: str
    status: str


class BankAccountCreate(BaseModel):
    company_id: UUID
    bank_code: str = Field(min_length=3, max_length=3)
    bank_name: str
    branch: str
    branch_digit: str | None = None
    account: str
    account_digit: str | None = None
    account_type: str = "CHECKING"
    pix_key_type: str | None = None
    pix_key: str | None = None
    is_default: bool = False


class BankAgreementCreate(BaseModel):
    company_id: UUID
    bank_account_id: UUID
    name: str
    provider: str = "SANDBOX"
    environment: str = "SANDBOX"
    agreement_number: str | None = None
    wallet: str | None = None
    beneficiary_code: str | None = None
    cnab_layout: str = "240"
    settings: dict[str, Any] = Field(default_factory=dict)
    credentials: dict[str, Any] = Field(default_factory=dict)


class IntegrationSettingInput(BaseModel):
    scope: str = "TENANT"
    company_id: UUID | None = None
    provider: str | None = None
    is_enabled: bool = True
    public_config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any] = Field(default_factory=dict)


class NotificationRuleEventInput(BaseModel):
    offset_days: int = Field(ge=-365, le=365)
    channels: list[str] = Field(min_length=1, max_length=2)
    template: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("channels")
    @classmethod
    def normalize_channels(cls, value: list[str]) -> list[str]:
        channels = list(dict.fromkeys(item.strip().upper() for item in value))
        invalid = sorted(set(channels) - {"EMAIL", "WHATSAPP"})
        if invalid:
            raise ValueError("Canais não suportados: " + ", ".join(invalid))
        return channels

    @field_validator("template")
    @classmethod
    def normalize_template(cls, value: str) -> str:
        return value.strip().upper()


class NotificationRuleInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    events: list[NotificationRuleEventInput] = Field(min_length=1, max_length=50)
    is_default: bool = False
    is_active: bool = True


class NotificationTemplateInput(BaseModel):
    code: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    channel: str
    subject: str | None = Field(default=None, max_length=255)
    body: str = Field(min_length=1, max_length=20000)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("channel")
    @classmethod
    def normalize_channel(cls, value: str) -> str:
        channel = value.strip().upper()
        if channel not in {"EMAIL", "WHATSAPP"}:
            raise ValueError("Canal deve ser EMAIL ou WHATSAPP.")
        return channel


class NotificationTestRequest(BaseModel):
    channel: str
    destination: str
    company_id: UUID | None = None
    subject: str | None = "Teste da plataforma financeira"
    body: str = "Esta é uma mensagem de teste da Connect|API Platform."

    @field_validator("channel")
    @classmethod
    def normalize_channel(cls, value: str) -> str:
        channel = value.strip().upper()
        if channel not in {"EMAIL", "WHATSAPP"}:
            raise ValueError("Canal deve ser EMAIL ou WHATSAPP.")
        return channel


class DashboardRead(BaseModel):
    open_amount: Decimal
    overdue_amount: Decimal
    received_month: Decimal
    receivables_count: int
    overdue_count: int
    active_contracts: int
    customers: int


class ReconciliationInput(BaseModel):
    receivable_id: UUID
    payment_id: UUID | None = None
    bank_transaction_id: str | None = None
    status: str = "MATCHED"
    score: Decimal = Field(default=Decimal("100"), ge=0, le=100)
    criteria: dict[str, Any] = Field(default_factory=dict)


class FiscalIssueInput(BaseModel):
    receivable_id: UUID
    provider: str | None = None


class ReceiptIssueInput(BaseModel):
    payment_id: UUID


class TenantUserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    phone: str | None = None
    password: str = Field(min_length=12, max_length=512)
    role: str = "FINANCE_OPERATOR"
    permissions: list[str] = Field(default_factory=list)
    company_ids: list[UUID] = Field(default_factory=list)
    is_active: bool = True


class TenantUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    phone: str | None = None
    role: str | None = None
    permissions: list[str] | None = None
    company_ids: list[UUID] | None = None
    is_active: bool | None = None


class PasswordResetInput(BaseModel):
    password: str = Field(min_length=12, max_length=512)
