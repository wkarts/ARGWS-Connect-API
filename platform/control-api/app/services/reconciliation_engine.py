from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import BankAccount, BankTransaction, Charge, Customer, Payment, Receivable, Reconciliation
from app.providers.banking.core.normalization import masked_tax_id


@dataclass(frozen=True, slots=True)
class ReconciliationCandidate:
    receivable_id: UUID
    payment_id: UUID | None
    charge_id: UUID | None
    score: Decimal
    evidence: tuple[str, ...]
    strong_identifier: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ReconciliationDecision:
    status: str
    score: Decimal
    candidate: ReconciliationCandidate | None
    alternatives: tuple[ReconciliationCandidate, ...] = ()
    reason: str | None = None


class ReconciliationEngine:
    """Concilia fatos bancários reais sem inferir liquidação a partir de uma chamada externa.

    O motor somente classifica a evidência. A baixa financeira continua sendo uma
    ação de domínio separada. Um `AUTO_MATCHED` indica vínculo inequívoco com um
    pagamento já registrado, não autoriza criar novo efeito econômico.
    """

    AUTO_MATCH_THRESHOLD = Decimal("95")
    SUGGESTION_THRESHOLD = Decimal("65")

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _digits(value: Any) -> str:
        return re.sub(r"\D", "", str(value or ""))

    @staticmethod
    def _norm(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "").strip().casefold())

    @staticmethod
    def _date_distance(transaction_date: date, due_date: date) -> int:
        return abs((transaction_date - due_date).days)

    @staticmethod
    def _raw_value(raw: dict[str, Any], *keys: str) -> str | None:
        folded = {str(key).casefold().replace("_", ""): value for key, value in raw.items()}
        for key in keys:
            value = folded.get(key.casefold().replace("_", ""))
            if value not in (None, ""):
                return str(value)
        for nested_key in ("payer", "pagador", "counterparty", "transaction"):
            nested = raw.get(nested_key)
            if isinstance(nested, dict):
                value = ReconciliationEngine._raw_value(nested, *keys)
                if value:
                    return value
        return None

    async def candidates(self, transaction: BankTransaction) -> list[ReconciliationCandidate]:
        account = await self.session.get(BankAccount, transaction.bank_account_id)
        if account is None:
            return []

        payments = list((await self.session.scalars(
            select(Payment)
            .join(Receivable, Receivable.id == Payment.receivable_id)
            .where(Receivable.company_id == account.company_id)
            .order_by(Payment.paid_at.desc())
            .limit(5000)
        )).all())
        charges = list((await self.session.scalars(
            select(Charge)
            .join(Receivable, Receivable.id == Charge.receivable_id)
            .where(Receivable.company_id == account.company_id)
            .order_by(Charge.created_at.desc())
            .limit(5000)
        )).all())
        receivables = list((await self.session.scalars(
            select(Receivable)
            .where(
                Receivable.company_id == account.company_id,
                Receivable.status.notin_(["CANCELLED", "REVERSED"]),
            )
            .order_by(Receivable.due_date.desc())
            .limit(10000)
        )).all())
        customers = {
            item.id: item
            for item in (await self.session.scalars(
                select(Customer).where(Customer.id.in_({r.customer_id for r in receivables}))
            )).all()
        }
        payment_by_receivable: dict[UUID, list[Payment]] = {}
        for payment in payments:
            payment_by_receivable.setdefault(payment.receivable_id, []).append(payment)
        charge_by_receivable: dict[UUID, list[Charge]] = {}
        for charge in charges:
            charge_by_receivable.setdefault(charge.receivable_id, []).append(charge)

        tx_end_to_end = self._norm(transaction.end_to_end_id)
        tx_document = self._norm(transaction.document_number)
        tx_description = self._norm(transaction.description)
        raw = dict(transaction.raw_payload or {})
        tx_txid = self._norm(
            getattr(transaction, "txid", None)
            or self._raw_value(raw, "txid", "transactionid", "pix_txid")
        )
        tx_bank_reference = self._norm(
            getattr(transaction, "bank_reference", None)
            or self._raw_value(raw, "bankreference", "bank_reference", "reference")
        )
        payer_tax_id = self._digits(self._raw_value(raw, "payertaxid", "cpfcnpj", "document", "taxid"))
        payer_name = self._norm(self._raw_value(raw, "payername", "name", "nome"))

        result: list[ReconciliationCandidate] = []
        tx_amount = abs(Decimal(transaction.amount))
        for receivable in receivables:
            score = Decimal("0")
            evidence: list[str] = []
            strong = False
            matched_payment: Payment | None = None
            matched_charge: Charge | None = None

            for payment in payment_by_receivable.get(receivable.id, []):
                if tx_end_to_end and self._norm(payment.end_to_end_id) == tx_end_to_end:
                    score = max(score, Decimal("100"))
                    evidence.append("endToEndId")
                    strong = True
                    matched_payment = payment
                    break
                if tx_bank_reference and self._norm(payment.external_id) == tx_bank_reference:
                    score = max(score, Decimal("100"))
                    evidence.append("provider_payment_id")
                    strong = True
                    matched_payment = payment
                    break

            for charge in charge_by_receivable.get(receivable.id, []):
                charge_ids = {
                    self._norm(charge.external_id): "provider_charge_id",
                    self._norm(charge.txid): "txid",
                    self._norm(charge.our_number): "nossoNumero",
                }
                for candidate_value, label in charge_ids.items():
                    if candidate_value and candidate_value in {tx_txid, tx_bank_reference, tx_document}:
                        score = max(score, Decimal("100"))
                        evidence.append(label)
                        strong = True
                        matched_charge = charge
                        break
                if strong:
                    break

            if not strong:
                if tx_document and self._norm(receivable.document_number) == tx_document:
                    score += Decimal("70")
                    evidence.append("document_number")
                elif receivable.document_number and self._norm(receivable.document_number) in tx_description:
                    score += Decimal("55")
                    evidence.append("document_in_description")

                if tx_amount == Decimal(receivable.balance) or tx_amount == Decimal(receivable.original_amount):
                    score += Decimal("25")
                    evidence.append("amount")

                customer = customers.get(receivable.customer_id)
                if customer:
                    customer_tax = self._digits(customer.tax_id)
                    if payer_tax_id and customer_tax and payer_tax_id == customer_tax:
                        score += Decimal("35")
                        evidence.append("payer_tax_id")
                    elif payer_name and self._norm(customer.name) and self._norm(customer.name) in payer_name:
                        score += Decimal("15")
                        evidence.append("payer_name")

                distance = self._date_distance(transaction.transaction_date, receivable.due_date)
                if distance <= 3:
                    score += Decimal("15")
                    evidence.append("date_3d")
                elif distance <= 10:
                    score += Decimal("10")
                    evidence.append("date_10d")
                elif distance <= 31:
                    score += Decimal("5")
                    evidence.append("date_31d")

            score = min(score, Decimal("100"))
            if score >= self.SUGGESTION_THRESHOLD:
                result.append(
                    ReconciliationCandidate(
                        receivable_id=receivable.id,
                        payment_id=matched_payment.id if matched_payment else None,
                        charge_id=matched_charge.id if matched_charge else None,
                        score=score,
                        evidence=tuple(dict.fromkeys(evidence)),
                        strong_identifier=strong,
                        metadata={
                            "document_number": receivable.document_number,
                            "payer_tax_id_masked": masked_tax_id(payer_tax_id),
                        },
                    )
                )
        result.sort(key=lambda item: (item.score, item.strong_identifier), reverse=True)
        return result

    async def decide(self, transaction: BankTransaction) -> ReconciliationDecision:
        candidates = await self.candidates(transaction)
        if not candidates:
            return ReconciliationDecision("UNMATCHED", Decimal("0"), None, reason="Nenhuma evidência suficiente.")
        best = candidates[0]
        ties = tuple(item for item in candidates[1:] if item.score == best.score)
        if ties:
            return ReconciliationDecision(
                "AMBIGUOUS",
                best.score,
                best,
                alternatives=ties,
                reason="Mais de um candidato possui a mesma evidência.",
            )
        if best.strong_identifier and best.payment_id and best.score >= self.AUTO_MATCH_THRESHOLD:
            return ReconciliationDecision("AUTO_MATCHED", best.score, best)
        if best.score >= self.SUGGESTION_THRESHOLD:
            return ReconciliationDecision("SUGGESTED", best.score, best)
        return ReconciliationDecision("UNMATCHED", best.score, None)

    async def persist_decision(
        self,
        transaction: BankTransaction,
        decision: ReconciliationDecision,
    ) -> Reconciliation:
        existing = await self.session.scalar(
            select(Reconciliation).where(Reconciliation.bank_transaction_id == str(transaction.id))
        )
        item = existing or Reconciliation(bank_transaction_id=str(transaction.id))
        if existing is None:
            self.session.add(item)
        item.receivable_id = decision.candidate.receivable_id if decision.candidate else None
        item.payment_id = decision.candidate.payment_id if decision.candidate else None
        item.status = decision.status
        item.score = decision.score
        item.criteria = {
            "evidence": list(decision.candidate.evidence) if decision.candidate else [],
            "strong_identifier": bool(decision.candidate and decision.candidate.strong_identifier),
            "reason": decision.reason,
            "alternatives": [
                {"receivable_id": str(candidate.receivable_id), "score": str(candidate.score)}
                for candidate in decision.alternatives[:10]
            ],
            "economic_effect_applied": False,
        }
        if decision.status == "AUTO_MATCHED":
            item.reconciled_at = __import__("datetime").datetime.now(__import__("datetime").UTC)
        transaction.reconciliation_status = decision.status
        await self.session.flush()
        return item
