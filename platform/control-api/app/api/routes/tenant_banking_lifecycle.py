from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import accessible_company_ids, ensure_company_access, get_tenant_db, require_permission
from app.core.errors import APIError
from app.models.banking import BankConnection
from app.models.tenant import BankAccount, BankAgreement
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit
from app.services.banking_lifecycle import (
    bank_account_lifecycle,
    bank_agreement_lifecycle,
    bank_connection_lifecycle,
)

router = APIRouter(prefix="/api/v1/banking/lifecycle", tags=["Tenant - Ciclo de vida bancário"])


def _block_message(lifecycle: dict) -> str:
    blockers = lifecycle.get("blockers") or []
    return " ".join(str(item.get("message") or "") for item in blockers if item.get("message"))


@router.get("/accounts", response_model=SuccessResponse[list[dict]])
async def list_bank_accounts_with_lifecycle(
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankAccount).order_by(BankAccount.bank_name, BankAccount.created_at)
    allowed = accessible_company_ids(user)
    if allowed is not None:
        stmt = stmt.where(BankAccount.company_id.in_(allowed))
    items = list((await session.scalars(stmt)).all())
    data: list[dict] = []
    for item in items:
        lifecycle = await bank_account_lifecycle(session, item.id)
        data.append(
            {
                "id": str(item.id),
                "company_id": str(item.company_id),
                "bank_code": item.bank_code,
                "bank_name": item.bank_name,
                "branch": item.branch,
                "branch_digit": item.branch_digit,
                "account": item.account,
                "account_digit": item.account_digit,
                "account_type": item.account_type,
                "pix_key_type": item.pix_key_type,
                "pix_key": item.pix_key,
                "is_default": item.is_default,
                "is_active": item.is_active,
                "lifecycle": lifecycle,
            }
        )
    return SuccessResponse(data=data)


@router.delete("/accounts/{account_id}", response_model=SuccessResponse[dict])
async def delete_unused_bank_account(
    account_id: UUID,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(BankAccount).where(BankAccount.id == account_id).with_for_update())
    if item is None:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    lifecycle = await bank_account_lifecycle(session, item.id)
    if not lifecycle["can_delete"]:
        raise APIError(
            "BANK_ACCOUNT_DELETE_BLOCKED",
            _block_message(lifecycle) or "A conta possui vínculos e não pode ser excluída.",
            409,
            lifecycle,
        )
    await tenant_audit(
        session,
        action="bank_account.deleted",
        entity_type="BankAccount",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        before={"bank_code": item.bank_code, "bank_name": item.bank_name, "is_active": item.is_active},
    )
    await session.delete(item)
    await session.commit()
    return SuccessResponse(data={"deleted": True, "id": str(account_id)})


@router.get("/agreements", response_model=SuccessResponse[list[dict]])
async def list_bank_agreements_with_lifecycle(
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankAgreement).order_by(BankAgreement.name, BankAgreement.created_at)
    allowed = accessible_company_ids(user)
    if allowed is not None:
        stmt = stmt.where(BankAgreement.company_id.in_(allowed))
    items = list((await session.scalars(stmt)).all())
    data: list[dict] = []
    for item in items:
        lifecycle = await bank_agreement_lifecycle(session, item.id)
        data.append(
            {
                "id": str(item.id),
                "company_id": str(item.company_id),
                "bank_account_id": str(item.bank_account_id),
                "name": item.name,
                "provider": item.provider,
                "environment": item.environment,
                "agreement_number": item.agreement_number,
                "wallet": item.wallet,
                "beneficiary_code": item.beneficiary_code,
                "cnab_layout": item.cnab_layout,
                "settings": item.settings,
                "is_active": item.is_active,
                "lifecycle": lifecycle,
            }
        )
    return SuccessResponse(data=data)


@router.delete("/agreements/{agreement_id}", response_model=SuccessResponse[dict])
async def delete_unused_bank_agreement(
    agreement_id: UUID,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(BankAgreement).where(BankAgreement.id == agreement_id).with_for_update())
    if item is None:
        raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado.", 404)
    ensure_company_access(user, item.company_id)
    lifecycle = await bank_agreement_lifecycle(session, item.id)
    if not lifecycle["can_delete"]:
        raise APIError(
            "BANK_AGREEMENT_DELETE_BLOCKED",
            _block_message(lifecycle) or "O convênio já possui histórico e não pode ser excluído.",
            409,
            lifecycle,
        )
    await tenant_audit(
        session,
        action="bank_agreement.deleted",
        entity_type="BankAgreement",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        before={"provider": item.provider, "name": item.name, "is_active": item.is_active},
    )
    await session.delete(item)
    await session.commit()
    return SuccessResponse(data={"deleted": True, "id": str(agreement_id)})


@router.get("/connections", response_model=SuccessResponse[list[dict]])
async def list_bank_connections_lifecycle(
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankConnection).order_by(BankConnection.created_at.desc())
    allowed = accessible_company_ids(user)
    if allowed is not None:
        stmt = stmt.where(BankConnection.company_id.in_(allowed))
    items = list((await session.scalars(stmt)).all())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "provider": item.provider,
                "is_active": item.is_active,
                "lifecycle": await bank_connection_lifecycle(session, item.id),
            }
            for item in items
        ]
    )


@router.delete("/connections/{connection_id}", response_model=SuccessResponse[dict])
async def delete_unused_bank_connection(
    connection_id: UUID,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(BankConnection).where(BankConnection.id == connection_id).with_for_update())
    if item is None:
        raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    lifecycle = await bank_connection_lifecycle(session, item.id)
    if not lifecycle["can_delete"]:
        raise APIError(
            "BANK_CONNECTION_DELETE_BLOCKED",
            _block_message(lifecycle) or "A conexão já possui histórico e não pode ser excluída.",
            409,
            lifecycle,
        )
    await tenant_audit(
        session,
        action="bank.connection.deleted",
        entity_type="BankConnection",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        before={"provider": item.provider, "environment": item.environment, "is_active": item.is_active},
    )
    await session.delete(item)
    await session.commit()
    return SuccessResponse(data={"deleted": True, "id": str(connection_id)})
