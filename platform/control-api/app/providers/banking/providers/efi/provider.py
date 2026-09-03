from __future__ import annotations

import hashlib
import os
import re
import tempfile
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any, AsyncIterator

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.contracts.balance import BalanceResult
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient


class EfiBankingProvider:
    name = "EFI"
    driver_version = "1.0.0-rc.32"
    _base_urls = {"HOMOLOGATION": "https://pix-h.api.efipay.com.br", "PRODUCTION": "https://pix.api.efipay.com.br"}
    _allowed_hosts = {"pix-h.api.efipay.com.br", "pix.api.efipay.com.br"}

    @staticmethod
    def _configuration(*, environment: str, credentials: dict[str, Any], settings: dict[str, Any] | None = None) -> tuple[str, str, str, str, str, int]:
        normalized_environment = environment.upper()
        base_url = EfiBankingProvider._base_urls.get(normalized_environment)
        if not base_url:
            raise BankProviderError("BANK_INVALID_REQUEST", "A implementação Efí aceita somente HOMOLOGATION ou PRODUCTION.", details={"environment": normalized_environment})
        values = {key: str(credentials.get(key) or "").strip() for key in ("client_id", "client_secret", "certificate", "private_key", "pix_key")}
        missing = [key for key in ("client_id", "client_secret", "certificate", "private_key") if not values[key]]
        if missing:
            raise BankProviderError("BANK_INVALID_CREDENTIALS", "Credenciais Efí incompletas.", details={"missing_fields": missing})
        try:
            expiration = int((settings or {}).get("pix_expiration_seconds", 3600))
        except (TypeError, ValueError) as exc:
            raise BankProviderError("BANK_INVALID_REQUEST", "pix_expiration_seconds deve ser um número inteiro.") from exc
        if expiration <= 0:
            raise BankProviderError("BANK_INVALID_REQUEST", "pix_expiration_seconds deve ser maior que zero.")
        return base_url, values["client_id"], values["client_secret"], values["certificate"], values["private_key"], expiration

    @staticmethod
    @asynccontextmanager
    async def _certificate_files(certificate: str, private_key: str) -> AsyncIterator[tuple[str, str]]:
        cert_file = tempfile.NamedTemporaryFile("w", encoding="utf-8", prefix="connect-api-efi-cert-", suffix=".pem", delete=False)
        key_file = tempfile.NamedTemporaryFile("w", encoding="utf-8", prefix="connect-api-efi-key-", suffix=".pem", delete=False)
        cert_path, key_path = Path(cert_file.name), Path(key_file.name)
        try:
            cert_file.write(certificate); key_file.write(private_key)
            cert_file.flush(); key_file.flush(); cert_file.close(); key_file.close()
            os.chmod(cert_path, 0o600); os.chmod(key_path, 0o600)
            yield str(cert_path), str(key_path)
        finally:
            try: cert_file.close()
            except Exception: pass
            try: key_file.close()
            except Exception: pass
            cert_path.unlink(missing_ok=True); key_path.unlink(missing_ok=True)

    @classmethod
    @asynccontextmanager
    async def _client(cls, *, environment: str, credentials: dict[str, Any], settings: dict[str, Any] | None = None, correlation_id: str | None = None) -> AsyncIterator[tuple[BankHTTPClient, str, int]]:
        base_url, client_id, client_secret, certificate, private_key, expiration = cls._configuration(environment=environment, credentials=credentials, settings=settings)
        async with cls._certificate_files(certificate, private_key) as cert:
            auth = OAuth2ClientCredentials(provider=cls.name, environment=environment.upper(), token_url=f"{base_url}/oauth/token", allowed_hosts=cls._allowed_hosts, client_id=client_id, client_secret=client_secret, redis=None, client_auth="BASIC", body_mode="JSON", cert=cert)
            material = await auth.material()
            async with BankHTTPClient(provider=cls.name, base_url=base_url, allowed_hosts=cls._allowed_hosts, headers={**material.headers, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Connect-API-Platform/1.0"}, cert=cert) as client:
                yield client, str(credentials.get("pix_key") or "").strip(), expiration

    @staticmethod
    def _txid(internal_id: str) -> str:
        candidate = re.sub(r"[^A-Za-z0-9]", "", internal_id)
        if 26 <= len(candidate) <= 35:
            return candidate[:35]
        return hashlib.sha256(internal_id.encode("utf-8")).hexdigest()[:32]

    @staticmethod
    def _debtor(request: BankChargeRequest) -> dict[str, str] | None:
        tax_id = re.sub(r"\D", "", request.customer.tax_id or "")
        if len(tax_id) not in {11, 14}: return None
        result = {"nome": request.customer.name}
        result["cpf" if len(tax_id) == 11 else "cnpj"] = tax_id
        return result

    @classmethod
    def _agreement_data(cls, request: BankChargeRequest) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = request.agreement or {}
        return str(agreement.get("environment") or "HOMOLOGATION").upper(), dict(agreement.get("credentials") or {}), dict(agreement.get("settings") or {})

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id): pass
        return {"status": "CONNECTED", "provider": self.name, "authentication_verified": True, "financial_operation": False}

    async def get_balance(self, context: BankingProviderContext) -> BalanceResult:
        try:
            async with self._client(
                environment=context.environment.value,
                credentials=context.credentials,
                settings=context.settings,
                correlation_id=context.correlation_id,
            ) as (client, _, _):
                data = (await client.request("GET", "/v2/gn/saldo", params={"bloqueios": "true"})).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

        try:
            available = Decimal(str(data.get("saldo") or "0"))
            blocks = dict(data.get("bloqueios") or {})
            blocked = Decimal(str(blocks.get("total") or "0"))
        except (TypeError, ValueError, ArithmeticError) as exc:
            raise APIError(
                "BANK_PROVIDER_INVALID_RESPONSE",
                "A Efí retornou um saldo em formato inválido.",
                502,
                {"provider": self.name},
            ) from exc

        return BalanceResult(
            available=available,
            current=available,
            blocked=blocked,
            currency="BRL",
            provider_status="AVAILABLE",
            provider_metadata={
                "blocked_judicial": str(blocks.get("judicial") or "0"),
                "blocked_med": str(blocks.get("med") or "0"),
            },
            raw_response={"saldo": str(data.get("saldo") or "0"), "bloqueios": blocks},
        )

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError("BANK_CAPABILITY_NOT_SUPPORTED", "O driver Efí rc.32 implementa Pix Cob imediata para o contrato de cobrança genérico.", 422, {"provider": self.name, "charge_type": request.charge_type.upper()})
        if Decimal(request.amount) <= 0: raise APIError("INVALID_CHARGE_AMOUNT", "O valor da cobrança precisa ser maior que zero.", 422)
        environment, credentials, settings = self._agreement_data(request); txid = self._txid(request.internal_id)
        try:
            async with self._client(environment=environment, credentials=credentials, settings=settings) as (client, pix_key, expiration):
                if not pix_key:
                    raise APIError(
                        "BANK_INVALID_CREDENTIALS",
                        "A chave Pix recebedora é obrigatória para emitir Pix Cob na Efí.",
                        422,
                        {"missing_fields": ["pix_key"]},
                    )
                payload: dict[str, Any] = {"calendario": {"expiracao": expiration}, "valor": {"original": f"{Decimal(request.amount):.2f}"}, "chave": pix_key}
                debtor = self._debtor(request)
                if debtor: payload["devedor"] = debtor
                if request.description: payload["solicitacaoPagador"] = request.description[:140]
                data = (await client.request("PUT", f"/v2/cob/{txid}", json=payload)).json()
        except BankProviderError as exc: raise exc.as_api_error() from exc
        provider_txid = str(data.get("txid") or txid)
        return BankChargeResult(provider=self.name, external_id=provider_txid, status=str(data.get("status") or "ATIVA").upper(), txid=provider_txid, pix_copy_paste=data.get("pixCopiaECola"), raw={key: data.get(key) for key in ("txid", "status", "calendario", "valor", "loc")})

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult:
        agreement = agreement or {}; environment = str(agreement.get("environment") or "HOMOLOGATION").upper(); credentials = dict(agreement.get("credentials") or {}); settings = dict(agreement.get("settings") or {})
        try:
            async with self._client(environment=environment, credentials=credentials, settings=settings) as (client, _, _): data = (await client.request("GET", f"/v2/cob/{external_id}")).json()
        except BankProviderError as exc: raise exc.as_api_error() from exc
        txid = str(data.get("txid") or external_id)
        return BankChargeResult(provider=self.name, external_id=txid, status=str(data.get("status") or "ATIVA").upper(), txid=txid, pix_copy_paste=data.get("pixCopiaECola"), raw={key: data.get(key) for key in ("txid", "status", "calendario", "valor", "loc")})

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        agreement = agreement or {}; environment = str(agreement.get("environment") or "HOMOLOGATION").upper(); credentials = dict(agreement.get("credentials") or {}); settings = dict(agreement.get("settings") or {})
        try:
            async with self._client(environment=environment, credentials=credentials, settings=settings) as (client, _, _): await client.request("PATCH", f"/v2/cob/{external_id}", json={"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"})
        except BankProviderError as exc: raise exc.as_api_error() from exc
