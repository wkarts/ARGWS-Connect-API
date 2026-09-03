from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.banking import BankOperation
from app.providers.banking.core.normalization import request_hash


class BankOperationStore:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def begin(
        self,
        *,
        connection_id: UUID,
        provider: str,
        operation_type: str,
        idempotency_key: str,
        request: Any,
    ) -> tuple[BankOperation, bool]:
        hashed = request_hash(request)
        existing = await self.session.scalar(
            select(BankOperation)
            .where(
                BankOperation.connection_id == connection_id,
                BankOperation.operation_type == operation_type,
                BankOperation.idempotency_key == idempotency_key,
            )
            .with_for_update()
        )
        if existing:
            if existing.request_hash != hashed:
                raise APIError(
                    "BANK_DUPLICATE_OPERATION",
                    "A mesma chave de idempotência foi reutilizada com conteúdo diferente.",
                    409,
                )
            return existing, False
        item = BankOperation(
            connection_id=connection_id,
            provider=provider,
            operation_type=operation_type,
            idempotency_key=idempotency_key,
            request_hash=hashed,
            status="PROCESSING",
            attempts=1,
        )
        self.session.add(item)
        await self.session.flush()
        return item, True

    async def complete(
        self,
        item: BankOperation,
        *,
        provider_operation_id: str | None = None,
        response_summary: dict[str, Any] | None = None,
    ) -> None:
        item.provider_operation_id = provider_operation_id
        item.response_summary = response_summary or {}
        item.status = "COMPLETED"
        item.completed_at = datetime.now(UTC)
        item.last_error = None

    async def fail(self, item: BankOperation, error: str) -> None:
        item.status = "FAILED"
        item.completed_at = datetime.now(UTC)
        item.last_error = error[:4000]
