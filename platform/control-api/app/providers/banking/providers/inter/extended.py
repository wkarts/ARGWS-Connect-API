from __future__ import annotations

from datetime import date, datetime
from typing import Any

from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers.inter.constants import (
    BANKING_PAYMENT_BATCH,
    BANKING_PAYMENT_DARF,
    BANKING_STATEMENT,
    BANKING_WEBHOOK,
    PIX_COB,
    PIX_COBV,
    PIX_COBV_BATCH,
    PIX_LOCATIONS,
    SCOPE_BANKING_WEBHOOK_READ,
    SCOPE_BATCH_PAYMENT_READ,
    SCOPE_BATCH_PAYMENT_WRITE,
    SCOPE_BOLETO_PAYMENT_READ,
    SCOPE_COB_READ,
    SCOPE_COB_WRITE,
    SCOPE_COBV_BATCH_READ,
    SCOPE_COBV_BATCH_WRITE,
    SCOPE_COBV_READ,
    SCOPE_LOCATION_READ,
    SCOPE_STATEMENT_READ,
)
from app.providers.banking.providers.inter.provider import InterBankingProvider as _InterBankingProvider


class InterBankingProvider(_InterBankingProvider):
    """Superfície adicional publicada pela SDK oficial do Banco Inter.

    Mantém o façade histórico em ``provider.py`` e adiciona somente operações
    comprovadas no repositório oficial. O registry importa esta classe pelo
    pacote ``providers.inter``; nenhum outro provider compartilha esses paths.
    """

    async def get_basic_statement(
        self,
        context: BankingProviderContext,
        *,
        start_date: date,
        end_date: date,
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_STATEMENT_READ,),
            method="GET",
            path=BANKING_STATEMENT,
            params={"dataInicio": start_date.isoformat(), "dataFim": end_date.isoformat()},
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Extrato Banco Inter fora do contrato esperado.")
        return data

    async def list_darf_payments(
        self,
        context: BankingProviderContext,
        *,
        start_date: date,
        end_date: date,
        request_code: str | None = None,
        revenue_code: str | None = None,
        filter_date_by: str | None = None,
    ) -> list[Any]:
        params: dict[str, Any] = {"dataInicio": start_date.isoformat(), "dataFim": end_date.isoformat()}
        if request_code:
            params["codigoSolicitacao"] = request_code
        if revenue_code:
            params["codigoReceita"] = revenue_code
        if filter_date_by:
            params["filtrarDataPor"] = filter_date_by
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BOLETO_PAYMENT_READ,),
            method="GET",
            path=BANKING_PAYMENT_DARF,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, list):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista DARF Banco Inter fora do contrato esperado.")
        return data

    async def create_payment_batch(
        self,
        context: BankingProviderContext,
        *,
        my_identifier: str,
        payments: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not my_identifier.strip() or not payments:
            raise BankProviderError("BANK_INVALID_REQUEST", "Lote de pagamentos Banco Inter exige identificador e itens.")
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BATCH_PAYMENT_WRITE,),
            method="POST",
            path=BANKING_PAYMENT_BATCH,
            payload={"meuIdentificador": my_identifier, "pagamentos": payments},
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Inclusão de lote Banco Inter inválida.")
        return data

    async def get_payment_batch(self, context: BankingProviderContext, batch_id: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BATCH_PAYMENT_READ,),
            method="GET",
            path=f"{BANKING_PAYMENT_BATCH}/{batch_id}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lote de pagamentos Banco Inter inválido.")
        return data

    async def list_immediate_pix_charges(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        cpf: str | None = None,
        cnpj: str | None = None,
        location_present: bool | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "inicio": start.isoformat().replace("+00:00", "Z"),
            "fim": end.isoformat().replace("+00:00", "Z"),
            "paginacao.paginaAtual": max(0, page),
            "paginacao.itensPorPagina": max(1, min(1000, page_size)),
        }
        for key, value in {
            "cpf": cpf,
            "cnpj": cnpj,
            "locationPresente": location_present,
            "status": status,
        }.items():
            if value is not None:
                params[key] = value
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COB_READ,),
            method="GET",
            path=PIX_COB,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista Cob Banco Inter inválida.")
        return data

    async def update_immediate_pix_charge(
        self,
        context: BankingProviderContext,
        *,
        txid: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COB_WRITE,),
            method="PATCH",
            path=f"{PIX_COB}/{txid}",
            payload=payload,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Revisão Cob Banco Inter inválida.")
        return data

    async def list_due_pix_charges(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        cpf: str | None = None,
        cnpj: str | None = None,
        location_present: bool | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "inicio": start.isoformat().replace("+00:00", "Z"),
            "fim": end.isoformat().replace("+00:00", "Z"),
            "paginacao.paginaAtual": max(0, page),
            "paginacao.itensPorPagina": max(1, min(1000, page_size)),
        }
        for key, value in {
            "cpf": cpf,
            "cnpj": cnpj,
            "locationPresente": location_present,
            "status": status,
        }.items():
            if value is not None:
                params[key] = value
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_READ,),
            method="GET",
            path=PIX_COBV,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista CobV Banco Inter inválida.")
        return data

    async def create_due_pix_batch(
        self,
        context: BankingProviderContext,
        *,
        batch_id: str,
        payload: dict[str, Any],
    ) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_BATCH_WRITE,),
            method="PUT",
            path=f"{PIX_COBV_BATCH}/{batch_id}",
            payload=payload,
            correlation_id=context.correlation_id,
        )

    async def get_due_pix_batch(self, context: BankingProviderContext, batch_id: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_BATCH_READ,),
            method="GET",
            path=f"{PIX_COBV_BATCH}/{batch_id}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lote CobV Banco Inter inválido.")
        return data

    async def update_due_pix_batch(
        self,
        context: BankingProviderContext,
        *,
        batch_id: str,
        payload: dict[str, Any],
    ) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_BATCH_WRITE,),
            method="PATCH",
            path=f"{PIX_COBV_BATCH}/{batch_id}",
            payload=payload,
            correlation_id=context.correlation_id,
        )

    async def get_due_pix_batch_summary(self, context: BankingProviderContext, batch_id: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_BATCH_READ,),
            method="GET",
            path=f"{PIX_COBV_BATCH}/{batch_id}/sumario",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Sumário de lote CobV Banco Inter inválido.")
        return data

    async def get_due_pix_batch_by_status(
        self,
        context: BankingProviderContext,
        *,
        batch_id: str,
        status: str,
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_BATCH_READ,),
            method="GET",
            path=f"{PIX_COBV_BATCH}/{batch_id}/situacao/{status}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Consulta de lote CobV Banco Inter inválida.")
        return data

    async def list_due_pix_batches(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_BATCH_READ,),
            method="GET",
            path=PIX_COBV_BATCH,
            params={
                "inicio": start.isoformat().replace("+00:00", "Z"),
                "fim": end.isoformat().replace("+00:00", "Z"),
                "paginacao.paginaAtual": max(0, page),
                "paginacao.itensPorPagina": max(1, min(1000, page_size)),
            },
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista de lotes CobV Banco Inter inválida.")
        return data

    async def list_locations(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        txid_present: bool | None = None,
        billing_type: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "inicio": start.isoformat().replace("+00:00", "Z"),
            "fim": end.isoformat().replace("+00:00", "Z"),
            "paginacao.paginaAtual": max(0, page),
            "paginacao.itensPorPagina": max(1, min(1000, page_size)),
        }
        if txid_present is not None:
            params["txIdPresente"] = txid_present
        if billing_type is not None:
            normalized = billing_type.lower()
            if normalized not in {"cob", "cobv"}:
                raise BankProviderError("BANK_INVALID_REQUEST", "tipoCob Banco Inter deve ser cob ou cobv.")
            params["tipoCob"] = normalized
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_LOCATION_READ,),
            method="GET",
            path=PIX_LOCATIONS,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista de Locations Banco Inter inválida.")
        return data

    async def list_banking_webhook_callbacks(
        self,
        context: BankingProviderContext,
        *,
        webhook_type: str,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        transaction_code: str | None = None,
        end_to_end_id: str | None = None,
    ) -> dict[str, Any]:
        if webhook_type not in {"pix-pagamento", "boleto-pagamento"}:
            raise BankProviderError("BANK_INVALID_REQUEST", "Tipo de webhook Banking Inter inválido.")
        params: dict[str, Any] = {
            "dataHoraInicio": start.isoformat().replace("+00:00", "Z"),
            "dataHoraFim": end.isoformat().replace("+00:00", "Z"),
            "pagina": max(0, page),
            "tamanhoPagina": max(1, min(1000, page_size)),
        }
        if transaction_code:
            params["codigoTransacao"] = transaction_code
        if end_to_end_id:
            params["endToEnd"] = end_to_end_id
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BANKING_WEBHOOK_READ,),
            method="GET",
            path=f"{BANKING_WEBHOOK}/{webhook_type}/callbacks",
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Callbacks Banking Banco Inter inválidos.")
        return data
