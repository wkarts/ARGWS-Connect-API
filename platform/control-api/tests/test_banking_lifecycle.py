from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services.banking_lifecycle import (
    bank_account_lifecycle,
    bank_agreement_lifecycle,
    bank_connection_lifecycle,
)


@pytest.mark.asyncio
async def test_unused_bank_account_can_be_hard_deleted() -> None:
    session = SimpleNamespace(scalar=AsyncMock(side_effect=[0, 0, 0, 0]))

    lifecycle = await bank_account_lifecycle(session, uuid4())  # type: ignore[arg-type]

    assert lifecycle == {
        "can_delete": True,
        "used_operationally": False,
        "blockers": [],
    }


@pytest.mark.asyncio
async def test_bank_account_with_transaction_must_be_preserved() -> None:
    # agreements, connections, transactions, imports
    session = SimpleNamespace(scalar=AsyncMock(side_effect=[0, 0, 3, 0]))

    lifecycle = await bank_account_lifecycle(session, uuid4())  # type: ignore[arg-type]

    assert lifecycle["can_delete"] is False
    assert lifecycle["used_operationally"] is True
    assert lifecycle["blockers"][0]["code"] == "BANK_ACCOUNT_HAS_TRANSACTIONS"
    assert lifecycle["blockers"][0]["count"] == 3


@pytest.mark.asyncio
async def test_unused_agreement_can_be_deleted_but_numbering_usage_blocks_it() -> None:
    agreement = SimpleNamespace(next_our_number=1)
    session = SimpleNamespace(
        get=AsyncMock(return_value=agreement),
        scalar=AsyncMock(side_effect=[0, 0, 0]),
    )
    clean = await bank_agreement_lifecycle(session, uuid4())  # type: ignore[arg-type]
    assert clean["can_delete"] is True

    agreement.next_our_number = 4
    session.scalar = AsyncMock(side_effect=[0, 0, 0])
    used = await bank_agreement_lifecycle(session, uuid4())  # type: ignore[arg-type]
    assert used["can_delete"] is False
    assert used["used_operationally"] is True
    assert used["blockers"][0]["code"] == "BANK_AGREEMENT_NUMBERING_USED"
    assert used["blockers"][0]["count"] == 3


@pytest.mark.asyncio
async def test_connection_without_operation_or_successful_sync_can_be_deleted() -> None:
    # operations, successful syncs
    session = SimpleNamespace(scalar=AsyncMock(side_effect=[0, 0]))
    clean = await bank_connection_lifecycle(session, uuid4())  # type: ignore[arg-type]
    assert clean["can_delete"] is True
    assert clean["used_operationally"] is False


@pytest.mark.asyncio
async def test_connection_operation_or_sync_makes_history_permanent() -> None:
    session = SimpleNamespace(scalar=AsyncMock(side_effect=[1, 0]))
    used = await bank_connection_lifecycle(session, uuid4())  # type: ignore[arg-type]
    assert used["can_delete"] is False
    assert used["used_operationally"] is True
    assert used["blockers"][0]["code"] == "BANK_CONNECTION_HAS_OPERATIONS"

    session.scalar = AsyncMock(side_effect=[0, 1])
    synced = await bank_connection_lifecycle(session, uuid4())  # type: ignore[arg-type]
    assert synced["can_delete"] is False
    assert synced["used_operationally"] is True
    assert synced["blockers"][0]["code"] == "BANK_CONNECTION_HAS_SYNCS"
