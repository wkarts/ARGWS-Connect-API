from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
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
from app.core.tenant_context import TenantContext
from app.models.tenant import Document, FiscalDocument, Payment, Receipt, Receivable, Reconciliation
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.schemas.tenant import FiscalIssueInput, ReceiptIssueInput, ReconciliationInput
from app.services.audit import tenant_audit
from app.services.documents import DocumentService
from app.services.fiscal import FiscalService
from app.services.entitlements import TenantEntitlements
from app.services.receipts import ReceiptService

router = APIRouter(prefix="/api/v1", tags=["Tenant - Operações"])


@router.get("/reconciliations", response_model=SuccessResponse[list[dict]])
async def list_reconciliations(
    status: str | None = Query(default=None),
    user: AuthUser = Depends(require_permission("reconciliation.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(Reconciliation).outerjoin(Receivable, Reconciliation.receivable_id == Receivable.id)
    if status:
        stmt = stmt.where(Reconciliation.status == status.upper())
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Receivable.company_id.in_(company_ids))
    items = list((await session.execute(stmt.order_by(Reconciliation.created_at.desc()).limit(1000))).scalars())
    return SuccessResponse(data=[{
        "id": str(item.id),
        "receivable_id": str(item.receivable_id) if item.receivable_id else None,
        "payment_id": str(item.payment_id) if item.payment_id else None,
        "bank_transaction_id": item.bank_transaction_id,
        "status": item.status,
        "score": str(item.score),
        "criteria": item.criteria,
        "reconciled_by": str(item.reconciled_by) if item.reconciled_by else None,
        "reconciled_at": item.reconciled_at.isoformat() if item.reconciled_at else None,
        "created_at": item.created_at.isoformat(),
    } for item in items])


@router.post("/reconciliations", response_model=SuccessResponse[dict], status_code=201)
async def create_reconciliation(
    payload: ReconciliationInput,
    user: AuthUser = Depends(require_permission("reconciliation.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    receivable = await session.get(Receivable, payload.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    if payload.payment_id:
        payment = await session.get(Payment, payload.payment_id)
        if payment is None or payment.receivable_id != receivable.id:
            raise APIError("PAYMENT_MISMATCH", "Pagamento não pertence ao recebível informado.", 409)
        existing = await session.scalar(select(Reconciliation).where(Reconciliation.payment_id == payment.id))
        if existing:
            return SuccessResponse(data={"id": str(existing.id), "status": existing.status, "idempotent": True})
    item = Reconciliation(
        receivable_id=receivable.id,
        payment_id=payload.payment_id,
        bank_transaction_id=payload.bank_transaction_id,
        status=payload.status.upper(),
        score=payload.score,
        criteria=payload.criteria,
        reconciled_by=UUID(user.id) if payload.status.upper() == "MATCHED" else None,
        reconciled_at=datetime.now(UTC) if payload.status.upper() == "MATCHED" else None,
    )
    session.add(item)
    await session.flush()
    await tenant_audit(
        session,
        action="reconciliation.created",
        entity_type="Reconciliation",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(receivable.company_id),
        after={"status": item.status, "score": str(item.score), "payment_id": str(item.payment_id) if item.payment_id else None},
    )
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "status": item.status, "idempotent": False})


@router.post("/reconciliations/auto-match", response_model=SuccessResponse[dict])
async def auto_match_reconciliations(
    user: AuthUser = Depends(require_permission("reconciliation.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    stmt = (
        select(Payment)
        .join(Receivable, Payment.receivable_id == Receivable.id)
        .outerjoin(Reconciliation, Reconciliation.payment_id == Payment.id)
        .where(Payment.status == "CONFIRMED", Reconciliation.id.is_(None))
    )
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Receivable.company_id.in_(company_ids))
    payments = list((await session.execute(stmt.order_by(Payment.paid_at).limit(1000))).scalars())
    created = 0
    for payment in payments:
        item = Reconciliation(
            receivable_id=payment.receivable_id,
            payment_id=payment.id,
            bank_transaction_id=payment.end_to_end_id or payment.external_id,
            status="MATCHED",
            score=100,
            criteria={"receivable_relation": True, "provider": payment.provider, "amount": str(payment.amount)},
            reconciled_by=UUID(user.id),
            reconciled_at=datetime.now(UTC),
        )
        session.add(item)
        created += 1
    if created:
        await tenant_audit(
            session,
            action="reconciliation.auto_matched",
            entity_type="Reconciliation",
            actor_id=user.id,
            after={"created": created},
        )
    await session.commit()
    return SuccessResponse(data={"matched": created})


@router.post("/receipts", response_model=SuccessResponse[dict], status_code=201)
async def issue_receipt(
    payload: ReceiptIssueInput,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("receipts.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    payment = await session.get(Payment, payload.payment_id)
    if payment is None:
        raise APIError("PAYMENT_NOT_FOUND", "Pagamento não encontrado.", 404)
    receivable = await session.get(Receivable, payment.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    service = ReceiptService(session, bucket=context.storage_bucket)
    item = await service.issue(payload.payment_id)
    document = await session.scalar(select(Document).where(
        Document.entity_type == "Receipt", Document.entity_id == str(item.id), Document.document_type == "RECEIPT_PDF"
    ))
    url = await DocumentService(session, bucket=context.storage_bucket).signed_url(document) if document else None
    await tenant_audit(
        session,
        action="receipt.issued",
        entity_type="Receipt",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        after={"number": item.number, "amount": str(item.amount)},
    )
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "number": item.number, "amount": str(item.amount), "issued_at": item.issued_at.isoformat(), "download_url": url})


@router.get("/receipts", response_model=SuccessResponse[list[dict]])
async def list_receipts(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("receipts.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(Receipt)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Receipt.company_id.in_(company_ids))
    items = list((await session.execute(stmt.order_by(Receipt.issued_at.desc()).limit(1000))).scalars())
    documents = DocumentService(session, bucket=context.storage_bucket)
    output: list[dict] = []
    for item in items:
        document = await session.scalar(select(Document).where(
            Document.entity_type == "Receipt", Document.entity_id == str(item.id), Document.document_type == "RECEIPT_PDF"
        ))
        output.append({
            "id": str(item.id), "number": item.number, "company_id": str(item.company_id),
            "customer_id": str(item.customer_id), "receivable_id": str(item.receivable_id),
            "payment_id": str(item.payment_id), "amount": str(item.amount), "issued_at": item.issued_at.isoformat(),
            "download_url": await documents.signed_url(document) if document else None,
        })
    return SuccessResponse(data=output)


@router.post("/fiscal-documents", response_model=SuccessResponse[dict], status_code=201)
async def issue_fiscal_document(
    payload: FiscalIssueInput,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("fiscal.create")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    entitlements.require_feature("nfse")
    receivable = await session.get(Receivable, payload.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    item = await FiscalService(session, bucket=context.storage_bucket).issue(payload.receivable_id, payload.provider)
    docs = DocumentService(session, bucket=context.storage_bucket)
    pdf = await session.scalar(select(Document).where(
        Document.entity_type == "FiscalDocument", Document.entity_id == str(item.id), Document.document_type == "NFSE_PDF"
    ))
    xml = await session.scalar(select(Document).where(
        Document.entity_type == "FiscalDocument", Document.entity_id == str(item.id), Document.document_type == "NFSE_XML"
    ))
    await tenant_audit(
        session,
        action="fiscal_document.issued",
        entity_type="FiscalDocument",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        after={"provider": item.provider, "number": item.number, "status": item.status},
    )
    await session.commit()
    return SuccessResponse(data={
        "id": str(item.id), "provider": item.provider, "number": item.number,
        "verification_code": item.verification_code, "status": item.status,
        "pdf_url": await docs.signed_url(pdf) if pdf else None,
        "xml_url": await docs.signed_url(xml) if xml else None,
    })


@router.get("/fiscal-documents", response_model=SuccessResponse[list[dict]])
async def list_fiscal_documents(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("fiscal.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(FiscalDocument)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(FiscalDocument.company_id.in_(company_ids))
    items = list((await session.execute(stmt.order_by(FiscalDocument.created_at.desc()).limit(1000))).scalars())
    documents = DocumentService(session, bucket=context.storage_bucket)
    output: list[dict] = []
    for item in items:
        pdf = await session.scalar(select(Document).where(Document.object_key == item.pdf_object_key)) if item.pdf_object_key else None
        xml = await session.scalar(select(Document).where(Document.object_key == item.xml_object_key)) if item.xml_object_key else None
        output.append({
            "id": str(item.id), "company_id": str(item.company_id), "customer_id": str(item.customer_id),
            "receivable_id": str(item.receivable_id) if item.receivable_id else None, "provider": item.provider,
            "external_id": item.external_id, "number": item.number, "verification_code": item.verification_code,
            "amount": str(item.amount), "status": item.status, "issued_at": item.issued_at.isoformat() if item.issued_at else None,
            "last_error": item.last_error, "pdf_url": await documents.signed_url(pdf) if pdf else None,
            "xml_url": await documents.signed_url(xml) if xml else None,
        })
    return SuccessResponse(data=output)


@router.get("/documents", response_model=SuccessResponse[list[dict]])
async def list_documents(
    entity_type: str | None = Query(default=None),
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("documents.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(Document)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Document.company_id.in_(company_ids))
    if entity_type:
        stmt = stmt.where(Document.entity_type == entity_type)
    items = list((await session.execute(stmt.order_by(Document.created_at.desc()).limit(1000))).scalars())
    service = DocumentService(session, bucket=context.storage_bucket)
    return SuccessResponse(data=[{
        "id": str(item.id), "company_id": str(item.company_id) if item.company_id else None,
        "entity_type": item.entity_type, "entity_id": item.entity_id, "document_type": item.document_type,
        "filename": item.filename, "mime_type": item.mime_type, "size_bytes": item.size_bytes,
        "sha256": item.sha256, "version": item.version, "created_at": item.created_at.isoformat(),
        "download_url": await service.signed_url(item),
    } for item in items])
