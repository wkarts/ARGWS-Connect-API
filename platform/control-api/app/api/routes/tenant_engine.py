from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.deps import get_tenant_context_dep, require_permission
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.models.platform import EngineBinding
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.schemas.connect_engine import (
    EngineActionDefinition,
    EngineActionDelete,
    EngineActionExecute,
    EngineInstanceCreate,
    EnginePairingRequest,
    EngineRecipeDefinition,
    EngineRecipeDelete,
    EngineRecipeExecute,
    EngineTemplateCreate,
    EngineTemplateDelete,
    EngineTemplateEdit,
    TemplatePreviewRequest,
    TemplateSendRequest,
    TextSendRequest,
)
from app.services.audit import platform_audit
from app.services.connect_engine import connect_engine
from app.services.instance_lifecycle import reserve_instance, ensure_instance, pairing_response, READY

router = APIRouter(prefix="/api/v1/connect", tags=["Connect|API Engine"])


async def _binding(context: TenantContext, binding_id: UUID) -> EngineBinding:
    async with PlatformSessionLocal() as session:
        item = await session.get(EngineBinding, binding_id)
        if item is None or str(item.tenant_id) != context.tenant_id:
            raise APIError("ENGINE_BINDING_NOT_FOUND", "Instância não encontrada para este tenant.", 404)
        session.expunge(item)
        return item


def _state_value(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidate = payload.get("instance") or payload.get("data") or payload
    if isinstance(candidate, dict):
        return str(candidate.get("state") or candidate.get("status") or candidate.get("connectionStatus") or "") or None
    return None


@router.get("/engine/status", response_model=SuccessResponse[dict])
async def engine_status(
    _: AuthUser = Depends(require_permission("instances.read")),
) -> SuccessResponse[dict]:
    health = await connect_engine.health()
    return SuccessResponse(data={"available": True, "engine": health})


@router.get("/instances", response_model=SuccessResponse[list[dict]])
async def list_instances(
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("instances.read")),
) -> SuccessResponse[list[dict]]:
    async with PlatformSessionLocal() as session:
        bindings = list(
            (await session.scalars(
                select(EngineBinding)
                .where(EngineBinding.tenant_id == UUID(context.tenant_id))
                .order_by(EngineBinding.created_at.desc())
            )).all()
        )

    semaphore = asyncio.Semaphore(4)
    async def snapshot(item):
        state_payload, error = None, None
        if item.status in READY:
            try:
                async with semaphore:
                    state_payload = await asyncio.wait_for(connect_engine.connection_state(item.instance_name), timeout=5)
            except (APIError, TimeoutError) as exc:
                error = exc.message if isinstance(exc, APIError) else "Consulta de estado demorou. A instância continua registrada."
        return {
            "id": str(item.id), "alias": item.alias, "instance_name": item.instance_name,
            "provider": item.provider, "status": item.status,
            "origin": (item.metadata_json or {}).get("origin", "PLATFORM_CREATED"),
            "state": _state_value(state_payload) or item.last_state,
            "capabilities": item.capabilities, "last_error": error or item.last_error,
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
    return SuccessResponse(data=await asyncio.gather(*(snapshot(item) for item in bindings)))


@router.post("/instances", response_model=SuccessResponse[dict], status_code=201)
async def create_instance(
    payload: EngineInstanceCreate,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    binding_id = await reserve_instance(context, user, payload)
    return SuccessResponse(data=await ensure_instance(context, user, binding_id))


@router.post("/instances/{binding_id}/reconcile", response_model=SuccessResponse[dict])
async def reconcile_instance(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await ensure_instance(context, user, binding_id))


@router.get("/instances/{binding_id}/state", response_model=SuccessResponse[dict])
async def instance_state(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("instances.read")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    state = await connect_engine.connection_state(item.instance_name)
    return SuccessResponse(data={"id": str(item.id), "instance_name": item.instance_name, "engine": state})


@router.post("/instances/{binding_id}/connect", response_model=SuccessResponse[dict])
async def instance_connect(
    binding_id: UUID,
    payload: EnginePairingRequest | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    if item.status not in READY:
        raise APIError("ENGINE_CREATION_PENDING", "Conclua a criação antes de parear a instância.", 409)
    if item.provider != "WHATSAPP-BAILEYS":
        raise APIError("PAIRING_NOT_SUPPORTED", "Este provedor não utiliza QR Code ou código de pareamento.", 422)
    response = await connect_engine.connect_instance(item.instance_name, payload.number if payload else None)
    return SuccessResponse(data=pairing_response(response))


@router.post("/instances/{binding_id}/restart", response_model=SuccessResponse[dict])
async def instance_restart(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.restart_instance(item.instance_name))


@router.delete("/instances/{binding_id}", response_model=SuccessResponse[dict])
async def instance_delete(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("instances.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    if item.status not in READY:
        raise APIError("ENGINE_CREATION_PENDING", "Verifique a criação pendente antes de excluir a instância.", 409)
    engine_response = await connect_engine.delete_instance(item.instance_name)
    async with PlatformSessionLocal() as session:
        persisted = await session.get(EngineBinding, binding_id)
        if persisted is not None and str(persisted.tenant_id) == context.tenant_id:
            await platform_audit(
                session,
                action="connect.engine.instance.delete",
                entity_type="EngineBinding",
                entity_id=str(persisted.id),
                actor_id=user.id,
                tenant_id=context.tenant_id,
                before={"alias": persisted.alias, "instance_name": persisted.instance_name, "provider": persisted.provider},
            )
            await session.delete(persisted)
            await session.commit()
    return SuccessResponse(data={"deleted": True, "engine": engine_response})


@router.get("/instances/{binding_id}/templates", response_model=SuccessResponse[dict])
async def templates(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("templates.read")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data={"instance": item.instance_name, "templates": await connect_engine.templates(item.instance_name)})


@router.post("/instances/{binding_id}/templates", response_model=SuccessResponse[dict], status_code=201)
async def create_template(
    binding_id: UUID,
    payload: EngineTemplateCreate,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("templates.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.create_template(item.instance_name, payload.model_dump(exclude_none=True)))


@router.put("/instances/{binding_id}/templates", response_model=SuccessResponse[dict])
async def edit_template(
    binding_id: UUID,
    payload: EngineTemplateEdit,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("templates.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.edit_template(item.instance_name, payload.model_dump(exclude_none=True)))


@router.delete("/instances/{binding_id}/templates", response_model=SuccessResponse[dict])
async def delete_template(
    binding_id: UUID,
    payload: EngineTemplateDelete,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("templates.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.delete_template(item.instance_name, payload.model_dump(exclude_none=True)))


@router.get("/instances/{binding_id}/template-capabilities", response_model=SuccessResponse[dict])
async def template_capabilities(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("templates.read")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.template_capabilities(item.instance_name))


@router.post("/instances/{binding_id}/template-preview", response_model=SuccessResponse[dict])
async def template_preview(
    binding_id: UUID,
    payload: TemplatePreviewRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("templates.read")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.template_preview(item.instance_name, payload.model_dump(exclude_none=True)))


@router.post("/instances/{binding_id}/send-template", response_model=SuccessResponse[dict])
async def send_template(
    binding_id: UUID,
    payload: TemplateSendRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("messages.send")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    body = payload.model_dump(exclude_none=True)
    return SuccessResponse(data=await connect_engine.send_template(item.instance_name, body))


@router.post("/instances/{binding_id}/send-text", response_model=SuccessResponse[dict])
async def send_text(
    binding_id: UUID,
    payload: TextSendRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("messages.send")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.send_text(item.instance_name, payload.model_dump(exclude_none=True)))


@router.get("/instances/{binding_id}/actions", response_model=SuccessResponse[dict])
async def actions(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("integrations.read")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data={"instance": item.instance_name, "actions": await connect_engine.actions(item.instance_name)})


@router.post("/instances/{binding_id}/actions", response_model=SuccessResponse[dict], status_code=201)
async def create_action(
    binding_id: UUID,
    payload: EngineActionDefinition,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("integrations.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.create_action(item.instance_name, payload.model_dump(exclude_none=True)))


@router.post("/instances/{binding_id}/actions/execute", response_model=SuccessResponse[dict])
async def execute_action(
    binding_id: UUID,
    payload: EngineActionExecute,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("integrations.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.execute_action(item.instance_name, payload.model_dump(exclude_none=True)))


@router.delete("/instances/{binding_id}/actions", response_model=SuccessResponse[dict])
async def delete_action(
    binding_id: UUID,
    payload: EngineActionDelete,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("integrations.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.delete_action(item.instance_name, payload.model_dump()))


@router.get("/instances/{binding_id}/recipes", response_model=SuccessResponse[dict])
async def recipes(
    binding_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("automations.read")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data={"instance": item.instance_name, "recipes": await connect_engine.recipes(item.instance_name)})


@router.post("/instances/{binding_id}/recipes", response_model=SuccessResponse[dict], status_code=201)
async def create_recipe(
    binding_id: UUID,
    payload: EngineRecipeDefinition,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("automations.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.create_recipe(item.instance_name, payload.model_dump(exclude_none=True)))


@router.post("/instances/{binding_id}/recipes/execute", response_model=SuccessResponse[dict])
async def execute_recipe(
    binding_id: UUID,
    payload: EngineRecipeExecute,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("automations.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.execute_recipe(item.instance_name, payload.model_dump(exclude_none=True)))


@router.delete("/instances/{binding_id}/recipes", response_model=SuccessResponse[dict])
async def delete_recipe(
    binding_id: UUID,
    payload: EngineRecipeDelete,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("automations.manage")),
) -> SuccessResponse[dict]:
    item = await _binding(context, binding_id)
    return SuccessResponse(data=await connect_engine.delete_recipe(item.instance_name, payload.model_dump()))
