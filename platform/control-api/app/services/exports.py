from __future__ import annotations

import csv
import io
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.tenant import Charge, Company, Customer, ExportJob, Payment, Receivable
from app.providers.storage import S3StorageProvider


_HEADER_LABELS: dict[str, str] = {
    "id": "Identificador",
    "company_id": "Empresa ID",
    "company_name": "Empresa",
    "customer_id": "Cliente ID",
    "customer_name": "Cliente",
    "receivable_id": "Título ID",
    "charge_id": "Cobrança ID",
    "bank_agreement_id": "Convênio ID",
    "document_number": "Documento",
    "competence": "Competência",
    "description": "Descrição",
    "issue_date": "Emissão",
    "due_date": "Vencimento",
    "original_amount": "Valor original",
    "paid_amount": "Valor pago",
    "balance": "Saldo",
    "status": "Situação",
    "source": "Origem",
    "person_type": "Tipo de pessoa",
    "name": "Nome",
    "trade_name": "Nome fantasia",
    "tax_id": "CPF/CNPJ",
    "email": "E-mail",
    "phone": "Telefone",
    "whatsapp": "WhatsApp",
    "is_active": "Ativo",
    "created_at": "Criado em",
    "provider": "Provedor",
    "external_id": "Identificador externo",
    "end_to_end_id": "EndToEndId",
    "amount": "Valor",
    "paid_at": "Pago em",
    "payment_method": "Forma de pagamento",
    "charge_type": "Tipo de cobrança",
    "our_number": "Nosso número",
    "txid": "TXID",
    "registered_at": "Registrado em",
}

_STATUS_LABELS = {
    "OPEN": "Aberto",
    "REGISTERED": "Registrado",
    "OVERDUE": "Vencido",
    "PAID": "Pago",
    "PARTIALLY_PAID": "Pago parcialmente",
    "CANCELLED": "Cancelado",
    "WRITTEN_OFF": "Baixado como perda",
    "REVERSED": "Estornado",
    "NEGOTIATED": "Negociado",
    "PENDING": "Pendente",
    "COMPLETED": "Concluído",
    "FAILED": "Falhou",
}


class ExportService:
    def __init__(self, session: AsyncSession, *, bucket: str) -> None:
        self.session = session
        self.bucket = bucket
        self.storage = S3StorageProvider()

    @staticmethod
    def _value(value: Any) -> Any:
        if value is None:
            return ""
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, bool):
            return "Sim" if value else "Não"
        if isinstance(value, (dict, list, tuple, set)):
            return json.dumps(value, ensure_ascii=False, default=str)
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if isinstance(value, (str, int, float)):
            return value
        return str(value)

    @staticmethod
    def _display(header: str, value: Any) -> str:
        converted = ExportService._value(value)
        if header == "status":
            return _STATUS_LABELS.get(str(converted).upper(), str(converted))
        if isinstance(value, Decimal) or header in {
            "original_amount", "paid_amount", "balance", "amount"
        }:
            try:
                return f"R$ {float(converted):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            except (TypeError, ValueError):
                return str(converted)
        if header in {"issue_date", "due_date", "paid_at", "created_at", "registered_at"} and converted:
            try:
                parsed = datetime.fromisoformat(str(converted).replace("Z", "+00:00"))
                return parsed.strftime("%d/%m/%Y %H:%M")
            except ValueError:
                try:
                    return date.fromisoformat(str(converted)[:10]).strftime("%d/%m/%Y")
                except ValueError:
                    return str(converted)
        return str(converted)

    async def _dataset(self, export_type: str, filters: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
        export_type = export_type.upper()
        if export_type == "RECEIVABLES":
            stmt = (
                select(Receivable, Company.legal_name, Company.trade_name, Customer.name)
                .join(Company, Company.id == Receivable.company_id)
                .join(Customer, Customer.id == Receivable.customer_id)
                .order_by(Receivable.due_date, Receivable.document_number)
            )
            if filters.get("status"):
                stmt = stmt.where(Receivable.status == str(filters["status"]).upper())
            if filters.get("company_id"):
                stmt = stmt.where(Receivable.company_id == UUID(str(filters["company_id"])))
            if filters.get("customer_id"):
                stmt = stmt.where(Receivable.customer_id == UUID(str(filters["customer_id"])))
            if filters.get("due_from"):
                stmt = stmt.where(Receivable.due_date >= date.fromisoformat(str(filters["due_from"])))
            if filters.get("due_to"):
                stmt = stmt.where(Receivable.due_date <= date.fromisoformat(str(filters["due_to"])))
            rows_db = list((await self.session.execute(stmt.limit(100000))).all())
            headers = [
                "document_number", "company_name", "customer_name", "competence", "description",
                "issue_date", "due_date", "original_amount", "paid_amount", "balance", "status", "source",
            ]
            rows = [
                [
                    item.document_number,
                    trade_name or legal_name,
                    customer_name,
                    item.competence,
                    item.description,
                    item.issue_date,
                    item.due_date,
                    item.original_amount,
                    item.paid_amount,
                    item.balance,
                    item.status,
                    item.source,
                ]
                for item, legal_name, trade_name, customer_name in rows_db
            ]
            return headers, rows
        if export_type == "CUSTOMERS":
            stmt = select(Customer).order_by(Customer.name)
            items = list((await self.session.scalars(stmt.limit(100000))).all())
            headers = ["id", "person_type", "name", "trade_name", "tax_id", "email", "phone", "whatsapp", "is_active", "created_at"]
            return headers, [[getattr(item, name) for name in headers] for item in items]
        if export_type == "PAYMENTS":
            items = list((await self.session.scalars(select(Payment).order_by(Payment.paid_at.desc()).limit(100000))).all())
            headers = ["id", "receivable_id", "charge_id", "provider", "external_id", "end_to_end_id", "amount", "paid_at", "payment_method", "status"]
            return headers, [[getattr(item, name) for name in headers] for item in items]
        if export_type == "CHARGES":
            items = list((await self.session.scalars(select(Charge).order_by(Charge.created_at.desc()).limit(100000))).all())
            headers = ["id", "receivable_id", "bank_agreement_id", "charge_type", "provider", "external_id", "our_number", "txid", "status", "registered_at", "created_at"]
            return headers, [[getattr(item, name) for name in headers] for item in items]
        raise APIError("EXPORT_TYPE_UNSUPPORTED", "Tipo de exportação não suportado.", 422, {"export_type": export_type})

    def _pdf(self, export_type: str, headers: list[str], rows: list[list[Any]], filters: dict[str, Any]) -> bytes:
        output = io.BytesIO()
        document = SimpleDocTemplate(
            output,
            pagesize=landscape(A4),
            rightMargin=8 * mm,
            leftMargin=8 * mm,
            topMargin=10 * mm,
            bottomMargin=10 * mm,
            title="Relatório financeiro",
            author="Connect|API Platform",
        )
        styles = getSampleStyleSheet()
        title = styles["Title"]
        title.fontSize = 15
        title.leading = 18
        subtitle = ParagraphStyle("report-subtitle", parent=styles["Normal"], fontSize=8, leading=11, textColor=colors.HexColor("#475569"), alignment=TA_LEFT)
        cell = ParagraphStyle("report-cell", parent=styles["Normal"], fontSize=6.5, leading=8)
        heading = ParagraphStyle("report-heading", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)
        story: list[Any] = [
            Paragraph("Relatório de carteira financeira" if export_type == "RECEIVABLES" else f"Relatório {export_type}", title),
            Paragraph(f"Gerado em {datetime.now().astimezone().strftime('%d/%m/%Y %H:%M')} · {len(rows)} registro(s)", subtitle),
        ]
        active_filters = [f"{key}: {value}" for key, value in filters.items() if value not in (None, "")]
        if active_filters:
            story.extend([Spacer(1, 2 * mm), Paragraph("Filtros: " + " · ".join(active_filters), subtitle)])
        story.append(Spacer(1, 4 * mm))
        table_data = [[Paragraph(_HEADER_LABELS.get(header, header), heading) for header in headers]]
        for row in rows:
            table_data.append([
                Paragraph(self._display(header, value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), cell)
                for header, value in zip(headers, row, strict=False)
            ])
        available_width = landscape(A4)[0] - 16 * mm
        col_width = available_width / max(len(headers), 1)
        table = Table(table_data, repeatRows=1, colWidths=[col_width] * len(headers), hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(table)
        document.build(story)
        return output.getvalue()

    async def create(self, *, export_type: str, format_name: str, filters: dict[str, Any], requested_by: UUID | None) -> ExportJob:
        item = ExportJob(export_type=export_type.upper(), status="PROCESSING", filters=filters, format=format_name.upper(), requested_by=requested_by)
        self.session.add(item)
        await self.session.flush()
        try:
            headers, rows = await self._dataset(item.export_type, filters)
            output = io.BytesIO()
            if item.format == "CSV":
                text = io.StringIO()
                writer = csv.writer(text, delimiter=";", lineterminator="\n")
                writer.writerow([_HEADER_LABELS.get(header, header) for header in headers])
                for row in rows:
                    writer.writerow([self._display(header, value) for header, value in zip(headers, row, strict=False)])
                content = text.getvalue().encode("utf-8-sig")
                extension, mime = "csv", "text/csv"
            elif item.format == "XLSX":
                workbook = Workbook(write_only=True)
                sheet = workbook.create_sheet(title=item.export_type[:31])
                sheet.append([_HEADER_LABELS.get(header, header) for header in headers])
                for row in rows:
                    sheet.append([self._value(value) for value in row])
                workbook.save(output)
                content = output.getvalue()
                extension = "xlsx"
                mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            elif item.format == "PDF":
                content = self._pdf(item.export_type, headers, rows, filters)
                extension, mime = "pdf", "application/pdf"
            else:
                raise APIError("EXPORT_FORMAT_UNSUPPORTED", "Formato de exportação não suportado.", 422, {"format": item.format})
            filename = f"{item.export_type.lower()}-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.{extension}"
            key = f"exports/{item.id}/{filename}"
            stored = await self.storage.put_bytes(self.bucket, key, content, mime)
            item.object_key = stored.key
            item.sha256 = stored.sha256
            item.size_bytes = stored.size
            item.status = "COMPLETED"
            item.finished_at = datetime.now(UTC)
        except Exception as exc:
            item.status = "FAILED"
            item.last_error = str(exc)[:4000]
            item.finished_at = datetime.now(UTC)
            await self.session.commit()
            raise
        await self.session.commit()
        await self.session.refresh(item)
        return item

    async def signed_url(self, item: ExportJob) -> str | None:
        if not item.object_key:
            return None
        return await self.storage.presigned_url(self.bucket, item.object_key, expires=900)
