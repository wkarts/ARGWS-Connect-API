from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.tenant import BankStatementImport, BankTransaction
from app.providers.storage import S3StorageProvider


@dataclass(frozen=True, slots=True)
class ParsedTransaction:
    external_id: str
    transaction_date: date
    posted_at: datetime | None
    amount: Decimal
    transaction_type: str
    description: str
    document_number: str | None = None
    end_to_end_id: str | None = None
    raw_payload: dict[str, str] | None = None


class BankStatementService:
    """Importa extratos OFX/CSV com deduplicação por conta e identificador externo."""

    def __init__(self, session: AsyncSession, *, bucket: str) -> None:
        self.session = session
        self.bucket = bucket
        self.storage = S3StorageProvider()

    @staticmethod
    def _parse_date(value: str) -> date:
        value = value.strip()
        for fmt in ("%Y%m%d", "%Y-%m-%d", "%d/%m/%Y", "%Y%m%d%H%M%S"):
            try:
                return datetime.strptime(value[: len(datetime.now().strftime(fmt))], fmt).date()
            except ValueError:
                continue
        digits = re.sub(r"\D", "", value)
        if len(digits) >= 8:
            return datetime.strptime(digits[:8], "%Y%m%d").date()
        raise APIError("BANK_STATEMENT_DATE_INVALID", "Data inválida no extrato.", 422, {"value": value})

    @staticmethod
    def _parse_amount(value: str) -> Decimal:
        normalized = value.strip().replace("R$", "").replace(" ", "")
        if "," in normalized and "." in normalized:
            normalized = normalized.replace(".", "").replace(",", ".")
        elif "," in normalized:
            normalized = normalized.replace(",", ".")
        try:
            return Decimal(normalized)
        except InvalidOperation as exc:
            raise APIError("BANK_STATEMENT_AMOUNT_INVALID", "Valor inválido no extrato.", 422, {"value": value}) from exc

    @staticmethod
    def _extract_ofx_tag(block: str, tag: str) -> str | None:
        match = re.search(rf"<{tag}>([^<\r\n]+)", block, flags=re.IGNORECASE)
        return match.group(1).strip() if match else None

    def parse_ofx(self, content: bytes) -> list[ParsedTransaction]:
        text = content.decode("utf-8", errors="replace")
        blocks = re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>|</BANKTRANLIST>))", text, flags=re.I | re.S)
        output: list[ParsedTransaction] = []
        for index, block in enumerate(blocks, start=1):
            fitid = self._extract_ofx_tag(block, "FITID") or hashlib.sha256(block.encode()).hexdigest()[:40]
            amount = self._parse_amount(self._extract_ofx_tag(block, "TRNAMT") or "0")
            posted = self._extract_ofx_tag(block, "DTPOSTED") or self._extract_ofx_tag(block, "DTUSER")
            if not posted:
                raise APIError("BANK_STATEMENT_DATE_MISSING", "Transação OFX sem data.", 422, {"index": index})
            memo = self._extract_ofx_tag(block, "MEMO") or self._extract_ofx_tag(block, "NAME") or "Movimento bancário"
            checknum = self._extract_ofx_tag(block, "CHECKNUM") or self._extract_ofx_tag(block, "REFNUM")
            end_to_end = None
            pix_match = re.search(r"\bE\d{31}\b", block, flags=re.I)
            if pix_match:
                end_to_end = pix_match.group(0)
            output.append(
                ParsedTransaction(
                    external_id=fitid,
                    transaction_date=self._parse_date(posted),
                    posted_at=None,
                    amount=amount,
                    transaction_type="CREDIT" if amount >= 0 else "DEBIT",
                    description=memo[:2000],
                    document_number=checknum,
                    end_to_end_id=end_to_end,
                    raw_payload={"source": "OFX", "index": str(index)},
                )
            )
        if not output:
            raise APIError("BANK_STATEMENT_EMPTY", "Nenhuma transação OFX foi encontrada.", 422)
        return output

    def parse_csv(self, content: bytes) -> list[ParsedTransaction]:
        text = content.decode("utf-8-sig", errors="replace")
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        except csv.Error:
            dialect = csv.excel
            dialect.delimiter = ";"
        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        output: list[ParsedTransaction] = []
        for index, raw in enumerate(reader, start=2):
            row = {str(k or "").strip().lower(): str(v or "").strip() for k, v in raw.items()}
            date_value = row.get("data") or row.get("date") or row.get("transaction_date") or row.get("dtposted")
            amount_value = row.get("valor") or row.get("amount") or row.get("trnamt")
            description = row.get("descricao") or row.get("description") or row.get("memo") or "Movimento bancário"
            if not date_value or amount_value is None:
                continue
            amount = self._parse_amount(amount_value)
            external = row.get("id") or row.get("external_id") or row.get("fitid")
            if not external:
                external = hashlib.sha256(f"{index}|{date_value}|{amount}|{description}".encode()).hexdigest()[:40]
            output.append(
                ParsedTransaction(
                    external_id=external,
                    transaction_date=self._parse_date(date_value),
                    posted_at=None,
                    amount=amount,
                    transaction_type=(row.get("tipo") or row.get("type") or ("CREDIT" if amount >= 0 else "DEBIT")).upper(),
                    description=description[:2000],
                    document_number=row.get("documento") or row.get("document_number"),
                    end_to_end_id=row.get("endtoendid") or row.get("end_to_end_id"),
                    raw_payload=row,
                )
            )
        if not output:
            raise APIError("BANK_STATEMENT_EMPTY", "Nenhuma transação CSV válida foi encontrada.", 422)
        return output

    async def import_file(
        self,
        *,
        bank_account_id: UUID,
        filename: str,
        content: bytes,
        format_name: str | None = None,
    ) -> BankStatementImport:
        if not content:
            raise APIError("BANK_STATEMENT_EMPTY_FILE", "O arquivo de extrato está vazio.", 422)
        digest = hashlib.sha256(content).hexdigest()
        existing = await self.session.scalar(select(BankStatementImport).where(BankStatementImport.sha256 == digest))
        if existing is not None:
            return existing
        normalized = (format_name or filename.rsplit(".", 1)[-1]).upper()
        if normalized == "OFX":
            parsed = self.parse_ofx(content)
            content_type = "application/x-ofx"
        elif normalized in {"CSV", "TXT"}:
            parsed = self.parse_csv(content)
            normalized = "CSV"
            content_type = "text/csv"
        else:
            raise APIError("BANK_STATEMENT_FORMAT_UNSUPPORTED", "Formato de extrato não suportado.", 422, {"format": normalized})

        key = f"bank-statements/{bank_account_id}/{digest[:16]}-{filename}"
        stored = await self.storage.put_bytes(self.bucket, key, content, content_type)
        job = BankStatementImport(
            bank_account_id=bank_account_id,
            filename=filename,
            format=normalized,
            object_key=stored.key,
            sha256=digest,
            status="PROCESSING",
        )
        self.session.add(job)
        await self.session.flush()

        imported = duplicates = errors = 0
        for item in parsed:
            duplicate = await self.session.scalar(
                select(BankTransaction.id).where(
                    BankTransaction.bank_account_id == bank_account_id,
                    BankTransaction.external_id == item.external_id,
                )
            )
            if duplicate:
                duplicates += 1
                continue
            try:
                self.session.add(
                    BankTransaction(
                        bank_account_id=bank_account_id,
                        external_id=item.external_id,
                        transaction_date=item.transaction_date,
                        posted_at=item.posted_at,
                        amount=item.amount,
                        transaction_type=item.transaction_type,
                        description=item.description,
                        document_number=item.document_number,
                        end_to_end_id=item.end_to_end_id,
                        raw_payload=item.raw_payload or {},
                        reconciliation_status="UNMATCHED",
                    )
                )
                await self.session.flush()
                imported += 1
            except Exception:  # noqa: BLE001 - contabiliza item inválido sem interromper o lote
                errors += 1
                await self.session.rollback()
                raise
        job.status = "COMPLETED" if errors == 0 else "COMPLETED_WITH_ERRORS"
        job.imported_count = imported
        job.duplicate_count = duplicates
        job.error_count = errors
        job.summary = {"parsed": len(parsed), "imported": imported, "duplicates": duplicates, "errors": errors}
        job.processed_at = datetime.now().astimezone()
        await self.session.commit()
        await self.session.refresh(job)
        return job
