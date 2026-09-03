from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Response, UploadFile
from reportlab.graphics import renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant_context_dep, get_tenant_db
from app.core.errors import APIError
from app.core.security import hash_api_key
from app.core.tenant_context import TenantContext
from app.models.tenant import Charge, Company, Customer, PublicPaymentLink, Receivable
from app.schemas.common import SuccessResponse
from app.services.documents import DocumentService

router = APIRouter(prefix="/api/public/v1", tags=["Portal público de cobrança"])

_ALLOWED_PROOF_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
_MAX_PROOF_BYTES = 10 * 1024 * 1024


async def _resolve_payment_link(
    token: str,
    session: AsyncSession,
    *,
    lock: bool = False,
) -> tuple[PublicPaymentLink, Receivable, Company, Customer, Charge | None]:
    if len(token) < 24:
        raise APIError("PAYMENT_LINK_INVALID", "Link de pagamento inválido.", 404)
    stmt = select(PublicPaymentLink).where(
        PublicPaymentLink.token_hash == hash_api_key(token),
        PublicPaymentLink.is_active.is_(True),
    )
    if lock:
        stmt = stmt.with_for_update()
    item = await session.scalar(stmt)
    if item is None:
        raise APIError("PAYMENT_LINK_NOT_FOUND", "Link de pagamento inválido ou desativado.", 404)
    now = datetime.now(UTC)
    if item.expires_at and item.expires_at <= now:
        item.is_active = False
        await session.commit()
        raise APIError("PAYMENT_LINK_EXPIRED", "Este link de pagamento expirou.", 410)
    if item.max_views is not None and item.view_count >= item.max_views:
        item.is_active = False
        await session.commit()
        raise APIError("PAYMENT_LINK_LIMIT_REACHED", "Este link atingiu o limite de acessos.", 410)

    receivable = await session.get(Receivable, item.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Cobrança não encontrada.", 404)
    company = await session.get(Company, receivable.company_id)
    customer = await session.get(Customer, receivable.customer_id)
    if company is None or customer is None:
        raise APIError("PAYMENT_LINK_INCOMPLETE", "Dados da cobrança estão incompletos.", 409)
    charge = await session.scalar(
        select(Charge)
        .where(Charge.receivable_id == receivable.id, Charge.status.notin_(["CANCELLED", "FAILED", "EXPIRED"]))
        .order_by(Charge.created_at.desc())
    )
    return item, receivable, company, customer, charge


def _masked_document(value: str | None) -> str:
    raw = value or ""
    return "*" * max(len(raw) - 4, 0) + raw[-4:] if len(raw) > 4 else raw


def _charge_payload(token: str, charge: Charge | None) -> dict[str, Any] | None:
    if charge is None:
        return None
    return {
        "type": charge.charge_type,
        "provider": charge.provider,
        "status": charge.status,
        "digitable_line": charge.digitable_line,
        "barcode": charge.barcode,
        "pix_copy_paste": charge.pix_copy_paste,
        # Nunca devolvemos a rota autenticada do provider para o portal público.
        "document_url": f"/api/public/v1/payment-links/{token}/document" if charge.digitable_line else None,
        "pix_qr_url": f"/api/public/v1/payment-links/{token}/pix-qr.svg" if charge.pix_copy_paste else None,
        "proof_upload_url": f"/api/public/v1/payment-links/{token}/proof",
    }


@router.get("/payment-links/{token}", response_model=SuccessResponse[dict])
async def public_payment_link(
    token: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item, receivable, company, customer, charge = await _resolve_payment_link(token, session, lock=True)
    item.view_count += 1
    item.last_viewed_at = datetime.now(UTC)
    await session.commit()
    return SuccessResponse(
        data={
            "tenant": {"slug": context.slug, "hostname": context.hostname},
            "company": {
                "name": company.trade_name or company.legal_name,
                "tax_id": company.tax_id,
                "branding": company.branding,
            },
            "customer": {"name": customer.name, "document": _masked_document(customer.tax_id)},
            "receivable": {
                "id": str(receivable.id),
                "document_number": receivable.document_number,
                "description": receivable.description,
                "competence": receivable.competence,
                "due_date": receivable.due_date.isoformat(),
                "amount": str(receivable.balance),
                "status": receivable.status,
            },
            "charge": _charge_payload(token, charge),
        }
    )


@router.get("/payment-links/{token}/pix-qr.svg")
async def public_pix_qr(
    token: str,
    _: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> Response:
    _, _, _, _, charge = await _resolve_payment_link(token, session)
    payload = charge.pix_copy_paste if charge else None
    if not payload:
        raise APIError("PIX_NOT_AVAILABLE", "Esta cobrança não possui PIX disponível.", 404)
    widget = QrCodeWidget(payload)
    x1, y1, x2, y2 = widget.getBounds()
    size = 240
    width = max(x2 - x1, 1)
    height = max(y2 - y1, 1)
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, -x1, -y1])
    drawing.add(widget)
    svg = renderSVG.drawToString(drawing)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/payment-links/{token}/document")
async def public_boleto_document(
    token: str,
    _: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> Response:
    _, receivable, company, customer, charge = await _resolve_payment_link(token, session)
    if charge is None or not charge.digitable_line:
        raise APIError("BOLETO_NOT_AVAILABLE", "Esta cobrança não possui boleto disponível.", 404)

    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4)
    page_width, page_height = A4
    pdf.setTitle(f"Boleto {receivable.document_number}")
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(48, page_height - 60, company.trade_name or company.legal_name)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(48, page_height - 82, "Documento de cobrança")
    pdf.line(48, page_height - 96, page_width - 48, page_height - 96)
    rows = [
        ("Pagador", customer.name),
        ("Documento", receivable.document_number),
        ("Vencimento", receivable.due_date.strftime("%d/%m/%Y")),
        ("Valor", f"R$ {receivable.balance:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")),
        ("Linha digitável", charge.digitable_line),
    ]
    y = page_height - 126
    for label, value in rows:
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(48, y, f"{label}:")
        pdf.setFont("Helvetica", 9)
        text = pdf.beginText(145, y)
        text.setFont("Helvetica", 9)
        text.textLines(str(value))
        pdf.drawText(text)
        y -= 30
    if charge.pix_copy_paste:
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(48, y, "PIX copia e cola disponível no portal de cobrança.")
    pdf.setFont("Helvetica", 8)
    pdf.drawString(48, 42, "Documento gerado pela plataforma a partir dos dados atuais da cobrança.")
    pdf.save()
    filename = f"boleto-{receivable.document_number}.pdf".replace("/", "-")
    return Response(
        content=output.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/payment-links/{token}/proof", response_model=SuccessResponse[dict], status_code=201)
async def upload_payment_proof(
    token: str,
    file: UploadFile = File(...),
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    _, receivable, _, _, _ = await _resolve_payment_link(token, session)
    content_type = (file.content_type or "application/octet-stream").lower()
    if content_type not in _ALLOWED_PROOF_TYPES:
        raise APIError("PAYMENT_PROOF_TYPE_INVALID", "Envie o comprovante em PDF, PNG, JPG ou WEBP.", 422)
    content = await file.read(_MAX_PROOF_BYTES + 1)
    if not content or len(content) > _MAX_PROOF_BYTES:
        raise APIError("PAYMENT_PROOF_SIZE_INVALID", "O comprovante deve ter até 10 MB.", 422)
    filename = Path(file.filename or "comprovante").name[:180]
    document = await DocumentService(session, bucket=context.storage_bucket).store(
        company_id=receivable.company_id,
        entity_type="Receivable",
        entity_id=str(receivable.id),
        document_type="PAYMENT_PROOF",
        filename=filename,
        content=content,
        content_type=content_type,
        folder="payment-proofs",
        immutable=True,
    )
    await session.commit()
    return SuccessResponse(
        data={
            "id": str(document.id),
            "filename": document.filename,
            "size_bytes": document.size_bytes,
            "sha256": document.sha256,
            "status": "RECEBIDO",
        }
    )
