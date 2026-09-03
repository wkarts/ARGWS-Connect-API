from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import TenantBase, TimestampMixin, UUIDPrimaryKeyMixin


class Company(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "companies"

    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    trade_name: Mapped[str | None] = mapped_column(String(160))
    tax_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    state_registration: Mapped[str | None] = mapped_column(String(32))
    municipal_registration: Mapped[str | None] = mapped_column(String(32))
    tax_regime: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(32))
    address: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    branding: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TenantUser(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="TENANT_ADMIN")
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    companies: Mapped[list[UserCompany]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserCompany(UUIDPrimaryKeyMixin, TenantBase):
    __tablename__ = "user_companies"
    __table_args__ = (UniqueConstraint("user_id", "company_id", name="uq_user_company"),)

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[TenantUser] = relationship(back_populates="companies")


class TenantRefreshToken(UUIDPrimaryKeyMixin, TenantBase):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Customer(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "customers"
    __table_args__ = (
        Index("ix_customers_name", "name"),
        Index("ix_customers_tax_id", "tax_id"),
    )

    person_type: Mapped[str] = mapped_column(String(2), nullable=False, default="PJ")
    name: Mapped[str] = mapped_column(String(220), nullable=False)
    trade_name: Mapped[str | None] = mapped_column(String(180))
    tax_id: Mapped[str | None] = mapped_column(String(20))
    state_registration: Mapped[str | None] = mapped_column(String(32))
    municipal_registration: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(32))
    whatsapp: Mapped[str | None] = mapped_column(String(32))
    address: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    contacts: Mapped[list[CustomerContact]] = relationship(
        back_populates="customer", cascade="all, delete-orphan"
    )


class CustomerContact(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "customer_contacts"

    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(32))
    whatsapp: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[str | None] = mapped_column(String(80))
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    receive_billing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    receive_invoice: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    receive_receipt: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    customer: Mapped[Customer] = relationship(back_populates="contacts")


class ServiceCatalog(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "services"

    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    default_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    default_frequency: Mapped[str] = mapped_column(String(32), nullable=False, default="MONTHLY")
    fiscal_service_code: Mapped[str | None] = mapped_column(String(64))
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Contract(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "contracts"
    __table_args__ = (
        Index("ix_contracts_customer_status", "customer_id", "status"),
        Index("ix_contracts_next_generation", "status", "next_generation_date"),
    )

    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    service_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("services.id", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    frequency: Mapped[str] = mapped_column(String(32), nullable=False, default="MONTHLY")
    interval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    billing_method: Mapped[str] = mapped_column(String(32), nullable=False, default="BOLETO_PIX")
    due_day: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    next_generation_date: Mapped[date] = mapped_column(Date, nullable=False)
    issue_days_before_due: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    interest_percent_monthly: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=0)
    fine_percent: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    fiscal_trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="ON_PAYMENT")
    notification_rule_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", index=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class Receivable(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "receivables"
    __table_args__ = (
        UniqueConstraint("contract_id", "competence", name="uq_receivable_contract_competence"),
        Index("ix_receivables_company_due", "company_id", "due_date"),
        Index("ix_receivables_customer_status", "customer_id", "status"),
    )

    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    contract_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("contracts.id", ondelete="SET NULL"), index=True
    )
    document_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    competence: Mapped[str] = mapped_column(String(7), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    original_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    interest_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    fine_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    abatement_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN", index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="MANUAL")
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)


class BankAccount(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_accounts"

    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bank_code: Mapped[str] = mapped_column(String(3), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), nullable=False)
    branch: Mapped[str] = mapped_column(String(12), nullable=False)
    branch_digit: Mapped[str | None] = mapped_column(String(2))
    account: Mapped[str] = mapped_column(String(24), nullable=False)
    account_digit: Mapped[str | None] = mapped_column(String(2))
    account_type: Mapped[str] = mapped_column(String(32), nullable=False, default="CHECKING")
    pix_key_type: Mapped[str | None] = mapped_column(String(16))
    pix_key: Mapped[str | None] = mapped_column(String(140))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class BankAgreement(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_agreements"

    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bank_account_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="SANDBOX")
    environment: Mapped[str] = mapped_column(String(32), nullable=False, default="SANDBOX")
    agreement_number: Mapped[str | None] = mapped_column(String(40))
    wallet: Mapped[str | None] = mapped_column(String(20))
    beneficiary_code: Mapped[str | None] = mapped_column(String(40))
    next_our_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    cnab_layout: Mapped[str] = mapped_column(String(16), nullable=False, default="240")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    encrypted_credentials: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Charge(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "charges"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_charge_provider_external"),
        Index("ix_charges_receivable_status", "receivable_id", "status"),
    )

    receivable_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("receivables.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bank_agreement_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_agreements.id", ondelete="SET NULL")
    )
    charge_type: Mapped[str] = mapped_column(String(32), nullable=False, default="BOLETO_PIX")
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(160), nullable=False)
    our_number: Mapped[str | None] = mapped_column(String(64), index=True)
    txid: Mapped[str | None] = mapped_column(String(80), index=True)
    digitable_line: Mapped[str | None] = mapped_column(String(80))
    barcode: Mapped[str | None] = mapped_column(String(80))
    pix_copy_paste: Mapped[str | None] = mapped_column(Text)
    document_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_response: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class Payment(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_payment_provider_external"),
        Index("ix_payments_receivable_date", "receivable_id", "paid_at"),
    )

    receivable_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("receivables.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    charge_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("charges.id", ondelete="SET NULL"), index=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(180), nullable=False)
    end_to_end_id: Mapped[str | None] = mapped_column(String(100), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CONFIRMED")
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IntegrationSetting(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "integration_settings"
    __table_args__ = (
        UniqueConstraint("scope", "company_id", "provider", name="uq_integration_scope_provider"),
    )

    scope: Mapped[str] = mapped_column(String(32), nullable=False, default="TENANT")
    company_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    public_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    encrypted_secrets: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_health_status: Mapped[str | None] = mapped_column(String(32))
    last_health_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class NotificationRule(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "notification_rules"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    events: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class NotificationTemplate(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "notification_templates"
    __table_args__ = (UniqueConstraint("code", "channel", name="uq_template_code_channel"),)

    code: Mapped[str] = mapped_column(String(80), nullable=False)
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_status_schedule", "status", "scheduled_at"),)

    company_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    customer_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    receivable_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    destination: Mapped[str] = mapped_column(String(254), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    external_id: Mapped[str | None] = mapped_column(String(180))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)


class OutboxEvent(UUIDPrimaryKeyMixin, TenantBase):
    __tablename__ = "outbox_events"
    __table_args__ = (Index("ix_outbox_status_available", "status", "available_at"),)

    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(100), nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class WebhookEvent(UUIDPrimaryKeyMixin, TenantBase):
    __tablename__ = "webhook_events"
    __table_args__ = (UniqueConstraint("provider", "event_id", name="uq_webhook_provider_event"),)

    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    event_id: Mapped[str] = mapped_column(String(180), nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    signature_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RECEIVED")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class CNABRemittance(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "cnab_remittances"

    company_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    bank_agreement_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    layout: Mapped[str] = mapped_column(String(16), nullable=False, default="240")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="GENERATED")
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class CNABReturn(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "cnab_returns"

    company_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    bank_code: Mapped[str] = mapped_column(String(3), nullable=False)
    layout: Mapped[str] = mapped_column(String(16), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RECEIVED")
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    raw_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class Reconciliation(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "reconciliations"

    receivable_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    payment_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    bank_transaction_id: Mapped[str | None] = mapped_column(String(180), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUGGESTED")
    score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    criteria: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reconciled_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Document(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "documents"
    __table_args__ = (Index("ix_documents_entity", "entity_type", "entity_id"),)

    company_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(100), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_immutable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class FiscalDocument(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "fiscal_documents"

    company_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    receivable_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(180), index=True)
    number: Mapped[str | None] = mapped_column(String(64))
    verification_code: Mapped[str | None] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    xml_object_key: Mapped[str | None] = mapped_column(Text)
    pdf_object_key: Mapped[str | None] = mapped_column(Text)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class Receipt(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "receipts"

    company_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    receivable_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    payment_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, unique=True)
    number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    object_key: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(String(64))


class TenantAuditLog(UUIDPrimaryKeyMixin, TenantBase):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_tenant_audit_entity", "entity_type", "entity_id"),)

    actor_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    company_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(100))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    context: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    correlation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class TenantRole(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TenantApiKey(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "api_keys"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    company_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    allowed_ips: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class OutboundWebhook(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "outbound_webhooks"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    events: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    encrypted_secret: Mapped[str] = mapped_column(Text, nullable=False, default="")
    headers: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class WebhookDelivery(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (Index("ix_webhook_delivery_status", "status", "next_attempt_at"),)

    webhook_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("outbound_webhooks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    event_id: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[str | None] = mapped_column(Text)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class BankTransaction(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_transactions"
    __table_args__ = (
        UniqueConstraint("bank_account_id", "external_id", name="uq_bank_transaction_external"),
        Index("ix_bank_transaction_date", "bank_account_id", "transaction_date"),
    )

    bank_account_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_id: Mapped[str] = mapped_column(String(180), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    document_number: Mapped[str | None] = mapped_column(String(120), index=True)
    end_to_end_id: Mapped[str | None] = mapped_column(String(100), index=True)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reconciliation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="UNMATCHED", index=True)


class BankStatementImport(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_statement_imports"

    bank_account_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class Negotiation(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "negotiations"

    company_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    original_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    negotiated_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    installment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    first_due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT", index=True)
    terms: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    approved_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NegotiationReceivable(UUIDPrimaryKeyMixin, TenantBase):
    __tablename__ = "negotiation_receivables"
    __table_args__ = (UniqueConstraint("negotiation_id", "receivable_id", name="uq_negotiation_receivable"),)

    negotiation_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("negotiations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    receivable_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("receivables.id", ondelete="RESTRICT"), nullable=False, index=True
    )


class ImportJob(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "import_jobs"

    import_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExportJob(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "export_jobs"

    export_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    filters: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="XLSX")
    object_key: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(String(64))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    requested_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class PublicPaymentLink(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "public_payment_links"

    receivable_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("receivables.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_views: Mapped[int | None] = mapped_column(Integer)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CNABEvent(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "cnab_events"

    return_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("cnab_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    receivable_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    charge_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    occurrence_code: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    occurrence_description: Mapped[str] = mapped_column(String(255), nullable=False)
    our_number: Mapped[str | None] = mapped_column(String(64), index=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    occurrence_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PROCESSED")
    raw_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class PixAutomaticMandate(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    """Autorização recorrente de Pix Automático vinculada a um contrato/cliente."""

    __tablename__ = "pix_automatic_mandates"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_pix_automatic_provider_external"),
        Index("ix_pix_automatic_company_status", "company_id", "status"),
    )

    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    contract_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("contracts.id", ondelete="SET NULL"), index=True
    )
    bank_agreement_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_agreements.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(160), nullable=False)
    frequency: Mapped[str] = mapped_column(String(32), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    finish_date: Mapped[date | None] = mapped_column(Date)
    fixed_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    min_limit_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    description: Mapped[str] = mapped_column(String(120), nullable=False)
    payment_creation_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="MANUAL")
    retry_policy: Mapped[str] = mapped_column(String(64), nullable=False, default="NOT_ALLOWED")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED", index=True)
    authorization_url: Mapped[str | None] = mapped_column(Text)
    qr_copy_paste: Mapped[str | None] = mapped_column(Text)
    qr_encoded_image: Mapped[str | None] = mapped_column(Text)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class PixAutomaticInstruction(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    """Instrução periódica criada sob uma autorização de Pix Automático."""

    __tablename__ = "pix_automatic_instructions"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_pix_automatic_instruction_external"),
        Index("ix_pix_automatic_instruction_due", "mandate_id", "due_date"),
    )

    mandate_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("pix_automatic_mandates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    receivable_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("receivables.id", ondelete="SET NULL"), index=True
    )
    charge_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("charges.id", ondelete="SET NULL"), index=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(180), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED", index=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    last_error: Mapped[str | None] = mapped_column(Text)
