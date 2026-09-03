from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.providers.banking.contracts.webhooks import BankWebhookEvent, BankWebhookRequest


class BankingWebhookHandler(Protocol):
    provider: str

    async def verify(
        self,
        session: AsyncSession,
        request: BankWebhookRequest,
        payload: dict[str, Any],
    ) -> tuple[bool, str | None]: ...

    async def parse(
        self,
        request: BankWebhookRequest,
        payload: dict[str, Any],
        *,
        signature_valid: bool,
    ) -> BankWebhookEvent: ...

    async def process(
        self,
        session: AsyncSession,
        event: BankWebhookEvent,
    ) -> None: ...


class ProviderBoundWebhookHandler:
    """Envelope que torna o provider da URL/registry uma fronteira obrigatória.

    Mesmo que um handler específico resolva um ``connection_id`` incorreto, o
    evento não prossegue se a conexão pertencer a outro banco. A checagem fica
    centralizada para que nenhum novo provider possa esquecer essa regra.
    """

    def __init__(self, provider: str, delegate: BankingWebhookHandler) -> None:
        self.provider = provider.upper()
        self.delegate = delegate

    async def verify(
        self,
        session: AsyncSession,
        request: BankWebhookRequest,
        payload: dict[str, Any],
    ) -> tuple[bool, str | None]:
        signature_valid, connection_id = await self.delegate.verify(session, request, payload)
        if connection_id:
            from app.models.banking import BankConnection

            try:
                normalized_id = UUID(str(connection_id))
            except ValueError as exc:
                raise APIError(
                    "BANK_WEBHOOK_PROVIDER_MISMATCH",
                    "O webhook resolveu um identificador de conexão bancária inválido.",
                    409,
                    {"provider": self.provider},
                ) from exc
            connection = await session.get(BankConnection, normalized_id)
            if connection is None:
                raise APIError(
                    "BANK_WEBHOOK_PROVIDER_MISMATCH",
                    "A conexão resolvida pelo webhook não existe neste tenant.",
                    409,
                    {"provider": self.provider, "connection_id": str(normalized_id)},
                )
            if connection.provider.strip().upper() != self.provider:
                raise APIError(
                    "BANK_WEBHOOK_PROVIDER_MISMATCH",
                    "Webhook de um banco jamais pode ser associado à conexão de outro provider.",
                    409,
                    {
                        "webhook_provider": self.provider,
                        "connection_provider": connection.provider,
                        "connection_id": str(connection.id),
                    },
                )
        return signature_valid, connection_id

    async def parse(
        self,
        request: BankWebhookRequest,
        payload: dict[str, Any],
        *,
        signature_valid: bool,
    ) -> BankWebhookEvent:
        return await self.delegate.parse(
            request,
            payload,
            signature_valid=signature_valid,
        )

    async def process(self, session: AsyncSession, event: BankWebhookEvent) -> None:
        await self.delegate.process(session, event)


class BankingWebhookRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, BankingWebhookHandler] = {}

    def register(self, handler: BankingWebhookHandler) -> None:
        code = handler.provider.strip().upper()
        if not code:
            raise ValueError("Handler bancário precisa declarar provider.")
        existing = self._handlers.get(code)
        if existing is not None and existing is not handler:
            raise RuntimeError(
                f"Já existe handler de webhook registrado para o provider {code}; sobrescrita é proibida."
            )
        self._handlers[code] = handler

    def get(self, provider: str) -> BankingWebhookHandler:
        code = provider.strip().upper()
        handler = self._handlers.get(code)
        if handler is None:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "Este provider não possui parser/verificador de webhook homologado nesta versão.",
                422,
                {"provider": code},
            )
        if handler.provider.strip().upper() != code:
            raise APIError(
                "BANK_WEBHOOK_PROVIDER_MISMATCH",
                "Handler de webhook foi registrado sob namespace de outro provider.",
                500,
                {"registry_provider": code, "handler_provider": handler.provider},
            )
        return ProviderBoundWebhookHandler(code, handler)

    def installed(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))


banking_webhooks = BankingWebhookRegistry()
