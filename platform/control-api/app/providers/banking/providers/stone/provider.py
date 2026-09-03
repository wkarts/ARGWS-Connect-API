from __future__ import annotations

import hashlib
import re
import time
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import httpx
import jwt

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.contracts.balance import BalanceResult
from app.providers.banking.contracts.statements import BankTransactionResult, StatementRequest, StatementResult
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient


class StoneBankingProvider:
    name = "STONE"
    driver_version = "1.0.0-rc.28"
    _auth = {
        "SANDBOX": "https://sandbox-accounts.openbank.stone.com.br/auth/realms/stone_bank",
        "PRODUCTION": "https://accounts.openbank.stone.com.br/auth/realms/stone_bank",
    }
    _api = {
        "SANDBOX": "https://sandbox-api.openbank.stone.com.br",
        "PRODUCTION": "https://api.openbank.stone.com.br",
    }
    _allowed_hosts = {
        "sandbox-accounts.openbank.stone.com.br", "accounts.openbank.stone.com.br",
        "sandbox-api.openbank.stone.com.br", "api.openbank.stone.com.br",
    }

    @classmethod
    def _credentials(cls, context: BankingProviderContext | None, agreement: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
        if context is not None:
            return context.environment.value, dict(context.credentials)
        agreement = agreement or {}
        return str(agreement.get("environment") or "SANDBOX").upper(), dict(agreement.get("credentials") or {})

    @classmethod
    def _validate(cls, environment: str, credentials: dict[str, Any]) -> tuple[str, str, str, str, str]:
        audience = cls._auth.get(environment.upper())
        api = cls._api.get(environment.upper())
        if not audience or not api:
            raise BankProviderError("BANK_INVALID_REQUEST", "O driver Stone aceita somente SANDBOX ou PRODUCTION.")
        client_id = str(credentials.get("client_id") or "").strip()
        private_key = str(credentials.get("private_key") or "").strip()
        account_id = str(credentials.get("account_id") or "").strip()
        pix_key = str(credentials.get("pix_key") or "").strip()
        missing = [name for name, value in (("client_id", client_id), ("private_key", private_key), ("account_id", account_id), ("pix_key", pix_key)) if not value]
        if missing:
            raise BankProviderError("BANK_INVALID_CREDENTIALS", "Credenciais Stone incompletas.", details={"missing_fields": missing})
        return audience, api, client_id, private_key, account_id

    @staticmethod
    def _idempotency(prefix: str, value: str) -> str:
        return hashlib.sha256(f"{prefix}:{value}".encode()).hexdigest()[:32]

    @classmethod
    def _assertion(cls, *, audience: str, client_id: str, private_key: str) -> str:
        now = int(time.time())
        payload = {
            "exp": now + 840, "nbf": now, "aud": audience, "realm": "stone_bank",
            "sub": client_id, "clientId": client_id, "jti": uuid4().hex,
            "iat": now, "iss": client_id,
        }
        return jwt.encode(payload, private_key, algorithm="RS256", headers={"typ": "JWT"})

    @classmethod
    async def _access_token(cls, *, audience: str, client_id: str, private_key: str, application_name: str) -> str:
        form = {
            "client_id": client_id,
            "grant_type": "client_credentials",
            "client_assertion": cls._assertion(audience=audience, client_id=client_id, private_key=private_key),
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        }
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.post(f"{audience}/protocol/openid-connect/token", data=form, headers={"User-Agent": application_name, "Content-Type": "application/x-www-form-urlencoded"})
        except httpx.TimeoutException as exc:
            raise BankProviderError("BANK_REQUEST_TIMEOUT", "Timeout na autenticação Stone.", retryable=True) from exc
        except httpx.NetworkError as exc:
            raise BankProviderError("BANK_PROVIDER_UNAVAILABLE", "Autenticação Stone indisponível.", retryable=True) from exc
        if response.status_code >= 400:
            raise BankProviderError("BANK_AUTHENTICATION_FAILED", "A Stone recusou a autenticação da aplicação.", provider_http_status=response.status_code)
        try:
            return str(response.json()["access_token"])
        except (ValueError, KeyError, TypeError) as exc:
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta de autenticação Stone inválida.") from exc

    @classmethod
    async def _client(cls, environment: str, credentials: dict[str, Any]) -> BankHTTPClient:
        audience, api, client_id, private_key, account_id = cls._validate(environment, credentials)
        application_name = str(credentials.get("application_name") or "Connect-API-Platform").strip()
        token = await cls._access_token(audience=audience, client_id=client_id, private_key=private_key, application_name=application_name)
        return BankHTTPClient(
            provider=cls.name, base_url=api, allowed_hosts=cls._allowed_hosts,
            headers={"Authorization": f"Bearer {token}", "User-Agent": application_name, "Accept": "application/json", "Content-Type": "application/json", "x-stone-account-id": account_id},
        )

    @staticmethod
    def _debtor(request: BankChargeRequest) -> dict[str, str] | None:
        tax_id = re.sub(r"\D", "", request.customer.tax_id or "")
        if len(tax_id) not in {11, 14}:
            return None
        return {"nome": request.customer.name, "cpf" if len(tax_id) == 11 else "cnpj": tax_id}

    @staticmethod
    def _result(data: dict[str, Any], fallback: str = "") -> BankChargeResult:
        location = data.get("location") or (data.get("loc") or {}).get("location")
        return BankChargeResult(
            provider="STONE", external_id=str(data.get("txid") or fallback),
            status=str(data.get("status") or "ATIVA").upper(), txid=str(data.get("txid") or fallback),
            document_url=(location if str(location or "").startswith("http") else f"https://{location}" if location else None),
            raw={key: data.get(key) for key in ("txid", "status", "calendario", "valor", "loc", "location")},
        )

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        client = await self._client(context.environment.value, context.credentials)
        await client.aclose()
        return {"status": "CONNECTED", "provider": self.name, "authentication_verified": True, "financial_operation": False}

    async def get_balance(self, context: BankingProviderContext) -> BalanceResult:
        _, _, _, _, account_id = self._validate(context.environment.value, context.credentials)
        try:
            async with await self._client(context.environment.value, context.credentials) as client:
                data = (await client.request("GET", f"/api/v1/accounts/{account_id}/balance")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        try:
            available = Decimal(str(data["balance"])) / Decimal("100")
        except (KeyError, TypeError, ValueError) as exc:
            raise APIError("BANK_RESPONSE_INVALID", "Saldo Stone fora do contrato esperado.", 502) from exc
        return BalanceResult(available=available, current=available, provider_reference=account_id, raw_response=data)

    async def get_statement(self, context: BankingProviderContext, request: StatementRequest) -> StatementResult:
        _, _, _, _, account_id = self._validate(context.environment.value, context.credentials)
        try:
            async with await self._client(context.environment.value, context.credentials) as client:
                data = (await client.request("GET", f"/api/v1/accounts/{account_id}/statement")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        rows = data if isinstance(data, list) else []
        transactions: list[BankTransactionResult] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                created = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
                if not request.start_date <= created.date() <= request.end_date:
                    continue
                amount = Decimal(str(row["amount"])) / Decimal("100")
            except (KeyError, TypeError, ValueError):
                continue
            operation = str(row.get("operation") or "").lower()
            if operation == "debit":
                amount = -abs(amount)
            counter = row.get("counter_party") if isinstance(row.get("counter_party"), dict) else {}
            entity = counter.get("entity") if isinstance(counter.get("entity"), dict) else {}
            transactions.append(BankTransactionResult(
                provider_transaction_id=str(row.get("id") or uuid4().hex), amount=amount,
                transaction_date=created.date(), posted_at=created.astimezone(UTC),
                transaction_type=operation.upper() or str(row.get("type") or "UNKNOWN").upper(),
                description=str(row.get("description") or row.get("type") or "Movimentação Stone"),
                payer_name=entity.get("name"), payer_tax_id=entity.get("document"),
                provider_status=str(row.get("status") or "") or None, raw_response=row,
            ))
        return StatementResult(transactions=tuple(transactions), provider_reference=account_id, raw_response={"count": len(rows)})

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError("BANK_CAPABILITY_NOT_SUPPORTED", "O driver Stone rc.28 implementa somente Pix Cob imediata.", 422)
        amount = Decimal(request.amount)
        if amount <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor precisa ser maior que zero.", 422)
        environment, credentials = self._credentials(None, request.agreement)
        self._validate(environment, credentials)
        settings = dict((request.agreement or {}).get("settings") or {})
        try:
            expiration = int(settings.get("pix_expiration_seconds", 3600))
        except (TypeError, ValueError) as exc:
            raise APIError("BANK_INVALID_REQUEST", "pix_expiration_seconds deve ser inteiro.", 422) from exc
        payload: dict[str, Any] = {"calendario": {"expiracao": expiration}, "valor": {"original": f"{amount:.2f}"}, "chave": str(credentials["pix_key"])}
        debtor = self._debtor(request)
        if debtor:
            payload["devedor"] = debtor
        if request.description:
            payload["solicitacaoPagador"] = request.description[:140]
        try:
            async with await self._client(environment, credentials) as client:
                data = (await client.request("POST", "/api/v1/cob/", json=payload, headers={"x-stone-idempotency-id": self._idempotency("cob", request.internal_id)})).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data)

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult:
        environment, credentials = self._credentials(None, agreement)
        try:
            async with await self._client(environment, credentials) as client:
                data = (await client.request("GET", f"/api/v1/cob/{external_id}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data, external_id)

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        environment, credentials = self._credentials(None, agreement)
        try:
            async with await self._client(environment, credentials) as client:
                await client.request("PATCH", f"/api/v1/cob/{external_id}", json={"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"}, headers={"x-stone-idempotency-id": self._idempotency("cancel", external_id)})
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
