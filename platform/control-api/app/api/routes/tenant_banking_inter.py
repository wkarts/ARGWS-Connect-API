from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
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
from app.schemas.banking_inter import (
    InterBillingCancelRequest,
    InterBoletoPaymentRequest,
    InterDarfPaymentRequest,
    InterPaymentBatchRequest,
    InterPixLocationRequest,
    InterPixPaymentRequest,
    InterPixRefundRequest,
    InterProviderPayload,
    InterWebhookRequest,
)
from app.schemas.common import SuccessResponse
from app.services.banking_entitlements import require_provider_entitlement
from app.services.banking_gateway import BankingGateway

router = APIRouter(prefix="/api/v1/banking/inter", tags=["Banco Inter"])

PixBillingStatus = Literal[
    "ATIVA",
    "CONCLUIDA",
    "REMOVIDO_PELO_USUARIO_RECEBEDOR",
    "REMOVIDO_PELO_PSP",
]
BankingWebhookType = Literal["pix-pagamento", "boleto-pagamento"]


async def _inter_context(
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
    if connection.provider != "INTER":
        raise APIError(
            "BANKING_PROVIDER_MISMATCH",
            "Esta operação pertence exclusivamente ao provider Banco Inter.",
            409,
            {"connection_provider": connection.provider, "required_provider": "INTER"},
        )
    if not connection.is_active:
        raise APIError("BANK_CONNECTION_INACTIVE", "A conexão Banco Inter está desativada.", 409)
    await require_provider_entitlement(
        platform_session,
        tenant_id=context.tenant_id,
        provider_code="INTER",
    )
    await platform_session.commit()
    gateway = BankingGateway(session, tenant_id=context.tenant_id)
    provider_context = await gateway.context(connection)
    if capability is not None:
        gateway.require_capability(provider_context, capability)
    provider = banking_providers.get_for_mode("INTER", BankingIntegrationMode.DIRECT_API)
    return provider, provider_context


def _data(value: Any) -> Any:
    if isinstance(value, dict):
        return sanitize_mapping(value)
    if isinstance(value, list):
        return [sanitize_mapping(item) if isinstance(item, dict) else item for item in value]
    return value


@router.get("/connections/{connection_id}/statement.pdf")
async def inter_statement_pdf(
    connection_id: UUID,
    start_date: date,
    end_date: date,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> Response:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.STATEMENT,
    )
    content = await provider.get_statement_pdf(provider_context, start_date=start_date, end_date=end_date)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="inter-extrato-{start_date}-{end_date}.pdf"'},
    )


@router.get("/connections/{connection_id}/billings", response_model=SuccessResponse[dict])
async def inter_list_billings(
    connection_id: UUID,
    start_date: date,
    end_date: date,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    filter_date_by: str | None = None,
    situation: str | None = None,
    payer: str | None = None,
    payer_tax_id: str | None = None,
    your_number: str | None = None,
    billing_type: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    filters = {
        "filtrarDataPor": filter_date_by,
        "situacao": situation,
        "pessoaPagadora": payer,
        "cpfCnpjPessoaPagadora": payer_tax_id,
        "seuNumero": your_number,
        "tipoCobranca": billing_type,
    }
    result = await provider.list_billings(
        provider_context,
        start_date=start_date,
        end_date=end_date,
        page=page,
        page_size=page_size,
        filters=filters,
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/billings/summary", response_model=SuccessResponse[list])
async def inter_billing_summary(
    connection_id: UUID,
    start_date: date,
    end_date: date,
    filter_date_by: str | None = None,
    situation: str | None = None,
    payer: str | None = None,
    payer_tax_id: str | None = None,
    your_number: str | None = None,
    billing_type: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    filters = {
        "filtrarDataPor": filter_date_by,
        "situacao": situation,
        "pessoaPagadora": payer,
        "cpfCnpjPessoaPagadora": payer_tax_id,
        "seuNumero": your_number,
        "tipoCobranca": billing_type,
    }
    result = await provider.billing_summary(
        provider_context,
        start_date=start_date,
        end_date=end_date,
        filters=filters,
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/billings/{request_code}", response_model=SuccessResponse[dict])
async def inter_get_billing(
    connection_id: UUID,
    request_code: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    result = await provider.get_billing(provider_context, request_code)
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
            "raw": _data(result.raw),
        }
    )


@router.get("/connections/{connection_id}/billings/{request_code}/pdf")
async def inter_get_billing_pdf(
    connection_id: UUID,
    request_code: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> Response:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    content = await provider.get_billing_pdf(provider_context, request_code)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="inter-cobranca-{request_code}.pdf"'},
    )


@router.post("/connections/{connection_id}/billings/{request_code}/cancel", response_model=SuccessResponse[dict])
async def inter_cancel_billing(
    connection_id: UUID,
    request_code: str,
    payload: InterBillingCancelRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_CANCEL,
    )
    await provider.cancel_billing(provider_context, request_code, reason=payload.reason)
    return SuccessResponse(data={"cancelled": True, "request_code": request_code})


@router.get("/connections/{connection_id}/pix/cob", response_model=SuccessResponse[dict])
async def inter_list_pix_cob(
    connection_id: UUID,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    cpf: str | None = None,
    cnpj: str | None = None,
    location_present: bool | None = None,
    status: PixBillingStatus | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COB,
    )
    result = await provider.list_immediate_pix_charges(
        provider_context,
        start=start,
        end=end,
        page=page,
        page_size=page_size,
        cpf=cpf,
        cnpj=cnpj,
        location_present=location_present,
        status=status,
    )
    return SuccessResponse(data=_data(result))


@router.patch("/connections/{connection_id}/pix/cob/{txid}", response_model=SuccessResponse[dict])
async def inter_update_pix_cob(
    connection_id: UUID,
    txid: str,
    payload: InterProviderPayload,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COB,
    )
    return SuccessResponse(data=_data(await provider.update_immediate_pix_charge(provider_context, txid=txid, payload=payload.payload)))


@router.get("/connections/{connection_id}/pix/cobv", response_model=SuccessResponse[dict])
async def inter_list_pix_cobv(
    connection_id: UUID,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    cpf: str | None = None,
    cnpj: str | None = None,
    location_present: bool | None = None,
    status: PixBillingStatus | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    result = await provider.list_due_pix_charges(
        provider_context,
        start=start,
        end=end,
        page=page,
        page_size=page_size,
        cpf=cpf,
        cnpj=cnpj,
        location_present=location_present,
        status=status,
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/pix/cobv/{txid}", response_model=SuccessResponse[dict])
async def inter_get_pix_cobv(
    connection_id: UUID,
    txid: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    return SuccessResponse(data=_data(await provider.get_due_pix_charge(provider_context, txid)))


@router.patch("/connections/{connection_id}/pix/cobv/{txid}", response_model=SuccessResponse[dict])
async def inter_update_pix_cobv(
    connection_id: UUID,
    txid: str,
    payload: InterProviderPayload,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    result = await provider.update_due_pix_charge(provider_context, txid=txid, payload=payload.payload)
    return SuccessResponse(data=_data(result))


@router.put("/connections/{connection_id}/pix/cobv/batches/{batch_id}", response_model=SuccessResponse[dict])
async def inter_create_pix_cobv_batch(
    connection_id: UUID,
    batch_id: str,
    payload: InterProviderPayload,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    await provider.create_due_pix_batch(provider_context, batch_id=batch_id, payload=payload.payload)
    return SuccessResponse(data={"accepted": True, "batch_id": batch_id})


@router.get("/connections/{connection_id}/pix/cobv/batches/{batch_id}", response_model=SuccessResponse[dict])
async def inter_get_pix_cobv_batch(
    connection_id: UUID,
    batch_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    return SuccessResponse(data=_data(await provider.get_due_pix_batch(provider_context, batch_id)))


@router.patch("/connections/{connection_id}/pix/cobv/batches/{batch_id}", response_model=SuccessResponse[dict])
async def inter_update_pix_cobv_batch(
    connection_id: UUID,
    batch_id: str,
    payload: InterProviderPayload,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    await provider.update_due_pix_batch(provider_context, batch_id=batch_id, payload=payload.payload)
    return SuccessResponse(data={"accepted": True, "batch_id": batch_id})


@router.get("/connections/{connection_id}/pix/cobv/batches/{batch_id}/summary", response_model=SuccessResponse[dict])
async def inter_pix_cobv_batch_summary(
    connection_id: UUID,
    batch_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COBV,
    )
    return SuccessResponse(data=_data(await provider.get_due_pix_batch_summary(provider_context, batch_id)))


@router.get("/connections/{connection_id}/pix/received", response_model=SuccessResponse[dict])
async def inter_list_received_pix(
    connection_id: UUID,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    txid: str | None = None,
    txid_present: bool | None = None,
    refund_present: bool | None = None,
    cpf: str | None = None,
    cnpj: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_RECEIVED,
    )
    result = await provider.list_received_pix(
        provider_context,
        start=start,
        end=end,
        page=page,
        page_size=page_size,
        filters={
            "txId": txid,
            "txIdPresente": txid_present,
            "devolucaoPresente": refund_present,
            "cpf": cpf,
            "cnpj": cnpj,
        },
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/pix/received/{e2e_id}", response_model=SuccessResponse[dict])
async def inter_get_received_pix(
    connection_id: UUID,
    e2e_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_RECEIVED,
    )
    return SuccessResponse(data=_data(await provider.get_received_pix(provider_context, e2e_id)))


@router.put("/connections/{connection_id}/pix/received/{e2e_id}/refunds/{refund_id}", response_model=SuccessResponse[dict])
async def inter_refund_pix(
    connection_id: UUID,
    e2e_id: str,
    refund_id: str,
    payload: InterPixRefundRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_REFUND,
    )
    result = await provider.refund_pix(
        provider_context,
        e2e_id=e2e_id,
        refund_id=refund_id,
        value=payload.value,
        nature=payload.nature,
        description=payload.description,
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/pix/received/{e2e_id}/refunds/{refund_id}", response_model=SuccessResponse[dict])
async def inter_get_pix_refund(
    connection_id: UUID,
    e2e_id: str,
    refund_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_REFUND,
    )
    return SuccessResponse(data=_data(await provider.get_pix_refund(provider_context, e2e_id=e2e_id, refund_id=refund_id)))


@router.post("/connections/{connection_id}/payments/boleto", response_model=SuccessResponse[dict])
async def inter_pay_boleto(
    connection_id: UUID,
    payload: InterBoletoPaymentRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_BOLETO,
    )
    return SuccessResponse(data=_data(await provider.pay_boleto(provider_context, payload.provider_payload())))


@router.get("/connections/{connection_id}/payments/boleto", response_model=SuccessResponse[list])
async def inter_list_boleto_payments(
    connection_id: UUID,
    start_date: date,
    end_date: date,
    barcode: str | None = None,
    transaction_code: str | None = None,
    filter_date_by: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_BOLETO,
    )
    result = await provider.list_boleto_payments(
        provider_context,
        start_date=start_date,
        end_date=end_date,
        filters={
            "codBarraLinhaDigitavel": barcode,
            "codigoTransacao": transaction_code,
            "filtrarDataPor": filter_date_by,
        },
    )
    return SuccessResponse(data=_data(result))


@router.delete("/connections/{connection_id}/payments/boleto/{transaction_code}", response_model=SuccessResponse[dict])
async def inter_cancel_boleto_payment(
    connection_id: UUID,
    transaction_code: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_BOLETO,
    )
    await provider.cancel_boleto_payment(provider_context, transaction_code)
    return SuccessResponse(data={"cancelled": True, "transaction_code": transaction_code})


@router.post("/connections/{connection_id}/payments/darf", response_model=SuccessResponse[dict])
async def inter_pay_darf(
    connection_id: UUID,
    payload: InterDarfPaymentRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_TAX,
    )
    return SuccessResponse(data=_data(await provider.pay_darf(provider_context, payload.provider_payload())))


@router.get("/connections/{connection_id}/payments/darf", response_model=SuccessResponse[list])
async def inter_list_darf_payments(
    connection_id: UUID,
    start_date: date,
    end_date: date,
    request_code: str | None = None,
    revenue_code: str | None = None,
    filter_date_by: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_TAX,
    )
    result = await provider.list_darf_payments(
        provider_context,
        start_date=start_date,
        end_date=end_date,
        request_code=request_code,
        revenue_code=revenue_code,
        filter_date_by=filter_date_by,
    )
    return SuccessResponse(data=_data(result))


@router.post("/connections/{connection_id}/payments/batches", response_model=SuccessResponse[dict])
async def inter_create_payment_batch(
    connection_id: UUID,
    payload: InterPaymentBatchRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_BOLETO,
    )
    result = await provider.create_payment_batch(
        provider_context,
        my_identifier=payload.my_identifier,
        payments=payload.payments,
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/payments/batches/{batch_id}", response_model=SuccessResponse[dict])
async def inter_get_payment_batch(
    connection_id: UUID,
    batch_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PAYMENT_BOLETO,
    )
    return SuccessResponse(data=_data(await provider.get_payment_batch(provider_context, batch_id)))


@router.post("/connections/{connection_id}/payments/pix", response_model=SuccessResponse[dict])
async def inter_pay_pix(
    connection_id: UUID,
    payload: InterPixPaymentRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_PAYMENT,
    )
    return SuccessResponse(data=_data(await provider.pay_pix(provider_context, payload.provider_payload())))


@router.get("/connections/{connection_id}/payments/pix/{request_code}", response_model=SuccessResponse[dict])
async def inter_get_pix_payment(
    connection_id: UUID,
    request_code: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_PAYMENT,
    )
    return SuccessResponse(data=_data(await provider.get_pix_payment(provider_context, request_code)))


@router.post("/connections/{connection_id}/pix/locations", response_model=SuccessResponse[dict])
async def inter_create_pix_location(
    connection_id: UUID,
    payload: InterPixLocationRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COB,
    )
    return SuccessResponse(data=_data(await provider.create_location(provider_context, payload.billing_type)))


@router.get("/connections/{connection_id}/pix/locations", response_model=SuccessResponse[dict])
async def inter_list_pix_locations(
    connection_id: UUID,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    txid_present: bool | None = None,
    billing_type: Literal["cob", "cobv"] | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COB,
    )
    result = await provider.list_locations(
        provider_context,
        start=start,
        end=end,
        page=page,
        page_size=page_size,
        txid_present=txid_present,
        billing_type=billing_type,
    )
    return SuccessResponse(data=_data(result))


@router.get("/connections/{connection_id}/pix/locations/{location_id}", response_model=SuccessResponse[dict])
async def inter_get_pix_location(
    connection_id: UUID,
    location_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COB,
    )
    return SuccessResponse(data=_data(await provider.get_location(provider_context, location_id)))


@router.delete("/connections/{connection_id}/pix/locations/{location_id}/txid", response_model=SuccessResponse[dict])
async def inter_unlink_pix_location(
    connection_id: UUID,
    location_id: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_COB,
    )
    return SuccessResponse(data=_data(await provider.unlink_location(provider_context, location_id)))


@router.put("/connections/{connection_id}/webhooks/pix/{pix_key}", response_model=SuccessResponse[dict])
async def inter_configure_pix_webhook(
    connection_id: UUID,
    pix_key: str,
    payload: InterWebhookRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_WEBHOOK,
    )
    await provider.configure_pix_webhook(provider_context, pix_key=pix_key, webhook_url=str(payload.webhook_url))
    return SuccessResponse(data={"configured": True, "pix_key": pix_key})


@router.get("/connections/{connection_id}/webhooks/pix/{pix_key}", response_model=SuccessResponse[dict])
async def inter_get_pix_webhook(
    connection_id: UUID,
    pix_key: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_WEBHOOK,
    )
    return SuccessResponse(data=_data(await provider.get_pix_webhook(provider_context, pix_key)))


@router.delete("/connections/{connection_id}/webhooks/pix/{pix_key}", response_model=SuccessResponse[dict])
async def inter_delete_pix_webhook(
    connection_id: UUID,
    pix_key: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_WEBHOOK,
    )
    await provider.delete_pix_webhook(provider_context, pix_key)
    return SuccessResponse(data={"deleted": True, "pix_key": pix_key})


@router.get("/connections/{connection_id}/webhooks/pix/callbacks", response_model=SuccessResponse[dict])
async def inter_pix_webhook_callbacks(
    connection_id: UUID,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    txid: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.PIX_WEBHOOK,
    )
    return SuccessResponse(data=_data(await provider.list_pix_webhook_callbacks(provider_context, start=start, end=end, page=page, page_size=page_size, txid=txid)))


@router.put("/connections/{connection_id}/webhooks/billing", response_model=SuccessResponse[dict])
async def inter_configure_billing_webhook(
    connection_id: UUID,
    payload: InterWebhookRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    await provider.configure_billing_webhook(provider_context, str(payload.webhook_url))
    return SuccessResponse(data={"configured": True})


@router.get("/connections/{connection_id}/webhooks/billing", response_model=SuccessResponse[dict])
async def inter_get_billing_webhook(
    connection_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    return SuccessResponse(data=_data(await provider.get_billing_webhook(provider_context)))


@router.delete("/connections/{connection_id}/webhooks/billing", response_model=SuccessResponse[dict])
async def inter_delete_billing_webhook(
    connection_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    await provider.delete_billing_webhook(provider_context)
    return SuccessResponse(data={"deleted": True})


@router.get("/connections/{connection_id}/webhooks/billing/callbacks", response_model=SuccessResponse[dict])
async def inter_billing_webhook_callbacks(
    connection_id: UUID,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    request_code: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=BankingCapability.BOLETO_GET,
    )
    return SuccessResponse(data=_data(await provider.list_billing_webhook_callbacks(provider_context, start=start, end=end, page=page, page_size=page_size, filters={"codigoSolicitacao": request_code})))


@router.put("/connections/{connection_id}/webhooks/banking/{webhook_type}", response_model=SuccessResponse[dict])
async def inter_configure_banking_webhook(
    connection_id: UUID,
    webhook_type: BankingWebhookType,
    payload: InterWebhookRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    capability = BankingCapability.PIX_PAYMENT if webhook_type == "pix-pagamento" else BankingCapability.PAYMENT_BOLETO
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=capability,
    )
    await provider.configure_banking_webhook(provider_context, webhook_type=webhook_type, webhook_url=str(payload.webhook_url))
    return SuccessResponse(data={"configured": True, "type": webhook_type})


@router.get("/connections/{connection_id}/webhooks/banking/{webhook_type}", response_model=SuccessResponse[dict])
async def inter_get_banking_webhook(
    connection_id: UUID,
    webhook_type: BankingWebhookType,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    capability = BankingCapability.PIX_PAYMENT if webhook_type == "pix-pagamento" else BankingCapability.PAYMENT_BOLETO
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=capability,
    )
    return SuccessResponse(data=_data(await provider.get_banking_webhook(provider_context, webhook_type)))


@router.delete("/connections/{connection_id}/webhooks/banking/{webhook_type}", response_model=SuccessResponse[dict])
async def inter_delete_banking_webhook(
    connection_id: UUID,
    webhook_type: BankingWebhookType,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    capability = BankingCapability.PIX_PAYMENT if webhook_type == "pix-pagamento" else BankingCapability.PAYMENT_BOLETO
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=capability,
    )
    await provider.delete_banking_webhook(provider_context, webhook_type)
    return SuccessResponse(data={"deleted": True, "type": webhook_type})


@router.get("/connections/{connection_id}/webhooks/banking/{webhook_type}/callbacks", response_model=SuccessResponse[dict])
async def inter_banking_webhook_callbacks(
    connection_id: UUID,
    webhook_type: BankingWebhookType,
    start: datetime,
    end: datetime,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=1000),
    transaction_code: str | None = None,
    end_to_end_id: str | None = None,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    capability = BankingCapability.PIX_PAYMENT if webhook_type == "pix-pagamento" else BankingCapability.PAYMENT_BOLETO
    provider, provider_context = await _inter_context(
        connection_id=connection_id,
        context=context,
        user=user,
        session=session,
        platform_session=platform_session,
        capability=capability,
    )
    result = await provider.list_banking_webhook_callbacks(
        provider_context,
        webhook_type=webhook_type,
        start=start,
        end=end,
        page=page,
        page_size=page_size,
        transaction_code=transaction_code,
        end_to_end_id=end_to_end_id,
    )
    return SuccessResponse(data=_data(result))
