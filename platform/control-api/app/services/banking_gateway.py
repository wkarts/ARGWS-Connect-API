from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.banking import BankConnection, BankSyncState
from app.models.tenant import OutboxEvent
from app.providers.banking.core.capabilities import (
    BankConnectionStatus,
    BankingCapability,
    BankingEnvironment,
    BankingIntegrationMode,
)
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.credentials import decrypt_credentials, validate_credentials
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.normalization import sanitize_mapping
from app.providers.banking.core.observability import bank_operation_metrics
from app.providers.banking.contracts.balance import BalanceResult
from app.providers.banking.contracts.statements import StatementRequest, StatementResult
from app.providers.banking.registry import banking_providers
from app.services.audit import tenant_audit
from app.services.banking_binding import assert_bank_account_provider_binding


class BankingGateway:
    """Fachada central entre o domínio financeiro e particularidades dos providers.

    A fachada valida capability, modo e identidade bancária antes de qualquer
    chamada externa. O provider recebe credenciais somente em memória e a
    auditoria recebe apenas metadados saneados.
    """

    def __init__(self, session: AsyncSession, *, tenant_id: UUID) -> None:
        self.session = session
        self.tenant_id = tenant_id

    async def connection(self, connection_id: UUID, *, for_update: bool = False) -> BankConnection:
        stmt = select(BankConnection).where(BankConnection.id == connection_id)
        if for_update:
            stmt = stmt.with_for_update()
        item = await self.session.scalar(stmt)
        if item is None:
            raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
        return item

    async def context(self, connection: BankConnection) -> BankingProviderContext:
        manifest = banking_providers.manifest(connection.provider)
        if not banking_providers.mode_available(connection.provider, BankingIntegrationMode.DIRECT_API):
            raise APIError(
                "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
                "Esta conexão exige DIRECT_API, mas o provider não possui executor API instalado.",
                422,
                {
                    "provider": connection.provider,
                    "implemented_modes": sorted(
                        item.value for item in manifest.effective_implemented_modes()
                    ),
                },
            )
        await assert_bank_account_provider_binding(
            self.session,
            bank_account_id=connection.bank_account_id,
            manifest=manifest,
        )
        try:
            environment = BankingEnvironment(connection.environment)
        except ValueError as exc:
            raise APIError(
                "BANK_INVALID_CONFIGURATION",
                "Ambiente configurado para a conexão bancária é inválido.",
                422,
                {"environment": connection.environment},
            ) from exc
        if environment not in manifest.environments:
            raise APIError(
                "BANK_INVALID_CONFIGURATION",
                "O provider não anuncia suporte a este ambiente.",
                422,
                {"provider": connection.provider, "environment": environment.value},
            )
        credentials = decrypt_credentials(connection.encrypted_credentials)
        validate_credentials(manifest, credentials)
        return BankingProviderContext(
            tenant_id=self.tenant_id,
            company_id=connection.company_id,
            bank_account_id=connection.bank_account_id,
            connection_id=connection.id,
            provider_code=connection.provider,
            environment=environment,
            manifest=manifest,
            credentials=credentials,
            settings=dict(connection.settings or {}),
            correlation_id=uuid4().hex,
        )

    @staticmethod
    def require_capability(context: BankingProviderContext, capability: BankingCapability) -> Any:
        if capability not in context.manifest.capabilities:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "A conexão bancária não suporta esta operação.",
                422,
                {"provider": context.provider_code, "capability": capability.value},
            )
        if not context.manifest.implementation_available:
            raise APIError(
                "BANKING_PROVIDER_NOT_AVAILABLE",
                "Esta integração está catalogada, porém ainda não possui executor nesta versão.",
                422,
                {"provider": context.provider_code, "status": context.manifest.status.value},
            )
        return banking_providers.get_for_mode(
            context.provider_code,
            BankingIntegrationMode.DIRECT_API,
        )

    async def validate_connection(self, connection_id: UUID, *, actor_id: str | None = None) -> dict[str, Any]:
        connection = await self.connection(connection_id, for_update=True)
        context = await self.context(connection)
        provider = banking_providers.get_for_mode(
            context.provider_code,
            BankingIntegrationMode.DIRECT_API,
        )
        before = {
            "status": connection.last_health_status,
            "last_success_at": connection.last_success_at.isoformat() if connection.last_success_at else None,
        }
        now = datetime.now(UTC)
        try:
            with bank_operation_metrics(context.provider_code, "HEALTH_CHECK", context.environment.value):
                if hasattr(provider, "health_check"):
                    result = await provider.health_check(context)
                elif context.provider_code == "SANDBOX":
                    result = {"status": BankConnectionStatus.CONNECTED.value, "provider": "SANDBOX"}
                else:
                    result = {
                        "status": BankConnectionStatus.CONNECTED.value,
                        "provider": context.provider_code,
                        "configuration_only": True,
                    }
            status = str(result.get("status") or BankConnectionStatus.CONNECTED.value).upper()
            connection.last_health_status = status
            connection.last_health_at = now
            connection.last_success_at = now
            connection.last_error = None
            await tenant_audit(
                self.session,
                action="bank.connection.validated",
                entity_type="BankConnection",
                entity_id=str(connection.id),
                actor_id=actor_id,
                company_id=str(connection.company_id),
                before=before,
                after={"status": status, "provider": context.provider_code},
            )
            self.session.add(
                OutboxEvent(
                    aggregate_type="BankConnection",
                    aggregate_id=str(connection.id),
                    event_type="bank.connection.validated",
                    payload={
                        "connection_id": str(connection.id),
                        "company_id": str(connection.company_id),
                        "provider": context.provider_code,
                        "status": status,
                    },
                )
            )
            await self.session.commit()
            return {"status": status, "provider": context.provider_code, "checked_at": now.isoformat()}
        except BankProviderError as exc:
            connection.last_health_status = (
                BankConnectionStatus.AUTH_ERROR.value
                if exc.code in {"BANK_AUTHENTICATION_FAILED", "BANK_INVALID_CREDENTIALS"}
                else BankConnectionStatus.UNAVAILABLE.value
            )
            connection.last_health_at = now
            connection.last_error = exc.message[:1000]
            await tenant_audit(
                self.session,
                action="bank.connection.failed",
                entity_type="BankConnection",
                entity_id=str(connection.id),
                actor_id=actor_id,
                company_id=str(connection.company_id),
                after={"status": connection.last_health_status, "error_code": exc.code},
            )
            self.session.add(
                OutboxEvent(
                    aggregate_type="BankConnection",
                    aggregate_id=str(connection.id),
                    event_type="bank.connection.failed",
                    payload={
                        "connection_id": str(connection.id),
                        "company_id": str(connection.company_id),
                        "provider": context.provider_code,
                        "error_code": exc.code,
                    },
                )
            )
            await self.session.commit()
            raise exc.as_api_error() from exc
        except APIError:
            raise
        except Exception as exc:
            connection.last_health_status = BankConnectionStatus.UNAVAILABLE.value
            connection.last_health_at = now
            connection.last_error = type(exc).__name__
            await self.session.commit()
            raise APIError(
                "BANK_PROVIDER_UNAVAILABLE",
                "Não foi possível validar a conexão bancária.",
                503,
                {"provider": context.provider_code, "exception": type(exc).__name__},
            ) from exc

    async def get_balance(self, connection_id: UUID) -> BalanceResult:
        connection = await self.connection(connection_id)
        context = await self.context(connection)
        provider = self.require_capability(context, BankingCapability.BALANCE)
        method = getattr(provider, "get_balance", None)
        if method is None:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "O executor instalado ainda não implementa consulta de saldo.",
                422,
                {"provider": context.provider_code},
            )
        try:
            with bank_operation_metrics(context.provider_code, BankingCapability.BALANCE.value, context.environment.value):
                result = await method(context)
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        if not isinstance(result, BalanceResult):
            raise APIError("BANK_RESPONSE_INVALID", "Resposta de saldo fora do contrato normalizado.", 502)
        return result

    async def get_statement(
        self,
        connection_id: UUID,
        *,
        start_date: date,
        end_date: date,
        cursor: str | None = None,
    ) -> StatementResult:
        connection = await self.connection(connection_id)
        context = await self.context(connection)
        provider = self.require_capability(context, BankingCapability.STATEMENT)
        method = getattr(provider, "get_statement", None)
        if method is None:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "O executor instalado ainda não implementa sincronização de extrato.",
                422,
                {"provider": context.provider_code},
            )
        try:
            with bank_operation_metrics(context.provider_code, BankingCapability.STATEMENT.value, context.environment.value):
                result = await method(context, StatementRequest(start_date=start_date, end_date=end_date, cursor=cursor))
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        if not isinstance(result, StatementResult):
            raise APIError("BANK_RESPONSE_INVALID", "Resposta de extrato fora do contrato normalizado.", 502)
        return result

    async def update_sync_state(
        self,
        connection_id: UUID,
        resource_type: str,
        *,
        cursor: str | None,
        sync_from: datetime | None,
        sync_to: datetime | None,
        error: str | None = None,
    ) -> BankSyncState:
        item = await self.session.scalar(
            select(BankSyncState).where(
                BankSyncState.connection_id == connection_id,
                BankSyncState.resource_type == resource_type,
            )
        )
        if item is None:
            item = BankSyncState(connection_id=connection_id, resource_type=resource_type)
            self.session.add(item)
        item.last_cursor = cursor
        item.last_sync_from = sync_from
        item.last_sync_to = sync_to
        item.last_error = error[:2000] if error else None
        if not error:
            item.last_success_at = datetime.now(UTC)
        await self.session.flush()
        return item

    @staticmethod
    def public_balance(result: BalanceResult) -> dict[str, Any]:
        return {
            "available": str(result.available),
            "current": str(result.current) if result.current is not None else None,
            "blocked": str(result.blocked) if result.blocked is not None else None,
            "credit_limit": str(result.credit_limit) if result.credit_limit is not None else None,
            "currency": result.currency,
            "reference_at": result.reference_at.isoformat() if result.reference_at else None,
            "provider_reference": result.provider_reference,
            "provider_status": result.provider_status,
            "provider_metadata": sanitize_mapping(result.provider_metadata),
        }
