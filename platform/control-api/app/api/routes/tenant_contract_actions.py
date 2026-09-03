from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import accessible_company_ids, ensure_company_access, get_tenant_db, require_permission
from app.core.errors import APIError
from app.models.tenant import (
    BankAccount,
    BankTransaction,
    Contract,
    Negotiation,
    Payment,
    Receivable,
    Reconciliation,
)
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit

router = APIRouter(prefix="/api/v1", tags=["Operações financeiras avançadas"])


@router.delete("/contracts/{contract_id}", response_model=SuccessResponse[dict])
async def delete_contract(
    contract_id: UUID,
    user: AuthUser = Depends(require_permission("contracts.delete")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    """Encerra um contrato sem destruir seu histórico financeiro."""
    item = await session.get(Contract, contract_id)
    if item is None:
        raise APIError("CONTRACT_NOT_FOUND", "Contrato não encontrado.", 404)
    ensure_company_access(user, item.company_id)
    if item.status == "CANCELLED" and (item.settings or {}).get("deleted_at"):
        return SuccessResponse(data={"id": str(item.id), "deleted": True, "status": item.status})

    before = {
        "status": item.status,
        "end_date": item.end_date.isoformat() if item.end_date else None,
        "next_generation_date": item.next_generation_date.isoformat() if item.next_generation_date else None,
    }
    now = datetime.now(UTC)
    settings = dict(item.settings or {})
    settings["deleted_at"] = now.isoformat()
    settings["deleted_by"] = user.id
    item.settings = settings
    item.status = "CANCELLED"

    await tenant_audit(
        session,
        action="contract.deleted",
        entity_type="Contract",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        before=before,
        after={"status": "CANCELLED", "deleted_at": now.isoformat()},
    )
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "deleted": True, "status": item.status})


@router.get("/negotiations/{negotiation_id}/installments", response_model=SuccessResponse[dict])
async def negotiation_installments(
    negotiation_id: UUID,
    user: AuthUser = Depends(require_permission("negotiations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    """Retorna a grade real de parcelas geradas por uma negociação."""
    negotiation = await session.get(Negotiation, negotiation_id)
    if negotiation is None:
        raise APIError("NEGOTIATION_NOT_FOUND", "Negociação não encontrada.", 404)
    ensure_company_access(user, negotiation.company_id)

    items = list((await session.scalars(
        select(Receivable)
        .where(
            Receivable.source == "NEGOTIATION",
            Receivable.metadata_json["negotiation_id"].astext == str(negotiation.id),
        )
        .order_by(Receivable.due_date, Receivable.document_number)
    )).all())

    installments = [
        {
            "id": str(item.id),
            "document_number": item.document_number,
            "description": item.description,
            "installment": int((item.metadata_json or {}).get("installment") or index + 1),
            "installment_count": int((item.metadata_json or {}).get("installments") or negotiation.installment_count),
            "due_date": item.due_date.isoformat(),
            "original_amount": str(item.original_amount),
            "paid_amount": str(item.paid_amount),
            "balance": str(item.balance),
            "status": item.status,
        }
        for index, item in enumerate(items)
    ]
    return SuccessResponse(
        data={
            "negotiation_id": str(negotiation.id),
            "code": negotiation.code,
            "expected_count": negotiation.installment_count,
            "generated_count": len(installments),
            "complete": len(installments) == negotiation.installment_count,
            "installments": installments,
        }
    )


def _transaction_amount(transaction: BankTransaction) -> Decimal:
    return abs(Decimal(transaction.amount))


def _document_match(transaction: BankTransaction, receivable: Receivable) -> bool:
    transaction_document = (transaction.document_number or "").strip().lower()
    receivable_document = (receivable.document_number or "").strip().lower()
    if transaction_document and receivable_document and transaction_document == receivable_document:
        return True
    description = (transaction.description or "").lower()
    return bool(receivable_document and receivable_document in description)


def _date_score(transaction: BankTransaction, receivable: Receivable) -> int:
    distance = abs((transaction.transaction_date - receivable.due_date).days)
    if distance <= 3:
        return 5
    if distance <= 10:
        return 3
    if distance <= 31:
        return 1
    return 0


@router.post("/reconciliations/auto-match-smart", response_model=SuccessResponse[dict])
async def smart_auto_match_reconciliations(
    user: AuthUser = Depends(require_permission("reconciliation.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    """Concilia extrato com pagamentos e cria sugestões seguras para títulos.

    Correspondência inequívoca com pagamento já registrado é marcada como
    conciliada. Quando a transação ainda não possui pagamento, o motor apenas
    sugere um título se houver candidato único/forte; a baixa depende de
    confirmação explícita do operador.
    """
    account_stmt = select(BankAccount).where(BankAccount.is_active.is_(True))
    allowed_companies = accessible_company_ids(user)
    if allowed_companies is not None:
        account_stmt = account_stmt.where(BankAccount.company_id.in_(allowed_companies))
    accounts = list((await session.scalars(account_stmt)).all())
    account_by_id = {item.id: item for item in accounts}
    if not account_by_id:
        return SuccessResponse(data={"matched": 0, "suggested": 0, "skipped": 0})

    transactions = list((await session.scalars(
        select(BankTransaction)
        .where(
            BankTransaction.bank_account_id.in_(list(account_by_id)),
            BankTransaction.transaction_type == "CREDIT",
            BankTransaction.reconciliation_status.in_(["UNMATCHED", "SUGGESTED"]),
        )
        .order_by(BankTransaction.transaction_date, BankTransaction.created_at)
        .limit(2000)
        .with_for_update()
    )).all())

    matched = 0
    suggested = 0
    skipped = 0
    for transaction in transactions:
        existing_reconciliation = await session.scalar(
            select(Reconciliation).where(Reconciliation.bank_transaction_id == str(transaction.id))
        )
        if existing_reconciliation:
            continue
        account = account_by_id[transaction.bank_account_id]
        amount = _transaction_amount(transaction)

        payment_filters = [Payment.status == "CONFIRMED", Payment.amount == amount]
        identifiers = [value for value in (transaction.end_to_end_id, transaction.external_id) if value]
        if identifiers:
            payment_filters.append(
                or_(Payment.end_to_end_id.in_(identifiers), Payment.external_id.in_(identifiers))
            )
            payment = await session.scalar(select(Payment).where(*payment_filters).order_by(Payment.paid_at.desc()))
        else:
            payment = None

        if payment:
            receivable = await session.get(Receivable, payment.receivable_id)
            if receivable and receivable.company_id == account.company_id:
                reconciliation = Reconciliation(
                    receivable_id=receivable.id,
                    payment_id=payment.id,
                    bank_transaction_id=str(transaction.id),
                    status="MATCHED",
                    score=100,
                    criteria={
                        "bank_transaction": True,
                        "existing_payment": True,
                        "amount_match": True,
                        "end_to_end_match": bool(
                            transaction.end_to_end_id
                            and payment.end_to_end_id == transaction.end_to_end_id
                        ),
                    },
                    reconciled_by=UUID(user.id),
                    reconciled_at=datetime.now(UTC),
                )
                session.add(reconciliation)
                transaction.reconciliation_status = "MATCHED"
                matched += 1
                continue

        candidates = list((await session.scalars(
            select(Receivable)
            .where(
                Receivable.company_id == account.company_id,
                Receivable.status.in_(["OPEN", "REGISTERED", "OVERDUE", "PARTIALLY_PAID"]),
                Receivable.balance == amount,
            )
            .order_by(Receivable.due_date)
            .limit(100)
        )).all())
        if not candidates:
            skipped += 1
            continue

        ranked: list[tuple[int, Receivable]] = []
        for receivable in candidates:
            score = 75 + _date_score(transaction, receivable)
            if _document_match(transaction, receivable):
                score += 20
            ranked.append((min(score, 99), receivable))
        ranked.sort(key=lambda entry: entry[0], reverse=True)
        best_score, best = ranked[0]
        ambiguous = len(ranked) > 1 and ranked[1][0] == best_score and best_score < 95
        if ambiguous:
            skipped += 1
            continue

        reconciliation = Reconciliation(
            receivable_id=best.id,
            payment_id=None,
            bank_transaction_id=str(transaction.id),
            status="SUGGESTED",
            score=best_score,
            criteria={
                "bank_transaction": True,
                "amount_match": True,
                "document_match": _document_match(transaction, best),
                "date_proximity": _date_score(transaction, best),
                "requires_confirmation": True,
            },
        )
        session.add(reconciliation)
        transaction.reconciliation_status = "SUGGESTED"
        suggested += 1

    if matched or suggested:
        await tenant_audit(
            session,
            action="reconciliation.smart_processed",
            entity_type="Reconciliation",
            actor_id=user.id,
            after={"matched": matched, "suggested": suggested, "skipped": skipped},
        )
    await session.commit()
    return SuccessResponse(data={"matched": matched, "suggested": suggested, "skipped": skipped})


@router.post("/reconciliations/{reconciliation_id}/confirm", response_model=SuccessResponse[dict])
async def confirm_reconciliation(
    reconciliation_id: UUID,
    user: AuthUser = Depends(require_permission("reconciliation.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    reconciliation = await session.scalar(
        select(Reconciliation).where(Reconciliation.id == reconciliation_id).with_for_update()
    )
    if reconciliation is None:
        raise APIError("RECONCILIATION_NOT_FOUND", "Conciliação não encontrada.", 404)
    if reconciliation.status == "MATCHED":
        return SuccessResponse(data={"id": str(reconciliation.id), "status": "MATCHED", "idempotent": True})
    if reconciliation.status != "SUGGESTED" or not reconciliation.receivable_id or not reconciliation.bank_transaction_id:
        raise APIError("RECONCILIATION_NOT_CONFIRMABLE", "Esta conciliação não pode ser confirmada.", 409)

    receivable = await session.scalar(
        select(Receivable).where(Receivable.id == reconciliation.receivable_id).with_for_update()
    )
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
    ensure_company_access(user, receivable.company_id)
    try:
        transaction_id = UUID(reconciliation.bank_transaction_id)
    except ValueError as exc:
        raise APIError("BANK_TRANSACTION_REFERENCE_INVALID", "A referência bancária desta sugestão é inválida.", 409) from exc
    transaction = await session.scalar(
        select(BankTransaction).where(BankTransaction.id == transaction_id).with_for_update()
    )
    if transaction is None:
        raise APIError("BANK_TRANSACTION_NOT_FOUND", "Transação bancária não encontrada.", 404)
    account = await session.get(BankAccount, transaction.bank_account_id)
    if account is None or account.company_id != receivable.company_id:
        raise APIError("BANK_TRANSACTION_COMPANY_MISMATCH", "A transação pertence a outra empresa.", 409)

    amount = _transaction_amount(transaction)
    if amount <= 0 or amount > Decimal(receivable.balance):
        raise APIError(
            "RECONCILIATION_AMOUNT_INVALID",
            "O valor da transação é incompatível com o saldo atual do título.",
            409,
            {"transaction_amount": str(amount), "receivable_balance": str(receivable.balance)},
        )

    payment = await session.scalar(
        select(Payment).where(Payment.provider == "BANK_STATEMENT", Payment.external_id == str(transaction.id))
    )
    if payment is None:
        paid_at = transaction.posted_at or datetime.combine(transaction.transaction_date, datetime.min.time(), tzinfo=UTC)
        payment = Payment(
            receivable_id=receivable.id,
            charge_id=None,
            provider="BANK_STATEMENT",
            external_id=str(transaction.id),
            end_to_end_id=transaction.end_to_end_id,
            amount=amount,
            paid_at=paid_at,
            payment_method="BANK_TRANSFER",
            status="CONFIRMED",
            raw_payload={
                "bank_transaction_id": str(transaction.id),
                "external_id": transaction.external_id,
                "description": transaction.description,
            },
        )
        session.add(payment)
        receivable.paid_amount = Decimal(receivable.paid_amount) + amount
        receivable.balance = max(Decimal(receivable.balance) - amount, Decimal("0"))
        receivable.status = "PAID" if Decimal(receivable.balance) == 0 else "PARTIALLY_PAID"
        await session.flush()

    reconciliation.payment_id = payment.id
    reconciliation.status = "MATCHED"
    reconciliation.score = max(Decimal(reconciliation.score), Decimal("95"))
    reconciliation.reconciled_by = UUID(user.id)
    reconciliation.reconciled_at = datetime.now(UTC)
    reconciliation.criteria = {**dict(reconciliation.criteria or {}), "confirmed_by_operator": True}
    transaction.reconciliation_status = "MATCHED"

    await tenant_audit(
        session,
        action="reconciliation.confirmed",
        entity_type="Reconciliation",
        entity_id=str(reconciliation.id),
        actor_id=user.id,
        company_id=str(receivable.company_id),
        after={
            "receivable_id": str(receivable.id),
            "payment_id": str(payment.id),
            "bank_transaction_id": str(transaction.id),
            "amount": str(amount),
            "status": "MATCHED",
        },
    )
    await session.commit()
    return SuccessResponse(
        data={
            "id": str(reconciliation.id),
            "status": reconciliation.status,
            "payment_id": str(payment.id),
            "receivable_id": str(receivable.id),
            "balance": str(receivable.balance),
            "receivable_status": receivable.status,
            "idempotent": False,
        }
    )
