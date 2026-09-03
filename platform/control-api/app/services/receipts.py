from __future__ import annotations

import io
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.tenant import Company, Customer, Payment, Receipt, Receivable
from app.services.documents import DocumentService


def _currency(value: Decimal) -> str:
    formatted = f"{value:,.2f}"
    return "R$ " + formatted.replace(",", "X").replace(".", ",").replace("X", ".")


class ReceiptService:
    def __init__(self, session: AsyncSession, *, bucket: str) -> None:
        self.session = session
        self.documents = DocumentService(session, bucket=bucket)

    async def issue(self, payment_id: UUID) -> Receipt:
        existing = await self.session.scalar(select(Receipt).where(Receipt.payment_id == payment_id))
        if existing is not None:
            return existing
        payment = await self.session.get(Payment, payment_id)
        if payment is None or payment.status != "CONFIRMED":
            raise APIError("PAYMENT_NOT_CONFIRMED", "Pagamento confirmado não encontrado.", 404)
        receivable = await self.session.get(Receivable, payment.receivable_id)
        if receivable is None:
            raise APIError("RECEIVABLE_NOT_FOUND", "Recebível relacionado não encontrado.", 404)
        company = await self.session.get(Company, receivable.company_id)
        customer = await self.session.get(Customer, receivable.customer_id)
        if company is None or customer is None:
            raise APIError("RECEIPT_PARTIES_NOT_FOUND", "Empresa ou cliente do recibo não encontrado.", 409)

        number = f"REC-{payment.paid_at.year}-{payment.id.hex[:12].upper()}"
        issued_at = datetime.now(UTC)
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        pdf.setTitle(f"Recibo {number}")
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawCentredString(width / 2, height - 28 * mm, "RECIBO DE PAGAMENTO")
        pdf.setFont("Helvetica", 10)
        pdf.drawCentredString(width / 2, height - 36 * mm, number)
        y = height - 55 * mm
        pdf.setFont("Helvetica", 11)
        lines = [
            f"Recebemos de {customer.name}",
            f"CPF/CNPJ: {customer.tax_id or 'não informado'}",
            f"a importância de {_currency(Decimal(payment.amount))}",
            f"referente a: {receivable.description}",
            f"documento financeiro: {receivable.document_number}",
            f"competência: {receivable.competence}",
            f"pago em: {payment.paid_at.astimezone(UTC).strftime('%d/%m/%Y %H:%M UTC')}",
            f"forma de pagamento: {payment.payment_method}",
            f"identificador: {payment.external_id}",
        ]
        for line in lines:
            pdf.drawString(24 * mm, y, line[:120])
            y -= 9 * mm
        y -= 8 * mm
        pdf.line(25 * mm, y, width - 25 * mm, y)
        y -= 9 * mm
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(24 * mm, y, company.legal_name)
        y -= 7 * mm
        pdf.setFont("Helvetica", 10)
        pdf.drawString(24 * mm, y, f"CNPJ/CPF: {company.tax_id}")
        pdf.setFont("Helvetica", 7)
        pdf.drawString(24 * mm, 16 * mm, f"Documento gerado eletronicamente em {issued_at.isoformat()}. SHA-256 registrado no sistema.")
        pdf.save()
        content = buffer.getvalue()

        receipt = Receipt(
            company_id=company.id,
            customer_id=customer.id,
            receivable_id=receivable.id,
            payment_id=payment.id,
            number=number,
            amount=payment.amount,
            issued_at=issued_at,
        )
        self.session.add(receipt)
        await self.session.flush()
        document = await self.documents.store(
            company_id=company.id,
            entity_type="Receipt",
            entity_id=str(receipt.id),
            document_type="RECEIPT_PDF",
            filename=f"{number}.pdf",
            content=content,
            content_type="application/pdf",
            folder="receipts",
        )
        receipt.object_key = document.object_key
        receipt.sha256 = document.sha256
        await self.session.commit()
        await self.session.refresh(receipt)
        return receipt
