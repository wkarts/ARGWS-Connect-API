from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from slugify import slugify
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.platform import BrandingProfile, Partner, Tenant, TenantDomain
from app.schemas.auth import AuthUser
from app.schemas.branding import BrandingDraftInput, BrandingProfileRead, PartnerCreate, PartnerRead, PartnerUpdate
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.services.audit import platform_audit
from app.services.branding import create_draft, publish_profile, use_platform_brand

router = APIRouter(prefix="/api/control/v1", tags=["Control Plane — Branding"])


@router.get("/partners", response_model=PaginatedResponse[PartnerRead])
async def list_partners(page: int = Query(1, ge=1), per_page: int = Query(25, ge=1, le=100), q: str | None = None,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session)) -> PaginatedResponse[PartnerRead]:
    filters = [Partner.name.ilike(f"%{q}%") | Partner.slug.ilike(f"%{q}%")] if q else []
    total = await session.scalar(select(func.count()).select_from(Partner).where(*filters)) or 0
    items = list((await session.scalars(select(Partner).where(*filters).order_by(Partner.created_at.desc()).offset((page-1)*per_page).limit(per_page))))
    return PaginatedResponse(data=[PartnerRead.model_validate(x) for x in items], meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total+per_page-1)//per_page))


@router.post("/partners", response_model=SuccessResponse[PartnerRead], status_code=201)
async def create_partner(payload: PartnerCreate, user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session)) -> SuccessResponse[PartnerRead]:
    slug = payload.slug or slugify(payload.name)
    if await session.scalar(select(Partner.id).where(Partner.slug == slug)):
        raise APIError("PARTNER_SLUG_EXISTS", "Slug de Partner já está em uso.", 409)
    if payload.hostname:
        if await session.scalar(select(TenantDomain.id).where(TenantDomain.hostname == payload.hostname)):
            raise APIError("PARTNER_HOSTNAME_COLLISION", "Hostname já pertence a um Tenant.", 409)
        if await session.scalar(select(Partner.id).where(Partner.hostname == payload.hostname)):
            raise APIError("PARTNER_HOSTNAME_EXISTS", "Hostname já pertence a outro Partner.", 409)
    item = Partner(name=payload.name, slug=slug, hostname=payload.hostname, status="ACTIVE", branding_mode="PLATFORM")
    session.add(item); await session.flush()
    await platform_audit(session, action="partner.created", entity_type="Partner", entity_id=str(item.id), actor_id=user.id, after={"name":item.name,"slug":item.slug,"hostname":item.hostname})
    await session.commit(); await session.refresh(item)
    return SuccessResponse(data=PartnerRead.model_validate(item))


@router.patch("/partners/{partner_id}", response_model=SuccessResponse[PartnerRead])
async def update_partner(partner_id: UUID, payload: PartnerUpdate, user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session)) -> SuccessResponse[PartnerRead]:
    item = await session.get(Partner, partner_id)
    if item is None: raise APIError("PARTNER_NOT_FOUND", "Partner não encontrado.", 404)
    values=payload.model_dump(exclude_unset=True)
    if "hostname" in values and values["hostname"]:
        hostname=values["hostname"]
        if await session.scalar(select(TenantDomain.id).where(TenantDomain.hostname == hostname)):
            raise APIError("PARTNER_HOSTNAME_COLLISION", "Hostname já pertence a um Tenant.", 409)
        existing=await session.scalar(select(Partner.id).where(Partner.hostname==hostname, Partner.id!=partner_id))
        if existing: raise APIError("PARTNER_HOSTNAME_EXISTS", "Hostname já pertence a outro Partner.", 409)
    before={"name":item.name,"hostname":item.hostname,"status":item.status}
    for k,v in values.items(): setattr(item,k,v)
    await platform_audit(session, action="partner.updated", entity_type="Partner", entity_id=str(item.id), actor_id=user.id, before=before, after=values)
    await session.commit(); await session.refresh(item)
    return SuccessResponse(data=PartnerRead.model_validate(item))


@router.get("/branding/{owner_type}/{owner_id}", response_model=SuccessResponse[list[BrandingProfileRead]])
async def list_branding(owner_type: str, owner_id: UUID, _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session)) -> SuccessResponse[list[BrandingProfileRead]]:
    items=list((await session.scalars(select(BrandingProfile).where(BrandingProfile.owner_type==owner_type.upper(), BrandingProfile.owner_id==owner_id).order_by(BrandingProfile.version.desc()))))
    return SuccessResponse(data=[BrandingProfileRead.model_validate(x) for x in items])


@router.post("/branding/{owner_type}/{owner_id}/draft", response_model=SuccessResponse[BrandingProfileRead], status_code=201)
async def create_branding_draft(owner_type: str, owner_id: UUID, payload: BrandingDraftInput, user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session)) -> SuccessResponse[BrandingProfileRead]:
    item=await create_draft(session, owner_type=owner_type, owner_id=owner_id, payload=payload.model_dump())
    await platform_audit(session, action="branding.draft.created", entity_type="BrandingProfile", entity_id=str(item.id), actor_id=user.id, after={"owner_type":item.owner_type,"owner_id":str(item.owner_id),"version":item.version})
    await session.commit(); await session.refresh(item)
    return SuccessResponse(data=BrandingProfileRead.model_validate(item))


@router.post("/branding/profiles/{profile_id}/publish", response_model=SuccessResponse[BrandingProfileRead])
async def publish_branding(profile_id: UUID, user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session)) -> SuccessResponse[BrandingProfileRead]:
    item=await session.get(BrandingProfile, profile_id)
    if item is None: raise APIError("BRANDING_PROFILE_NOT_FOUND", "Perfil de branding não encontrado.", 404)
    await publish_profile(session, item)
    await platform_audit(session, action="branding.published", entity_type="BrandingProfile", entity_id=str(item.id), actor_id=user.id, after={"owner_type":item.owner_type,"owner_id":str(item.owner_id),"version":item.version})
    await session.commit(); await session.refresh(item)
    return SuccessResponse(data=BrandingProfileRead.model_validate(item))


@router.post("/branding/{owner_type}/{owner_id}/platform", response_model=SuccessResponse[dict])
async def restore_platform_brand(owner_type: str, owner_id: UUID, user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session)) -> SuccessResponse[dict]:
    await use_platform_brand(session, owner_type=owner_type, owner_id=owner_id)
    await platform_audit(session, action="branding.platform.restored", entity_type=owner_type.upper(), entity_id=str(owner_id), actor_id=user.id, after={"branding_mode":"PLATFORM" if owner_type.upper()=="PARTNER" else "INHERIT"})
    await session.commit()
    return SuccessResponse(data={"owner_type":owner_type.upper(),"owner_id":str(owner_id),"branding_mode":"PLATFORM" if owner_type.upper()=="PARTNER" else "INHERIT"})
