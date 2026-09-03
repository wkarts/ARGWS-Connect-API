from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import accessible_company_ids, ensure_company_access, get_tenant_db, get_tenant_entitlements, require_permission
from app.core.errors import APIError
from app.models.tenant import PixAutomaticInstruction, PixAutomaticMandate
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.schemas.tenant_management import PixAutomaticInstructionInput, PixAutomaticMandateInput
from app.services.audit import tenant_audit
from app.services.entitlements import TenantEntitlements
from app.services.pix_automatic import PixAutomaticService

router = APIRouter(prefix="/api/v1/pix-automatic", tags=["Tenant - Pix Automático"])


@router.get("/mandates", response_model=SuccessResponse[list[dict]])
async def list_mandates(
    company_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    user: AuthUser = Depends(require_permission("pix_automatic.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(PixAutomaticMandate)
    if company_id:
        ensure_company_access(user, company_id)
        stmt = stmt.where(PixAutomaticMandate.company_id == company_id)
    else:
        ids = accessible_company_ids(user)
        if ids is not None:
            stmt = stmt.where(PixAutomaticMandate.company_id.in_(ids))
    if status:
        stmt = stmt.where(PixAutomaticMandate.status == status.upper())
    items = list((await session.scalars(stmt.order_by(PixAutomaticMandate.created_at.desc()).limit(1000))).all())
    return SuccessResponse(data=[PixAutomaticService.serialize(item) for item in items])


@router.post("/mandates", response_model=SuccessResponse[dict], status_code=201)
async def create_mandate(
    payload: PixAutomaticMandateInput,
    user: AuthUser = Depends(require_permission("pix_automatic.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    entitlements.require_feature("pix_automatic")
    ensure_company_access(user, payload.company_id)
    service = PixAutomaticService(session)
    item = await service.create(payload)
    await tenant_audit(
        session,
        action="pix_automatic.created",
        entity_type="PixAutomaticMandate",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        after=service.serialize(item),
    )
    await session.commit()
    await session.refresh(item)
    return SuccessResponse(data=service.serialize(item))


@router.post("/mandates/{mandate_id}/sync", response_model=SuccessResponse[dict])
async def sync_mandate(
    mandate_id: UUID,
    user: AuthUser = Depends(require_permission("pix_automatic.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(PixAutomaticMandate, mandate_id)
    if item is None:
        raise APIError("PIX_AUTOMATIC_MANDATE_NOT_FOUND", "Autorização não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    previous = item.status
    item = await PixAutomaticService(session).sync(item)
    await tenant_audit(
        session,
        action="pix_automatic.synced",
        entity_type="PixAutomaticMandate",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        before={"status": previous},
        after={"status": item.status},
    )
    await session.commit()
    return SuccessResponse(data=PixAutomaticService.serialize(item))


@router.post("/mandates/{mandate_id}/cancel", response_model=SuccessResponse[dict])
async def cancel_mandate(
    mandate_id: UUID,
    user: AuthUser = Depends(require_permission("pix_automatic.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(PixAutomaticMandate, mandate_id)
    if item is None:
        raise APIError("PIX_AUTOMATIC_MANDATE_NOT_FOUND", "Autorização não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    item = await PixAutomaticService(session).cancel(item)
    await tenant_audit(
        session,
        action="pix_automatic.cancelled",
        entity_type="PixAutomaticMandate",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
    )
    await session.commit()
    return SuccessResponse(data=PixAutomaticService.serialize(item))


@router.get("/mandates/{mandate_id}/instructions", response_model=SuccessResponse[list[dict]])
async def list_instructions(
    mandate_id: UUID,
    user: AuthUser = Depends(require_permission("pix_automatic.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    mandate = await session.get(PixAutomaticMandate, mandate_id)
    if mandate is None:
        raise APIError("PIX_AUTOMATIC_MANDATE_NOT_FOUND", "Autorização não encontrada.", 404)
    ensure_company_access(user, mandate.company_id)
    items = list(
        (
            await session.scalars(
                select(PixAutomaticInstruction)
                .where(PixAutomaticInstruction.mandate_id == mandate_id)
                .order_by(PixAutomaticInstruction.due_date.desc())
            )
        ).all()
    )
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "mandate_id": str(item.mandate_id),
                "receivable_id": str(item.receivable_id) if item.receivable_id else None,
                "charge_id": str(item.charge_id) if item.charge_id else None,
                "provider": item.provider,
                "external_id": item.external_id,
                "due_date": item.due_date.isoformat(),
                "amount": str(item.amount),
                "status": item.status,
                "retry_count": item.retry_count,
                "last_attempt_at": item.last_attempt_at.isoformat() if item.last_attempt_at else None,
                "last_error": item.last_error,
            }
            for item in items
        ]
    )


@router.post("/mandates/{mandate_id}/instructions", response_model=SuccessResponse[dict], status_code=201)
async def create_instruction(
    mandate_id: UUID,
    payload: PixAutomaticInstructionInput,
    user: AuthUser = Depends(require_permission("pix_automatic.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    mandate = await session.get(PixAutomaticMandate, mandate_id)
    if mandate is None:
        raise APIError("PIX_AUTOMATIC_MANDATE_NOT_FOUND", "Autorização não encontrada.", 404)
    ensure_company_access(user, mandate.company_id)
    item = await PixAutomaticService(session).create_instruction(mandate=mandate, **payload.model_dump())
    return SuccessResponse(data={
        "id": str(item.id),
        "mandate_id": str(item.mandate_id),
        "receivable_id": str(item.receivable_id) if item.receivable_id else None,
        "charge_id": str(item.charge_id) if item.charge_id else None,
        "provider": item.provider,
        "external_id": item.external_id,
        "due_date": item.due_date.isoformat(),
        "amount": str(item.amount),
        "status": item.status,
        "retry_count": item.retry_count,
        "created_at": item.created_at.isoformat(),
    })
