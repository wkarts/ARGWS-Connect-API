from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.banking import BankConnection, BankOperation, BankSyncState
from app.models.tenant import (
    BankAccount,
    BankAgreement,
    BankStatementImport,
    BankTransaction,
    Charge,
    CNABRemittance,
    PixAutomaticMandate,
)


def _blocker(code: str, count: int, message: str, *, operational: bool) -> dict[str, Any]:
    return {
        "code": code,
        "count": int(count),
        "message": message,
        "operational": operational,
    }


async def bank_account_lifecycle(session: AsyncSession, account_id: UUID) -> dict[str, Any]:
    agreements = await session.scalar(
        select(func.count()).select_from(BankAgreement).where(BankAgreement.bank_account_id == account_id)
    ) or 0
    connections = await session.scalar(
        select(func.count()).select_from(BankConnection).where(BankConnection.bank_account_id == account_id)
    ) or 0
    transactions = await session.scalar(
        select(func.count()).select_from(BankTransaction).where(BankTransaction.bank_account_id == account_id)
    ) or 0
    imports = await session.scalar(
        select(func.count()).select_from(BankStatementImport).where(BankStatementImport.bank_account_id == account_id)
    ) or 0

    blockers: list[dict[str, Any]] = []
    if agreements:
        blockers.append(_blocker(
            "BANK_ACCOUNT_HAS_AGREEMENTS",
            agreements,
            "A conta possui convênio(s) vinculado(s). Exclua os convênios sem uso antes de excluir a conta.",
            operational=False,
        ))
    if connections:
        blockers.append(_blocker(
            "BANK_ACCOUNT_HAS_CONNECTIONS",
            connections,
            "A conta possui conexão(ões) bancária(s). Exclua as conexões sem uso antes de excluir a conta.",
            operational=False,
        ))
    if transactions:
        blockers.append(_blocker(
            "BANK_ACCOUNT_HAS_TRANSACTIONS",
            transactions,
            "A conta possui transações bancárias e deve ser preservada para histórico e conciliação.",
            operational=True,
        ))
    if imports:
        blockers.append(_blocker(
            "BANK_ACCOUNT_HAS_STATEMENT_IMPORTS",
            imports,
            "A conta possui importações de extrato e deve ser preservada para auditoria.",
            operational=True,
        ))

    return {
        "can_delete": not blockers,
        "used_operationally": any(item["operational"] for item in blockers),
        "blockers": blockers,
    }


async def bank_agreement_lifecycle(session: AsyncSession, agreement_id: UUID) -> dict[str, Any]:
    agreement = await session.get(BankAgreement, agreement_id)
    if agreement is None:
        return {"can_delete": False, "used_operationally": False, "blockers": []}

    charges = await session.scalar(
        select(func.count()).select_from(Charge).where(Charge.bank_agreement_id == agreement_id)
    ) or 0
    remittances = await session.scalar(
        select(func.count()).select_from(CNABRemittance).where(CNABRemittance.bank_agreement_id == agreement_id)
    ) or 0
    mandates = await session.scalar(
        select(func.count()).select_from(PixAutomaticMandate).where(PixAutomaticMandate.bank_agreement_id == agreement_id)
    ) or 0

    blockers: list[dict[str, Any]] = []
    if charges:
        blockers.append(_blocker(
            "BANK_AGREEMENT_HAS_CHARGES",
            charges,
            "O convênio já foi utilizado em cobrança(s) e deve ser preservado.",
            operational=True,
        ))
    if remittances:
        blockers.append(_blocker(
            "BANK_AGREEMENT_HAS_CNAB_REMITTANCES",
            remittances,
            "O convênio já gerou remessa(s) CNAB e deve ser preservado.",
            operational=True,
        ))
    if mandates:
        blockers.append(_blocker(
            "BANK_AGREEMENT_HAS_PIX_AUTOMATIC",
            mandates,
            "O convênio está vinculado a autorização(ões) de Pix Automático.",
            operational=True,
        ))
    if int(agreement.next_our_number or 1) > 1 and not blockers:
        blockers.append(_blocker(
            "BANK_AGREEMENT_NUMBERING_USED",
            int(agreement.next_our_number) - 1,
            "O convênio já consumiu numeração bancária e deve ser preservado para rastreabilidade.",
            operational=True,
        ))

    return {
        "can_delete": not blockers,
        "used_operationally": any(item["operational"] for item in blockers),
        "blockers": blockers,
    }


async def bank_connection_lifecycle(session: AsyncSession, connection_id: UUID) -> dict[str, Any]:
    """Decide hard-delete usando somente histórico relacional da conexão.

    ``WebhookEvent`` não possui ``bank_connection_id`` no schema atual e não é
    usado como heurística por payload/provider. Operações externas registradas
    em ``BankOperation`` e sincronizações bem-sucedidas em ``BankSyncState`` são
    os vínculos auditáveis que tornam a conexão histórica.
    """
    operations = await session.scalar(
        select(func.count()).select_from(BankOperation).where(BankOperation.connection_id == connection_id)
    ) or 0
    successful_syncs = await session.scalar(
        select(func.count()).select_from(BankSyncState).where(
            BankSyncState.connection_id == connection_id,
            BankSyncState.last_success_at.is_not(None),
        )
    ) or 0

    blockers: list[dict[str, Any]] = []
    if operations:
        blockers.append(_blocker(
            "BANK_CONNECTION_HAS_OPERATIONS",
            operations,
            "A conexão já possui operações bancárias registradas e deve ser preservada.",
            operational=True,
        ))
    if successful_syncs:
        blockers.append(_blocker(
            "BANK_CONNECTION_HAS_SYNCS",
            successful_syncs,
            "A conexão já realizou sincronização bancária com sucesso e deve ser preservada.",
            operational=True,
        ))

    return {
        "can_delete": not blockers,
        "used_operationally": any(item["operational"] for item in blockers),
        "blockers": blockers,
    }
