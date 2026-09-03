from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_company_access, get_tenant_context_dep, get_tenant_db, require_permission
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.db.platform import get_platform_session
from app.models.banking import BankConnection
from app.providers.banking.core.capabilities import BankingCapability, BankingIntegrationMode
from app.providers.banking.core.normalization import sanitize_mapping
from app.providers.banking.registry import banking_providers
from app.schemas.auth import AuthUser
from app.schemas.banking_bb import BBOperationalDownToggle, BBProviderPayload, BBReturnMovementRequest
from app.schemas.common import SuccessResponse
from app.services.banking_entitlements import require_provider_entitlement
from app.services.banking_gateway import BankingGateway

router = APIRouter(prefix="/api/v1/banking/bb", tags=["Banco do Brasil"])


async def _bb_context(
    *,
    connection_id: UUID,
    context: TenantContext,
    user: AuthUser,
    session: AsyncSession,
    platform_session: AsyncSession,
    capability: BankingCapability | None = None,
) -> tuple[Any, Any]:
    connection = await session.get(BankConnection, connection_id)
    if connection is None:
        raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
    ensure_company_access(user, connection.company_id)
    if connection.provider != "BANCO_DO_BRASIL":
        raise APIError(
            "BANKING_PROVIDER_MISMATCH",
            "Esta operação pertence exclusivamente ao provider Banco do Brasil.",
            409,
            {"connection_provider": connection.provider, "required_provider": "BANCO_DO_BRASIL"},
        )
    if not connection.is_active:
        raise APIError("BANK_CONNECTION_INACTIVE", "A conexão Banco do Brasil está desativada.", 409)
    await require_provider_entitlement(
        platform_session,
        tenant_id=context.tenant_id,
        provider_code="BANCO_DO_BRASIL",
    )
    await platform_session.commit()
    gateway = BankingGateway(session, tenant_id=context.tenant_id)
    provider_context = await gateway.context(connection)
    if capability is not None:
        gateway.require_capability(provider_context, capability)
    provider = banking_providers.get_for_mode("BANCO_DO_BRASIL", BankingIntegrationMode.DIRECT_API)
    return provider, provider_context


def _data(value: Any) -> Any:
    if isinstance(value, dict):
        return sanitize_mapping(value)
    if isinstance(value, list):
        return [sanitize_mapping(item) if isinstance(item, dict) else item for item in value]
    return value


def _agreement(provider_context: Any) -> dict[str, Any]:
    return {
        "environment": provider_context.environment.value,
        "credentials": provider_context.credentials,
        "settings": provider_context.settings,
    }


@router.get("/connections/{connection_id}/boletos", response_model=SuccessResponse[Any])
async def bb_list_bills(
    connection_id: UUID,
    indicadorSituacao: str = Query(min_length=1, max_length=1),
    agenciaBeneficiario: int = Query(ge=1),
    contaBeneficiario: int = Query(ge=1),
    contaCaucao: int | None = None,
    carteiraConvenio: int | None = None,
    variacaoCarteiraConvenio: int | None = None,
    modalidadeCobranca: int | None = None,
    cnpjPagador: str | None = None,
    digitoCNPJPagador: str | None = None,
    cpfPagador: int | None = None,
    digitoCPFPagador: int | None = None,
    dataInicioVencimento: str | None = None,
    dataFimVencimento: str | None = None,
    dataInicioRegistro: str | None = None,
    dataFimRegistro: str | None = None,
    dataInicioMovimento: str | None = None,
    dataFimMovimento: str | None = None,
    codigoEstadoTituloCobranca: int | None = None,
    boletoVencido: str | None = None,
    indice: int | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[Any]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    filters = {
        key: value
        for key, value in locals().items()
        if key in {
            "indicadorSituacao", "agenciaBeneficiario", "contaBeneficiario", "contaCaucao",
            "carteiraConvenio", "variacaoCarteiraConvenio", "modalidadeCobranca", "cnpjPagador",
            "digitoCNPJPagador", "cpfPagador", "digitoCPFPagador", "dataInicioVencimento",
            "dataFimVencimento", "dataInicioRegistro", "dataFimRegistro", "dataInicioMovimento",
            "dataFimMovimento", "codigoEstadoTituloCobranca", "boletoVencido", "indice",
        }
        and value not in (None, "")
    }
    filters["indicadorSituacao"] = str(filters["indicadorSituacao"]).upper()
    if "boletoVencido" in filters:
        filters["boletoVencido"] = str(filters["boletoVencido"]).upper()
    result = await provider.list_bills(provider_context, filters=filters)
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/boletos/{boleto_id}", response_model=SuccessResponse[dict])
async def bb_get_bill(
    connection_id: UUID,
    boleto_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    result = await provider.get_charge(boleto_id, _agreement(provider_context))
    return SuccessResponse(
        data={
            "provider": result.provider,
            "external_id": result.external_id,
            "status": result.status,
            "our_number": result.our_number,
            "digitable_line": result.digitable_line,
            "barcode": result.barcode,
            "txid": result.txid,
            "pix_copy_paste": result.pix_copy_paste,
            "document_url": result.document_url,
            "raw": _data(result.raw),
        }
    )


@router.patch("/connections/{connection_id}/boletos/{boleto_id}", response_model=SuccessResponse[dict])
async def bb_update_bill(
    connection_id: UUID,
    boleto_id: str,
    payload: BBProviderPayload,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_UPDATE,
    )
    return SuccessResponse(data=_data(await provider.update_bill(provider_context, boleto_id, payload.payload)))


@router.post("/connections/{connection_id}/boletos/{boleto_id}/baixar", response_model=SuccessResponse[dict])
async def bb_cancel_bill(
    connection_id: UUID,
    boleto_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_CANCEL,
    )
    await provider.cancel_charge(boleto_id, _agreement(provider_context))
    return SuccessResponse(data={"cancelled": True, "boleto_id": boleto_id})


@router.post("/connections/{connection_id}/boletos/{boleto_id}/pix", response_model=SuccessResponse[dict])
async def bb_generate_pix(
    connection_id: UUID,
    boleto_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_HYBRID,
    )
    return SuccessResponse(data=_data(await provider.generate_linked_pix(provider_context, boleto_id)))


@router.get("/connections/{connection_id}/boletos/{boleto_id}/pix", response_model=SuccessResponse[dict])
async def bb_get_pix(
    connection_id: UUID,
    boleto_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_HYBRID,
    )
    return SuccessResponse(data=_data(await provider.get_linked_pix(provider_context, boleto_id)))


@router.delete("/connections/{connection_id}/boletos/{boleto_id}/pix", response_model=SuccessResponse[dict])
async def bb_cancel_pix(
    connection_id: UUID,
    boleto_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_HYBRID,
    )
    return SuccessResponse(data=_data(await provider.cancel_linked_pix(provider_context, boleto_id)))


@router.post("/connections/{connection_id}/retorno-movimento", response_model=SuccessResponse[dict])
async def bb_return_movement(
    connection_id: UUID,
    payload: BBReturnMovementRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    result = await provider.list_return_movement(provider_context, payload.model_dump(exclude_none=True))
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/baixa-operacional", response_model=SuccessResponse[dict])
async def bb_operational_downs(
    connection_id: UUID,
    agencia: int = Query(ge=1),
    conta: int = Query(ge=1),
    carteira: int = Query(ge=1),
    variacao: int = Query(ge=1),
    dataInicioAgendamentoTitulo: str = Query(min_length=10, max_length=10),
    dataFimAgendamentoTitulo: str = Query(min_length=10, max_length=10),
    estadoBaixaOperacional: int | None = None,
    modalidadeTitulo: int | None = None,
    dataInicioVencimentoTitulo: str | None = None,
    dataFimVencimentoTitulo: str | None = None,
    dataInicioRegistroTitulo: str | None = None,
    dataFimRegistroTitulo: str | None = None,
    horarioInicioAgendamentoTitulo: str | None = None,
    horarioFimAgendamentoTitulo: str | None = None,
    idProximoTitulo: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    allowed = {
        "agencia", "conta", "carteira", "variacao", "dataInicioAgendamentoTitulo",
        "dataFimAgendamentoTitulo", "estadoBaixaOperacional", "modalidadeTitulo",
        "dataInicioVencimentoTitulo", "dataFimVencimentoTitulo", "dataInicioRegistroTitulo",
        "dataFimRegistroTitulo", "horarioInicioAgendamentoTitulo", "horarioFimAgendamentoTitulo",
        "idProximoTitulo",
    }
    filters = {key: value for key, value in locals().items() if key in allowed and value not in (None, "")}
    return SuccessResponse(data=_data(await provider.list_operational_downs(provider_context, filters=filters)))


@router.patch("/connections/{connection_id}/baixa-operacional/configuracao", response_model=SuccessResponse[dict])
async def bb_operational_down_toggle(
    connection_id: UUID,
    payload: BBOperationalDownToggle,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _bb_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
    )
    return SuccessResponse(data=_data(await provider.set_operational_down_query(provider_context, enabled=payload.enabled)))
