from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_DOWN
from uuid import UUID

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    accessible_company_ids,
    ensure_company_access,
    get_tenant_context_dep,
    get_tenant_db,
    get_tenant_entitlements,
    require_permission,
)
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.security import generate_api_key, hash_api_key
from app.core.tenant_context import TenantContext
from app.models.tenant import (
    BankAccount,
    BankAgreement,
    BankStatementImport,
    BankTransaction,
    Charge,
    CNABEvent,
    CNABRemittance,
    CNABReturn,
    Company,
    Contract,
    Customer,
    CustomerContact,
    ExportJob,
    Negotiation,
    NegotiationReceivable,
    OutboundWebhook,
    OutboxEvent,
    Payment,
    PublicPaymentLink,
    Receivable,
    ServiceCatalog,
    TenantApiKey,
    TenantRole,
    WebhookDelivery,
)
from app.providers.banking import banking_providers
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.schemas.tenant_management import (
    ApiKeyInput,
    BankAccountUpdate,
    BankAgreementUpdate,
    BankTransactionInput,
    ChargeActionInput,
    CompanyUpdate,
    ContractUpdate,
    CustomerContactCreate,
    CustomerContactUpdate,
    ExportRequest,
    NegotiationInput,
    OutboundWebhookInput,
    PaymentLinkInput,
    PaymentReverseInput,
    ReceivableActionInput,
    ReceivableUpdate,
    RoleInput,
    ServiceUpdate,
)
from app.services.audit import tenant_audit
from app.services.bank_statements import BankStatementService
from app.services.exports import ExportService
from app.services.entitlements import TenantEntitlements
from app.services.outbound_webhooks import OutboundWebhookService

router = APIRouter(prefix="/api/v1", tags=["Tenant - Gestão Completa"])


def _iso(value: datetime | date | None) -> str | None:
    return value.isoformat() if value else None


def _receivable_balance(item: Receivable) -> Decimal:
    return max(
        Decimal(item.original_amount)
        - Decimal(item.discount_amount)
        + Decimal(item.interest_amount)
        + Decimal(item.fine_amount)
        - Decimal(item.abatement_amount)
        - Decimal(item.paid_amount),
        Decimal("0"),
    )


def _role_dict(item: TenantRole) -> dict:
    return {
        "id": str(item.id),
        "code": item.code,
        "name": item.name,
        "description": item.description,
        "permissions": item.permissions,
        "is_system": item.is_system,
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _api_key_dict(item: TenantApiKey) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "key_prefix": item.key_prefix,
        "permissions": item.permissions,
        "company_ids": item.company_ids,
        "allowed_ips": item.allowed_ips,
        "expires_at": _iso(item.expires_at),
        "last_used_at": _iso(item.last_used_at),
        "revoked_at": _iso(item.revoked_at),
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
    }


def _webhook_dict(item: OutboundWebhook) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "url": item.url,
        "events": item.events,
        "headers": item.headers,
        "timeout_seconds": item.timeout_seconds,
        "max_attempts": item.max_attempts,
        "has_secret": bool(item.encrypted_secret),
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _transaction_dict(item: BankTransaction) -> dict:
    return {
        "id": str(item.id),
        "bank_account_id": str(item.bank_account_id),
        "external_id": item.external_id,
        "transaction_date": _iso(item.transaction_date),
        "posted_at": _iso(item.posted_at),
        "amount": str(item.amount),
        "transaction_type": item.transaction_type,
        "description": item.description,
        "document_number": item.document_number,
        "end_to_end_id": item.end_to_end_id,
        "reconciliation_status": item.reconciliation_status,
        "created_at": _iso(item.created_at),
    }


def _negotiation_dict(item: Negotiation) -> dict:
    return {
        "id": str(item.id),
        "company_id": str(item.company_id),
        "customer_id": str(item.customer_id),
        "code": item.code,
        "original_amount": str(item.original_amount),
        "negotiated_amount": str(item.negotiated_amount),
        "installment_count": item.installment_count,
        "first_due_date": _iso(item.first_due_date),
        "status": item.status,
        "terms": item.terms,
        "approved_by": str(item.approved_by) if item.approved_by else None,
        "approved_at": _iso(item.approved_at),
        "created_at": _iso(item.created_at),
    }


# ---------------------------------------------------------------------------
# CRUDs complementares das entidades centrais
# ---------------------------------------------------------------------------


@router.patch("/companies/{company_id}", response_model=SuccessResponse[dict])
async def update_company(
    company_id: UUID,
    payload: CompanyUpdate,
    user: AuthUser = Depends(require_permission("companies.update")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    ensure_company_access(user, company_id)
    item = await session.get(Company, company_id)
    if item is None:
        raise APIError("COMPANY_NOT_FOUND", "Empresa não encontrada.", 404)
    before = {"legal_name": item.legal_name, "trade_name": item.trade_name, "is_active": item.is_active}
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await tenant_audit(session, action="company.updated", entity_type="Company", entity_id=str(item.id), actor_id=user.id, company_id=str(item.id), before=before, after=payload.model_dump(exclude_unset=True, mode="json"))
    await session.commit()
    await session.refresh(item)
    return SuccessResponse(data={"id": str(item.id), "legal_name": item.legal_name, "trade_name": item.trade_name, "tax_id": item.tax_id, "is_active": item.is_active, "branding": item.branding, "settings": item.settings})


@router.get("/customers/{customer_id}/contacts", response_model=SuccessResponse[list[dict]])
async def list_customer_contacts(
    customer_id: UUID,
    _: AuthUser = Depends(require_permission("customers.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    if await session.get(Customer, customer_id) is None:
        raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)
    items = list((await session.scalars(select(CustomerContact).where(CustomerContact.customer_id == customer_id).order_by(CustomerContact.is_primary.desc(), CustomerContact.name))).all())
    return SuccessResponse(data=[{"id": str(item.id), "customer_id": str(item.customer_id), "name": item.name, "email": item.email, "phone": item.phone, "whatsapp": item.whatsapp, "role": item.role, "is_primary": item.is_primary, "receive_billing": item.receive_billing, "receive_invoice": item.receive_invoice, "receive_receipt": item.receive_receipt} for item in items])


@router.post("/customers/{customer_id}/contacts", response_model=SuccessResponse[dict], status_code=201)
async def create_customer_contact(
    customer_id: UUID,
    payload: CustomerContactCreate,
    user: AuthUser = Depends(require_permission("customers.update")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    if await session.get(Customer, customer_id) is None:
        raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)
    if payload.is_primary:
        for current in (await session.scalars(select(CustomerContact).where(CustomerContact.customer_id == customer_id, CustomerContact.is_primary.is_(True)))).all():
            current.is_primary = False
    item = CustomerContact(customer_id=customer_id, **payload.model_dump())
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="customer_contact.created", entity_type="CustomerContact", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(mode="json"))
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "name": item.name})


@router.patch("/customer-contacts/{contact_id}", response_model=SuccessResponse[dict])
async def update_customer_contact(
    contact_id: UUID,
    payload: CustomerContactUpdate,
    user: AuthUser = Depends(require_permission("customers.update")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(CustomerContact, contact_id)
    if item is None:
        raise APIError("CUSTOMER_CONTACT_NOT_FOUND", "Contato não encontrado.", 404)
    values = payload.model_dump(exclude_unset=True)
    if values.get("is_primary"):
        for current in (await session.scalars(select(CustomerContact).where(CustomerContact.customer_id == item.customer_id, CustomerContact.id != item.id, CustomerContact.is_primary.is_(True)))).all():
            current.is_primary = False
    for key, value in values.items():
        setattr(item, key, value)
    await tenant_audit(session, action="customer_contact.updated", entity_type="CustomerContact", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(exclude_unset=True, mode="json"))
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "name": item.name, "is_primary": item.is_primary})


@router.delete("/customer-contacts/{contact_id}", response_model=SuccessResponse[dict])
async def delete_customer_contact(
    contact_id: UUID,
    user: AuthUser = Depends(require_permission("customers.update")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(CustomerContact, contact_id)
    if item is None:
        raise APIError("CUSTOMER_CONTACT_NOT_FOUND", "Contato não encontrado.", 404)
    await tenant_audit(session, action="customer_contact.deleted", entity_type="CustomerContact", entity_id=str(item.id), actor_id=user.id)
    await session.delete(item)
    await session.commit()
    return SuccessResponse(data={"deleted": True})


@router.patch("/services/{service_id}", response_model=SuccessResponse[dict])
async def update_service(
    service_id: UUID,
    payload: ServiceUpdate,
    user: AuthUser = Depends(require_permission("services.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(ServiceCatalog, service_id)
    if item is None:
        raise APIError("SERVICE_NOT_FOUND", "Serviço não encontrado.", 404)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await tenant_audit(session, action="service.updated", entity_type="Service", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(exclude_unset=True, mode="json"))
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "code": item.code, "name": item.name, "default_amount": str(item.default_amount), "is_active": item.is_active})


@router.patch("/contracts/{contract_id}", response_model=SuccessResponse[dict])
async def update_contract(
    contract_id: UUID,
    payload: ContractUpdate,
    user: AuthUser = Depends(require_permission("contracts.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(Contract, contract_id)
    if item is None:
        raise APIError("CONTRACT_NOT_FOUND", "Contrato não encontrado.", 404)
    ensure_company_access(user, item.company_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await tenant_audit(session, action="contract.updated", entity_type="Contract", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after=payload.model_dump(exclude_unset=True, mode="json"))
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "code": item.code, "amount": str(item.amount), "status": item.status, "next_generation_date": _iso(item.next_generation_date)})


@router.patch("/receivables/{receivable_id}", response_model=SuccessResponse[dict])
async def update_receivable(
    receivable_id: UUID,
    payload: ReceivableUpdate,
    user: AuthUser = Depends(require_permission("receivables.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(Receivable).where(Receivable.id == receivable_id).with_for_update())
    if item is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    if item.status in {"PAID", "CANCELLED", "REVERSED"}:
        raise APIError("RECEIVABLE_LOCKED", "O recebível não pode mais ser alterado.", 409)
    values = payload.model_dump(exclude_unset=True)
    if "metadata" in values:
        values["metadata_json"] = values.pop("metadata")
    for key, value in values.items():
        setattr(item, key, value)
    item.balance = _receivable_balance(item)
    await tenant_audit(session, action="receivable.updated", entity_type="Receivable", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after=payload.model_dump(exclude_unset=True, mode="json"))
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "status": item.status, "balance": str(item.balance), "due_date": _iso(item.due_date)})


@router.post("/receivables/{receivable_id}/actions", response_model=SuccessResponse[dict])
async def receivable_action(
    receivable_id: UUID,
    payload: ReceivableActionInput,
    user: AuthUser = Depends(require_permission("receivables.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(Receivable).where(Receivable.id == receivable_id).with_for_update())
    if item is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    transitions = {"CANCEL": "CANCELLED", "WRITE_OFF": "WRITTEN_OFF", "REOPEN": "OPEN", "MARK_OVERDUE": "OVERDUE"}
    if payload.action == "REOPEN" and item.paid_amount > 0:
        item.status = "PARTIALLY_PAID"
    else:
        item.status = transitions[payload.action]
    metadata = dict(item.metadata_json or {})
    metadata["last_action"] = {"action": payload.action, "reason": payload.reason, "at": datetime.now(UTC).isoformat(), "by": user.id}
    item.metadata_json = metadata
    await tenant_audit(session, action=f"receivable.{payload.action.lower()}", entity_type="Receivable", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after={"status": item.status, "reason": payload.reason})
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "status": item.status})


@router.post("/charges/{charge_id}/actions", response_model=SuccessResponse[dict])
async def charge_action(
    charge_id: UUID,
    payload: ChargeActionInput,
    user: AuthUser = Depends(require_permission("charges.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(Charge, charge_id)
    if item is None:
        raise APIError("CHARGE_NOT_FOUND", "Cobrança não encontrada.", 404)
    receivable = await session.get(Receivable, item.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    provider = banking_providers.get(item.provider)
    agreement_data: dict = {}
    if item.bank_agreement_id:
        agreement = await session.get(BankAgreement, item.bank_agreement_id)
        if agreement:
            credentials = json.loads(secret_cipher.decrypt(agreement.encrypted_credentials)) if agreement.encrypted_credentials else {}
            agreement_data = {
                "id": str(agreement.id),
                "number": agreement.agreement_number,
                "wallet": agreement.wallet,
                "beneficiary_code": agreement.beneficiary_code,
                "environment": agreement.environment,
                "settings": agreement.settings,
                "credentials": credentials,
            }
    if payload.action == "CANCEL":
        await provider.cancel_charge(item.external_id, agreement_data)
        item.status = "CANCELLED"
        if receivable.status == "REGISTERED":
            receivable.status = "OPEN"
    elif payload.action == "REFRESH":
        result = await provider.get_charge(item.external_id, agreement_data)
        item.status = result.status
        item.our_number = result.our_number or item.our_number
        item.txid = result.txid or item.txid
        item.digitable_line = result.digitable_line or item.digitable_line
        item.pix_copy_paste = result.pix_copy_paste or item.pix_copy_paste
        item.raw_response = {**(item.raw_response or {}), **result.raw}
    else:
        session.add(OutboxEvent(aggregate_type="Charge", aggregate_id=str(item.id), event_type="financial.charge.resend_requested", payload={"charge_id": str(item.id), "receivable_id": str(item.receivable_id), "company_id": str(receivable.company_id)}))
    await tenant_audit(session, action=f"charge.{payload.action.lower()}", entity_type="Charge", entity_id=str(item.id), actor_id=user.id, company_id=str(receivable.company_id), after={"status": item.status, "reason": payload.reason})
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "status": item.status})


@router.post("/payments/{payment_id}/reverse", response_model=SuccessResponse[dict])
async def reverse_payment(
    payment_id: UUID,
    payload: PaymentReverseInput,
    user: AuthUser = Depends(require_permission("payments.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    payment = await session.scalar(select(Payment).where(Payment.id == payment_id).with_for_update())
    if payment is None:
        raise APIError("PAYMENT_NOT_FOUND", "Pagamento não encontrado.", 404)
    if payment.status == "REVERSED":
        return SuccessResponse(data={"id": str(payment.id), "status": payment.status})
    receivable = await session.scalar(select(Receivable).where(Receivable.id == payment.receivable_id).with_for_update())
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    payment.status = "REVERSED"
    payment.reversed_at = datetime.now(UTC)
    payment.raw_payload = {**(payment.raw_payload or {}), "reversal": {"reason": payload.reason, "by": user.id, "at": payment.reversed_at.isoformat()}}
    receivable.paid_amount = max(Decimal(receivable.paid_amount) - Decimal(payment.amount), Decimal("0"))
    receivable.balance = _receivable_balance(receivable)
    receivable.status = "OPEN" if receivable.paid_amount == 0 else "PARTIALLY_PAID"
    session.add(OutboxEvent(aggregate_type="Payment", aggregate_id=str(payment.id), event_type="financial.payment.reversed", payload={"payment_id": str(payment.id), "receivable_id": str(receivable.id), "company_id": str(receivable.company_id), "reason": payload.reason}))
    await tenant_audit(session, action="payment.reversed", entity_type="Payment", entity_id=str(payment.id), actor_id=user.id, company_id=str(receivable.company_id), after={"reason": payload.reason, "receivable_status": receivable.status})
    await session.commit()
    return SuccessResponse(data={"id": str(payment.id), "status": payment.status, "receivable_balance": str(receivable.balance)})


@router.patch("/bank-accounts/{account_id}", response_model=SuccessResponse[dict])
async def update_bank_account(
    account_id: UUID,
    payload: BankAccountUpdate,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(BankAccount, account_id)
    if item is None:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    values = payload.model_dump(exclude_unset=True)
    if values.get("is_default"):
        for current in (await session.scalars(select(BankAccount).where(BankAccount.company_id == item.company_id, BankAccount.id != item.id, BankAccount.is_default.is_(True)))).all():
            current.is_default = False
    for key, value in values.items():
        setattr(item, key, value)
    await tenant_audit(session, action="bank_account.updated", entity_type="BankAccount", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after={key: ("***" if "account" in key or "pix_key" in key else value) for key, value in values.items()})
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "bank_name": item.bank_name, "is_default": item.is_default, "is_active": item.is_active})


@router.patch("/bank-agreements/{agreement_id}", response_model=SuccessResponse[dict])
async def update_bank_agreement(
    agreement_id: UUID,
    payload: BankAgreementUpdate,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(BankAgreement, agreement_id)
    if item is None:
        raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado.", 404)
    ensure_company_access(user, item.company_id)
    values = payload.model_dump(exclude_unset=True)
    credentials = values.pop("credentials", None)
    for key, value in values.items():
        setattr(item, key, value.upper() if key in {"provider", "environment"} and isinstance(value, str) else value)
    if credentials is not None:
        item.encrypted_credentials = secret_cipher.encrypt(json.dumps(credentials, ensure_ascii=False))
    await tenant_audit(session, action="bank_agreement.updated", entity_type="BankAgreement", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after={**values, "credentials_updated": credentials is not None})
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "name": item.name, "provider": item.provider, "environment": item.environment, "is_active": item.is_active})


# ---------------------------------------------------------------------------
# Papéis, API keys e webhooks externos
# ---------------------------------------------------------------------------


@router.get("/roles", response_model=SuccessResponse[list[dict]])
async def list_roles(
    _: AuthUser = Depends(require_permission("users.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(TenantRole).order_by(TenantRole.is_system.desc(), TenantRole.name))).all())
    return SuccessResponse(data=[_role_dict(item) for item in items])


@router.post("/roles", response_model=SuccessResponse[dict], status_code=201)
async def create_role(
    payload: RoleInput,
    user: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    if await session.scalar(select(TenantRole.id).where(TenantRole.code == payload.code)):
        raise APIError("ROLE_EXISTS", "Já existe um perfil com este código.", 409)
    item = TenantRole(**payload.model_dump(), is_system=False)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="role.created", entity_type="TenantRole", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(mode="json"))
    await session.commit()
    return SuccessResponse(data=_role_dict(item))


@router.patch("/roles/{role_id}", response_model=SuccessResponse[dict])
async def update_role(
    role_id: UUID,
    payload: RoleInput,
    user: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(TenantRole, role_id)
    if item is None:
        raise APIError("ROLE_NOT_FOUND", "Perfil não encontrado.", 404)
    if item.is_system and payload.code != item.code:
        raise APIError("SYSTEM_ROLE_CODE_LOCKED", "O código de um perfil de sistema não pode ser alterado.", 409)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await tenant_audit(session, action="role.updated", entity_type="TenantRole", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(mode="json"))
    await session.commit()
    return SuccessResponse(data=_role_dict(item))


@router.delete("/roles/{role_id}", response_model=SuccessResponse[dict])
async def delete_role(
    role_id: UUID,
    user: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(TenantRole, role_id)
    if item is None:
        raise APIError("ROLE_NOT_FOUND", "Perfil não encontrado.", 404)
    if item.is_system:
        item.is_active = False
    else:
        await session.delete(item)
    await tenant_audit(session, action="role.deleted", entity_type="TenantRole", entity_id=str(role_id), actor_id=user.id)
    await session.commit()
    return SuccessResponse(data={"deleted": not item.is_system, "deactivated": item.is_system})


@router.get("/api-keys", response_model=SuccessResponse[list[dict]])
async def list_api_keys(
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(TenantApiKey).order_by(TenantApiKey.created_at.desc()))).all())
    return SuccessResponse(data=[_api_key_dict(item) for item in items])


@router.post("/api-keys", response_model=SuccessResponse[dict], status_code=201)
async def create_api_key(
    payload: ApiKeyInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    raw, digest = generate_api_key()
    item = TenantApiKey(name=payload.name, key_prefix=raw[:12], key_hash=digest, permissions=payload.permissions, company_ids=[str(value) for value in payload.company_ids], allowed_ips=payload.allowed_ips, expires_at=payload.expires_at, is_active=True)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="api_key.created", entity_type="TenantApiKey", entity_id=str(item.id), actor_id=user.id, after={"name": item.name, "key_prefix": item.key_prefix, "permissions": item.permissions})
    await session.commit()
    return SuccessResponse(data={**_api_key_dict(item), "api_key": raw, "warning": "A chave completa é exibida somente nesta resposta."})


@router.delete("/api-keys/{key_id}", response_model=SuccessResponse[dict])
async def revoke_api_key(
    key_id: UUID,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(TenantApiKey, key_id)
    if item is None:
        raise APIError("API_KEY_NOT_FOUND", "Chave não encontrada.", 404)
    item.is_active = False
    item.revoked_at = datetime.now(UTC)
    await tenant_audit(session, action="api_key.revoked", entity_type="TenantApiKey", entity_id=str(item.id), actor_id=user.id)
    await session.commit()
    return SuccessResponse(data={"revoked": True})


@router.get("/outbound-webhooks", response_model=SuccessResponse[list[dict]])
async def list_outbound_webhooks(
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(OutboundWebhook).order_by(OutboundWebhook.name))).all())
    return SuccessResponse(data=[_webhook_dict(item) for item in items])


@router.post("/outbound-webhooks", response_model=SuccessResponse[dict], status_code=201)
async def create_outbound_webhook(
    payload: OutboundWebhookInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    entitlements.require_feature("webhooks")
    item = OutboundWebhook(name=payload.name, url=str(payload.url), events=payload.events, encrypted_secret=secret_cipher.encrypt(payload.secret.get_secret_value() if payload.secret else secrets.token_urlsafe(32)), headers=payload.headers, timeout_seconds=payload.timeout_seconds, max_attempts=payload.max_attempts, is_active=payload.is_active)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="outbound_webhook.created", entity_type="OutboundWebhook", entity_id=str(item.id), actor_id=user.id, after={"name": item.name, "url": item.url, "events": item.events})
    await session.commit()
    return SuccessResponse(data=_webhook_dict(item))


@router.patch("/outbound-webhooks/{webhook_id}", response_model=SuccessResponse[dict])
async def update_outbound_webhook(
    webhook_id: UUID,
    payload: OutboundWebhookInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(OutboundWebhook, webhook_id)
    if item is None:
        raise APIError("WEBHOOK_NOT_FOUND", "Webhook não encontrado.", 404)
    item.name = payload.name
    item.url = str(payload.url)
    item.events = payload.events
    item.headers = payload.headers
    item.timeout_seconds = payload.timeout_seconds
    item.max_attempts = payload.max_attempts
    item.is_active = payload.is_active
    if payload.secret:
        item.encrypted_secret = secret_cipher.encrypt(payload.secret.get_secret_value())
    await tenant_audit(session, action="outbound_webhook.updated", entity_type="OutboundWebhook", entity_id=str(item.id), actor_id=user.id, after={"name": item.name, "url": item.url, "events": item.events})
    await session.commit()
    return SuccessResponse(data=_webhook_dict(item))


@router.delete("/outbound-webhooks/{webhook_id}", response_model=SuccessResponse[dict])
async def delete_outbound_webhook(
    webhook_id: UUID,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(OutboundWebhook, webhook_id)
    if item is None:
        raise APIError("WEBHOOK_NOT_FOUND", "Webhook não encontrado.", 404)
    item.is_active = False
    await tenant_audit(session, action="outbound_webhook.disabled", entity_type="OutboundWebhook", entity_id=str(item.id), actor_id=user.id)
    await session.commit()
    return SuccessResponse(data={"disabled": True})


@router.get("/outbound-webhooks/{webhook_id}/deliveries", response_model=SuccessResponse[list[dict]])
async def list_webhook_deliveries(
    webhook_id: UUID,
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(WebhookDelivery).where(WebhookDelivery.webhook_id == webhook_id).order_by(WebhookDelivery.created_at.desc()).limit(500))).all())
    return SuccessResponse(data=[{"id": str(item.id), "event_type": item.event_type, "event_id": item.event_id, "status": item.status, "attempts": item.attempts, "response_status": item.response_status, "next_attempt_at": _iso(item.next_attempt_at), "delivered_at": _iso(item.delivered_at), "last_error": item.last_error, "created_at": _iso(item.created_at)} for item in items])


@router.post("/outbound-webhooks/{webhook_id}/test", response_model=SuccessResponse[dict], status_code=202)
async def test_outbound_webhook(
    webhook_id: UUID,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    webhook = await session.get(OutboundWebhook, webhook_id)
    if webhook is None:
        raise APIError("WEBHOOK_NOT_FOUND", "Webhook não encontrado.", 404)
    delivery = WebhookDelivery(webhook_id=webhook.id, event_type="platform.webhook.test", event_id=secrets.token_hex(16), payload={"message": "Teste de webhook", "requested_by": user.id, "timestamp": datetime.now(UTC).isoformat()}, status="PENDING", next_attempt_at=datetime.now(UTC))
    session.add(delivery)
    await session.commit()
    delivered = await OutboundWebhookService(session).dispatch_pending(limit=1)
    await session.refresh(delivery)
    return SuccessResponse(data={"delivery_id": str(delivery.id), "status": delivery.status, "delivered": bool(delivered), "response_status": delivery.response_status, "last_error": delivery.last_error})


# ---------------------------------------------------------------------------
# Extratos, transações e conciliação
# ---------------------------------------------------------------------------


@router.get("/bank-transactions", response_model=PaginatedResponse[dict])
async def list_bank_transactions(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    bank_account_id: UUID | None = None,
    reconciliation_status: str | None = None,
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> PaginatedResponse[dict]:
    filters = []
    if bank_account_id:
        account = await session.get(BankAccount, bank_account_id)
        if account is None:
            raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
        ensure_company_access(user, account.company_id)
        filters.append(BankTransaction.bank_account_id == bank_account_id)
    if reconciliation_status:
        filters.append(BankTransaction.reconciliation_status == reconciliation_status.upper())
    if bank_account_id is None and accessible_company_ids(user) is not None:
        allowed = select(BankAccount.id).where(BankAccount.company_id.in_(accessible_company_ids(user)))
        filters.append(BankTransaction.bank_account_id.in_(allowed))
    total = await session.scalar(select(func.count()).select_from(BankTransaction).where(*filters)) or 0
    items = list((await session.scalars(select(BankTransaction).where(*filters).order_by(BankTransaction.transaction_date.desc(), BankTransaction.created_at.desc()).offset((page - 1) * per_page).limit(per_page))).all())
    return PaginatedResponse(data=[_transaction_dict(item) for item in items], meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total + per_page - 1) // per_page))


@router.post("/bank-transactions", response_model=SuccessResponse[dict], status_code=201)
async def create_bank_transaction(
    payload: BankTransactionInput,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    account = await session.get(BankAccount, payload.bank_account_id)
    if account is None:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
    ensure_company_access(user, account.company_id)
    existing = await session.scalar(select(BankTransaction).where(BankTransaction.bank_account_id == payload.bank_account_id, BankTransaction.external_id == payload.external_id))
    if existing:
        return SuccessResponse(data=_transaction_dict(existing))
    item = BankTransaction(**payload.model_dump(), transaction_type=payload.transaction_type.upper(), reconciliation_status="UNMATCHED")
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="bank_transaction.created", entity_type="BankTransaction", entity_id=str(item.id), actor_id=user.id, company_id=str(account.company_id), after={"amount": str(item.amount), "transaction_date": item.transaction_date.isoformat()})
    await session.commit()
    return SuccessResponse(data=_transaction_dict(item))


@router.post("/bank-statements/import", response_model=SuccessResponse[dict], status_code=201)
async def import_bank_statement(
    bank_account_id: UUID,
    file: UploadFile = File(...),
    format_name: str | None = Query(default=None, alias="format"),
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    account = await session.get(BankAccount, bank_account_id)
    if account is None:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
    ensure_company_access(user, account.company_id)
    content = await file.read()
    item = await BankStatementService(session, bucket=context.storage_bucket).import_file(bank_account_id=bank_account_id, filename=file.filename or "extrato", content=content, format_name=format_name)
    await tenant_audit(session, action="bank_statement.imported", entity_type="BankStatementImport", entity_id=str(item.id), actor_id=user.id, company_id=str(account.company_id), after=item.summary)
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "filename": item.filename, "format": item.format, "status": item.status, "summary": item.summary, "sha256": item.sha256})


@router.get("/bank-statements", response_model=SuccessResponse[list[dict]])
async def list_bank_statement_imports(
    bank_account_id: UUID | None = None,
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankStatementImport)
    if bank_account_id:
        account = await session.get(BankAccount, bank_account_id)
        if account is None:
            raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
        ensure_company_access(user, account.company_id)
        stmt = stmt.where(BankStatementImport.bank_account_id == bank_account_id)
    items = list((await session.scalars(stmt.order_by(BankStatementImport.created_at.desc()).limit(500))).all())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "bank_account_id": str(item.bank_account_id),
                "filename": item.filename,
                "format": item.format,
                "sha256": item.sha256,
                "status": item.status,
                "imported_count": item.imported_count,
                "duplicate_count": item.duplicate_count,
                "error_count": item.error_count,
                "summary": item.summary,
                "processed_at": _iso(item.processed_at),
                "created_at": _iso(item.created_at),
            }
            for item in items
        ]
    )


# ---------------------------------------------------------------------------
# Negociações e links públicos
# ---------------------------------------------------------------------------


@router.get("/negotiations", response_model=SuccessResponse[list[dict]])
async def list_negotiations(
    company_id: UUID | None = None,
    status: str | None = None,
    user: AuthUser = Depends(require_permission("receivables.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(Negotiation)
    if company_id:
        ensure_company_access(user, company_id)
        stmt = stmt.where(Negotiation.company_id == company_id)
    elif accessible_company_ids(user) is not None:
        stmt = stmt.where(Negotiation.company_id.in_(accessible_company_ids(user)))
    if status:
        stmt = stmt.where(Negotiation.status == status.upper())
    items = list((await session.scalars(stmt.order_by(Negotiation.created_at.desc()).limit(1000))).all())
    return SuccessResponse(data=[_negotiation_dict(item) for item in items])


@router.post("/negotiations", response_model=SuccessResponse[dict], status_code=201)
async def create_negotiation(
    payload: NegotiationInput,
    user: AuthUser = Depends(require_permission("receivables.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    ensure_company_access(user, payload.company_id)
    if await session.get(Customer, payload.customer_id) is None:
        raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)
    receivables = list((await session.scalars(select(Receivable).where(Receivable.id.in_(payload.receivable_ids)).with_for_update())).all())
    if len(receivables) != len(set(payload.receivable_ids)):
        raise APIError("NEGOTIATION_RECEIVABLE_NOT_FOUND", "Um ou mais recebíveis não foram encontrados.", 404)
    invalid = [str(item.id) for item in receivables if item.company_id != payload.company_id or item.customer_id != payload.customer_id or item.status not in {"OPEN", "REGISTERED", "OVERDUE", "PARTIALLY_PAID"}]
    if invalid:
        raise APIError("NEGOTIATION_RECEIVABLE_INVALID", "Há recebíveis incompatíveis com a negociação.", 422, {"ids": invalid})
    original = sum((Decimal(item.balance) for item in receivables), Decimal("0"))
    item = Negotiation(company_id=payload.company_id, customer_id=payload.customer_id, code=f"NEG-{datetime.now(UTC).strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}", original_amount=original, negotiated_amount=payload.negotiated_amount, installment_count=payload.installment_count, first_due_date=payload.first_due_date, status="DRAFT", terms=payload.terms)
    session.add(item)
    await session.flush()
    for receivable in receivables:
        session.add(NegotiationReceivable(negotiation_id=item.id, receivable_id=receivable.id))
    await tenant_audit(session, action="negotiation.created", entity_type="Negotiation", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after={"original_amount": str(original), "negotiated_amount": str(item.negotiated_amount), "installments": item.installment_count})
    await session.commit()
    return SuccessResponse(data=_negotiation_dict(item))


@router.post("/negotiations/{negotiation_id}/approve", response_model=SuccessResponse[dict])
async def approve_negotiation(
    negotiation_id: UUID,
    user: AuthUser = Depends(require_permission("receivables.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(Negotiation).where(Negotiation.id == negotiation_id).with_for_update())
    if item is None:
        raise APIError("NEGOTIATION_NOT_FOUND", "Negociação não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    if item.status != "DRAFT":
        raise APIError("NEGOTIATION_NOT_DRAFT", "Somente negociações em rascunho podem ser aprovadas.", 409)
    links = list((await session.scalars(select(NegotiationReceivable).where(NegotiationReceivable.negotiation_id == item.id))).all())
    source_receivables = list((await session.scalars(select(Receivable).where(Receivable.id.in_([link.receivable_id for link in links])).with_for_update())).all())
    for source in source_receivables:
        source.status = "NEGOTIATED"
        metadata = dict(source.metadata_json or {})
        metadata["negotiation_id"] = str(item.id)
        source.metadata_json = metadata
    total = Decimal(item.negotiated_amount)
    installments = item.installment_count
    base = (total / installments).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder = total - base * installments
    generated: list[str] = []
    for index in range(installments):
        amount = base + (remainder if index == installments - 1 else Decimal("0"))
        due_date = item.first_due_date + relativedelta(months=index)
        receivable = Receivable(company_id=item.company_id, customer_id=item.customer_id, contract_id=None, document_number=f"{item.code}-{index + 1:03d}", competence=due_date.strftime("%Y-%m"), description=f"Parcela {index + 1}/{installments} da negociação {item.code}", issue_date=datetime.now(UTC).date(), due_date=due_date, original_amount=amount, discount_amount=Decimal("0"), interest_amount=Decimal("0"), fine_amount=Decimal("0"), abatement_amount=Decimal("0"), paid_amount=Decimal("0"), balance=amount, status="OPEN", source="NEGOTIATION", metadata_json={"negotiation_id": str(item.id), "installment": index + 1, "installments": installments})
        session.add(receivable)
        await session.flush()
        generated.append(str(receivable.id))
        session.add(OutboxEvent(aggregate_type="Receivable", aggregate_id=str(receivable.id), event_type="financial.receivable.created", payload={"receivable_id": str(receivable.id), "company_id": str(item.company_id), "source": "NEGOTIATION"}))
    item.status = "ACTIVE"
    item.approved_by = UUID(user.id)
    item.approved_at = datetime.now(UTC)
    item.terms = {**(item.terms or {}), "generated_receivable_ids": generated}
    await tenant_audit(session, action="negotiation.approved", entity_type="Negotiation", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after={"generated_receivable_ids": generated})
    await session.commit()
    return SuccessResponse(data={**_negotiation_dict(item), "generated_receivable_ids": generated})


@router.post("/negotiations/{negotiation_id}/cancel", response_model=SuccessResponse[dict])
async def cancel_negotiation(
    negotiation_id: UUID,
    reason: str = Query(min_length=3, max_length=1000),
    user: AuthUser = Depends(require_permission("receivables.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(Negotiation).where(Negotiation.id == negotiation_id).with_for_update())
    if item is None:
        raise APIError("NEGOTIATION_NOT_FOUND", "Negociação não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    if item.status == "CANCELLED":
        return SuccessResponse(data=_negotiation_dict(item))
    item.status = "CANCELLED"
    item.terms = {**(item.terms or {}), "cancellation": {"reason": reason, "by": user.id, "at": datetime.now(UTC).isoformat()}}
    await tenant_audit(session, action="negotiation.cancelled", entity_type="Negotiation", entity_id=str(item.id), actor_id=user.id, company_id=str(item.company_id), after={"reason": reason})
    await session.commit()
    return SuccessResponse(data=_negotiation_dict(item))


@router.get("/payment-links", response_model=SuccessResponse[list[dict]])
async def list_payment_links(
    receivable_id: UUID | None = None,
    user: AuthUser = Depends(require_permission("charges.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(PublicPaymentLink).join(Receivable, PublicPaymentLink.receivable_id == Receivable.id)
    if receivable_id:
        stmt = stmt.where(PublicPaymentLink.receivable_id == receivable_id)
    if accessible_company_ids(user) is not None:
        stmt = stmt.where(Receivable.company_id.in_(accessible_company_ids(user)))
    items = list((await session.scalars(stmt.order_by(PublicPaymentLink.created_at.desc()).limit(1000))).all())
    return SuccessResponse(data=[{"id": str(item.id), "receivable_id": str(item.receivable_id), "token_prefix": item.token_prefix, "expires_at": _iso(item.expires_at), "max_views": item.max_views, "view_count": item.view_count, "last_viewed_at": _iso(item.last_viewed_at), "is_active": item.is_active, "created_at": _iso(item.created_at)} for item in items])


@router.post("/payment-links", response_model=SuccessResponse[dict], status_code=201)
async def create_payment_link(
    payload: PaymentLinkInput,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("charges.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    receivable = await session.get(Receivable, payload.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
    ensure_company_access(user, receivable.company_id)
    raw = secrets.token_urlsafe(36)
    item = PublicPaymentLink(receivable_id=receivable.id, token_hash=hash_api_key(raw), token_prefix=raw[:12], expires_at=payload.expires_at, max_views=payload.max_views, view_count=0, is_active=True)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="payment_link.created", entity_type="PublicPaymentLink", entity_id=str(item.id), actor_id=user.id, company_id=str(receivable.company_id), after={"receivable_id": str(receivable.id), "expires_at": _iso(item.expires_at)})
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "receivable_id": str(item.receivable_id), "url": f"https://{context.hostname}/p/{raw}", "token": raw, "expires_at": _iso(item.expires_at), "warning": "O token completo é exibido somente nesta resposta."})


@router.delete("/payment-links/{link_id}", response_model=SuccessResponse[dict])
async def deactivate_payment_link(
    link_id: UUID,
    user: AuthUser = Depends(require_permission("charges.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(PublicPaymentLink, link_id)
    if item is None:
        raise APIError("PAYMENT_LINK_NOT_FOUND", "Link não encontrado.", 404)
    receivable = await session.get(Receivable, item.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    item.is_active = False
    await tenant_audit(session, action="payment_link.deactivated", entity_type="PublicPaymentLink", entity_id=str(item.id), actor_id=user.id, company_id=str(receivable.company_id))
    await session.commit()
    return SuccessResponse(data={"deactivated": True})


# ---------------------------------------------------------------------------
# Exportações e visão operacional CNAB
# ---------------------------------------------------------------------------


@router.get("/exports", response_model=SuccessResponse[list[dict]])
async def list_exports(
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("reports.view")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(ExportJob).order_by(ExportJob.created_at.desc()).limit(500))).all())
    service = ExportService(session, bucket=context.storage_bucket)
    output = []
    for item in items:
        output.append({"id": str(item.id), "export_type": item.export_type, "status": item.status, "format": item.format, "filters": item.filters, "size_bytes": item.size_bytes, "sha256": item.sha256, "created_at": _iso(item.created_at), "finished_at": _iso(item.finished_at), "last_error": item.last_error, "download_url": await service.signed_url(item) if item.status == "COMPLETED" else None})
    return SuccessResponse(data=output)


@router.post("/exports", response_model=SuccessResponse[dict], status_code=201)
async def create_export(
    payload: ExportRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("reports.view")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await ExportService(session, bucket=context.storage_bucket).create(export_type=payload.export_type, format_name=payload.format, filters=payload.filters, requested_by=UUID(user.id))
    await tenant_audit(session, action="export.created", entity_type="ExportJob", entity_id=str(item.id), actor_id=user.id, after={"type": item.export_type, "format": item.format})
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "status": item.status, "sha256": item.sha256, "size_bytes": item.size_bytes, "download_url": await ExportService(session, bucket=context.storage_bucket).signed_url(item)})


@router.get("/cnab/remittances", response_model=SuccessResponse[list[dict]])
async def list_cnab_remittances(
    company_id: UUID | None = None,
    user: AuthUser = Depends(require_permission("cnab.generate")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(CNABRemittance)
    if company_id:
        ensure_company_access(user, company_id)
        stmt = stmt.where(CNABRemittance.company_id == company_id)
    elif accessible_company_ids(user) is not None:
        stmt = stmt.where(CNABRemittance.company_id.in_(accessible_company_ids(user)))
    items = list((await session.scalars(stmt.order_by(CNABRemittance.generated_at.desc()).limit(1000))).all())
    return SuccessResponse(data=[{"id": str(item.id), "company_id": str(item.company_id), "bank_agreement_id": str(item.bank_agreement_id), "sequence": item.sequence, "layout": item.layout, "status": item.status, "sha256": item.sha256, "record_count": item.record_count, "total_amount": str(item.total_amount), "generated_at": _iso(item.generated_at)} for item in items])


@router.get("/cnab/returns", response_model=SuccessResponse[list[dict]])
async def list_cnab_returns(
    company_id: UUID | None = None,
    user: AuthUser = Depends(require_permission("cnab.import")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(CNABReturn)
    if company_id:
        ensure_company_access(user, company_id)
        stmt = stmt.where(CNABReturn.company_id == company_id)
    elif accessible_company_ids(user) is not None:
        stmt = stmt.where(CNABReturn.company_id.in_(accessible_company_ids(user)))
    items = list((await session.scalars(stmt.order_by(CNABReturn.created_at.desc()).limit(1000))).all())
    return SuccessResponse(data=[{"id": str(item.id), "company_id": str(item.company_id), "bank_code": item.bank_code, "layout": item.layout, "filename": item.filename, "sha256": item.sha256, "status": item.status, "event_count": item.event_count, "summary": item.raw_summary, "processed_at": _iso(item.processed_at), "last_error": item.last_error, "created_at": _iso(item.created_at)} for item in items])


@router.get("/cnab/events", response_model=SuccessResponse[list[dict]])
async def list_cnab_events(
    return_id: UUID | None = None,
    occurrence_code: str | None = None,
    _: AuthUser = Depends(require_permission("cnab.import")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(CNABEvent)
    if return_id:
        stmt = stmt.where(CNABEvent.return_id == return_id)
    if occurrence_code:
        stmt = stmt.where(CNABEvent.occurrence_code == occurrence_code)
    items = list((await session.scalars(stmt.order_by(CNABEvent.created_at.desc()).limit(2000))).all())
    return SuccessResponse(data=[{"id": str(item.id), "return_id": str(item.return_id), "receivable_id": str(item.receivable_id) if item.receivable_id else None, "charge_id": str(item.charge_id) if item.charge_id else None, "occurrence_code": item.occurrence_code, "occurrence_description": item.occurrence_description, "our_number": item.our_number, "amount": str(item.amount) if item.amount is not None else None, "occurrence_date": _iso(item.occurrence_date), "status": item.status, "raw_data": item.raw_data, "created_at": _iso(item.created_at)} for item in items])
