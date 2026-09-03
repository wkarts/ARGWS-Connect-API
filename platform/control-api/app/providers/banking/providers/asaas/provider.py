from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.core.errors import APIError
from app.providers.banking.asaas import AsaasBankingProvider as LegacyAsaasBankingProvider
from app.providers.banking.contracts.balance import BalanceResult
from app.providers.banking.contracts.statements import BankTransactionResult, StatementRequest, StatementResult
from app.providers.banking.core.context import BankingProviderContext


class AsaasBankingProvider(LegacyAsaasBankingProvider):
    """Adapter Asaas para o framework bancário capability-based.

    Mantém compatibilidade com o executor de cobranças existente e adiciona
    somente contratos normalizados cuja semântica está confirmada no SDK/API:
    saldo e extrato financeiro.
    """

    driver_version = "1.0.0-rc.32"

    @staticmethod
    def _agreement(context: BankingProviderContext) -> dict[str, Any]:
        return {
            "environment": context.environment.value,
            "credentials": context.credentials,
            "settings": context.settings,
        }

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        async with self._client(self._agreement(context)) as client:
            response = await client.get("/myAccount/accountNumber")
            await self._raise_api_error(response, "health.account_number")
        return {"status": "CONNECTED", "provider": self.name}

    async def get_balance(self, context: BankingProviderContext) -> BalanceResult:
        async with self._client(self._agreement(context)) as client:
            response = await client.get("/finance/balance")
            await self._raise_api_error(response, "finance.balance")
            data = response.json()
        try:
            balance = Decimal(str(data.get("balance") or "0"))
        except (TypeError, ValueError, ArithmeticError) as exc:
            raise APIError(
                "BANK_PROVIDER_INVALID_RESPONSE",
                "O Asaas retornou saldo em formato inválido.",
                502,
                {"provider": self.name},
            ) from exc
        return BalanceResult(
            available=balance,
            current=balance,
            currency="BRL",
            provider_status="AVAILABLE",
            raw_response={"balance": str(data.get("balance") or "0")},
        )

    async def get_statement(self, context: BankingProviderContext, request: StatementRequest) -> StatementResult:
        try:
            offset = max(0, int(request.cursor or "0"))
        except ValueError as exc:
            raise APIError("BANK_STATEMENT_CURSOR_INVALID", "Cursor de extrato Asaas inválido.", 422) from exc

        limit = 100
        params = {
            "offset": offset,
            "limit": limit,
            "startDate": request.start_date.isoformat(),
            "finishDate": request.end_date.isoformat(),
            "order": "asc",
        }
        async with self._client(self._agreement(context)) as client:
            response = await client.get("/financialTransactions", params=params)
            await self._raise_api_error(response, "financial_transactions.list")
            data = response.json()

        transactions: list[BankTransactionResult] = []
        for item in list(data.get("data") or []):
            if not isinstance(item, dict):
                continue
            provider_id = str(item.get("id") or "").strip()
            if not provider_id:
                continue
            try:
                amount = Decimal(str(item.get("value") or "0"))
                transaction_date = date.fromisoformat(str(item.get("date") or "")[:10])
            except (TypeError, ValueError, ArithmeticError) as exc:
                raise APIError(
                    "BANK_PROVIDER_INVALID_RESPONSE",
                    "O Asaas retornou uma transação financeira em formato inválido.",
                    502,
                    {"provider": self.name, "transaction_id": provider_id},
                ) from exc

            relation_id = next(
                (
                    str(item.get(key))
                    for key in ("paymentId", "transferId", "billId", "invoiceId", "splitId", "anticipationId")
                    if item.get(key)
                ),
                None,
            )
            metadata = {
                key: item.get(key)
                for key in (
                    "balance",
                    "paymentId",
                    "splitId",
                    "transferId",
                    "anticipationId",
                    "billId",
                    "invoiceId",
                    "paymentDunningId",
                    "creditBureauReportId",
                )
                if item.get(key) is not None
            }
            transactions.append(
                BankTransactionResult(
                    provider_transaction_id=provider_id,
                    amount=amount,
                    transaction_date=transaction_date,
                    transaction_type=str(item.get("type") or "UNKNOWN"),
                    description=str(item.get("description") or item.get("type") or "Transação Asaas"),
                    external_id=relation_id,
                    bank_reference=provider_id,
                    provider_status="POSTED",
                    provider_metadata=metadata,
                    raw_response={
                        key: item.get(key)
                        for key in (
                            "id",
                            "value",
                            "balance",
                            "type",
                            "date",
                            "description",
                            "paymentId",
                            "splitId",
                            "transferId",
                            "anticipationId",
                            "billId",
                            "invoiceId",
                        )
                        if key in item
                    },
                )
            )

        has_more = bool(data.get("hasMore"))
        next_cursor = str(offset + len(transactions)) if has_more else None
        return StatementResult(
            transactions=tuple(transactions),
            next_cursor=next_cursor,
            has_more=has_more,
            provider_reference=f"asaas:{offset}",
            provider_metadata={
                "total_count": data.get("totalCount"),
                "limit": data.get("limit", limit),
                "offset": data.get("offset", offset),
            },
            raw_response={
                "object": data.get("object"),
                "hasMore": has_more,
                "totalCount": data.get("totalCount"),
                "limit": data.get("limit", limit),
                "offset": data.get("offset", offset),
            },
        )
