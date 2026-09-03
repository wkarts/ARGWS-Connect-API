from __future__ import annotations

import copy
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.landing import PlatformLandingPage, PlatformLandingRevision
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.services.landing_builder import create_revision, get_or_create_landing, sanitize_css, sanitize_document

router = APIRouter(prefix="/api/control/v1/landing", tags=["Control Plane - Landing Builder"])


class LandingDraftInput(BaseModel):
    document: dict = Field(default_factory=dict)
    custom_css: str = Field(default="", max_length=120_000)
    enabled: bool | None = None
    name: str | None = Field(default=None, max_length=160)


class LandingCheckpointInput(BaseModel):
    note: str | None = Field(default=None, max_length=240)


class LandingEnabledInput(BaseModel):
    enabled: bool


def _revision_dict(item: PlatformLandingRevision) -> dict:
    return {
        "id": str(item.id),
        "revision": item.revision,
        "note": item.note,
        "is_published": item.is_published,
        "actor_id": str(item.actor_id) if item.actor_id else None,
        "created_at": item.created_at.isoformat(),
    }


async def _payload(session: AsyncSession, page: PlatformLandingPage) -> dict:
    revisions = list((await session.scalars(
        select(PlatformLandingRevision)
        .where(PlatformLandingRevision.landing_id == page.id)
        .order_by(PlatformLandingRevision.revision.desc())
        .limit(50)
    )).all())
    return {
        "id": str(page.id),
        "key": page.key,
        "name": page.name,
        "enabled": page.enabled,
        "draft_document": page.draft_document or {},
        "draft_css": page.draft_css or "",
        "published_document": page.published_document or {},
        "published_css": page.published_css or "",
        "current_revision": page.current_revision,
        "published_revision": page.published_revision,
        "published_at": page.published_at.isoformat() if page.published_at else None,
        "updated_at": page.updated_at.isoformat(),
        "revisions": [_revision_dict(item) for item in revisions],
    }


@router.get("", response_model=SuccessResponse[dict])
async def get_landing_builder(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    page = await get_or_create_landing(session)
    await session.commit()
    await session.refresh(page)
    return SuccessResponse(data=await _payload(session, page))


@router.put("/draft", response_model=SuccessResponse[dict])
async def save_landing_draft(
    payload: LandingDraftInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    page = await get_or_create_landing(session)
    before = {"enabled": page.enabled, "current_revision": page.current_revision}
    page.draft_document = sanitize_document(payload.document)
    page.draft_css = sanitize_css(payload.custom_css)
    if payload.enabled is not None:
        page.enabled = payload.enabled
    if payload.name is not None and payload.name.strip():
        page.name = payload.name.strip()
    await platform_audit(
        session,
        action="landing.draft_saved",
        entity_type="PlatformLandingPage",
        entity_id=str(page.id),
        actor_id=user.id,
        before=before,
        after={"enabled": page.enabled, "blocks": len(page.draft_document.get("blocks") or [])},
    )
    await session.commit()
    await session.refresh(page)
    return SuccessResponse(data=await _payload(session, page))


@router.post("/checkpoint", response_model=SuccessResponse[dict])
async def checkpoint_landing(
    payload: LandingCheckpointInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    page = await get_or_create_landing(session)
    revision = await create_revision(
        session,
        page,
        actor_id=UUID(user.id),
        note=payload.note or "Checkpoint manual",
        published=False,
    )
    await platform_audit(
        session,
        action="landing.checkpoint_created",
        entity_type="PlatformLandingPage",
        entity_id=str(page.id),
        actor_id=user.id,
        after={"revision": revision.revision, "note": revision.note},
    )
    await session.commit()
    await session.refresh(page)
    return SuccessResponse(data=await _payload(session, page))


@router.post("/publish", response_model=SuccessResponse[dict])
async def publish_landing(
    payload: LandingCheckpointInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    page = await get_or_create_landing(session)
    page.draft_document = sanitize_document(page.draft_document or {})
    page.draft_css = sanitize_css(page.draft_css or "")
    revision = await create_revision(
        session,
        page,
        actor_id=UUID(user.id),
        note=payload.note or "Publicação",
        published=True,
    )
    page.published_document = copy.deepcopy(page.draft_document)
    page.published_css = page.draft_css
    page.published_revision = revision.revision
    page.published_at = datetime.now(UTC)
    page.published_by = UUID(user.id)
    await platform_audit(
        session,
        action="landing.published",
        entity_type="PlatformLandingPage",
        entity_id=str(page.id),
        actor_id=user.id,
        after={
            "revision": revision.revision,
            "enabled": page.enabled,
            "blocks": len(page.published_document.get("blocks") or []),
        },
    )
    await session.commit()
    await session.refresh(page)
    return SuccessResponse(data=await _payload(session, page))


@router.post("/restore/{revision_number}", response_model=SuccessResponse[dict])
async def restore_landing_revision(
    revision_number: int,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    page = await get_or_create_landing(session)
    revision = await session.scalar(
        select(PlatformLandingRevision).where(
            PlatformLandingRevision.landing_id == page.id,
            PlatformLandingRevision.revision == revision_number,
        )
    )
    if revision is None:
        raise APIError("LANDING_REVISION_NOT_FOUND", "Versão da landing page não encontrada.", 404)
    page.draft_document = copy.deepcopy(revision.document)
    page.draft_css = revision.custom_css
    await platform_audit(
        session,
        action="landing.revision_restored",
        entity_type="PlatformLandingPage",
        entity_id=str(page.id),
        actor_id=user.id,
        after={"revision": revision.revision, "published_source": revision.is_published},
    )
    await session.commit()
    await session.refresh(page)
    return SuccessResponse(data=await _payload(session, page))


@router.patch("/enabled", response_model=SuccessResponse[dict])
async def set_landing_enabled(
    payload: LandingEnabledInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    page = await get_or_create_landing(session)
    before = page.enabled
    page.enabled = payload.enabled
    await platform_audit(
        session,
        action="landing.enabled_changed",
        entity_type="PlatformLandingPage",
        entity_id=str(page.id),
        actor_id=user.id,
        before={"enabled": before},
        after={"enabled": page.enabled},
    )
    await session.commit()
    await session.refresh(page)
    return SuccessResponse(data=await _payload(session, page))
