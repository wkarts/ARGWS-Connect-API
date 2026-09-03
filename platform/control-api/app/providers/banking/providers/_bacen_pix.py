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
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient


@asynccontextmanager
async def _null_certificate() -> AsyncIterator[None]:
    yield None


class BacenPixCobMTLSProvider:
    """Executor reutilizável para APIs Pix que seguem o contrato Cob do BCB.

    Cada provider concreto continua responsável pelos próprios hosts, ambientes,
    documentação e credenciais. Esta classe apenas concentra o contrato comum
    de OAuth2 Client Credentials + mTLS e os recursos /cob/{txid}.
    """

    name = "UNDEFINED"
    driver_version = "1.0.0-rc.28"
    scopes: tuple[str, ...] = ("cob.write", "cob.read")
    allowed_hosts: set[str] = set()
    certificate_required = False

    @classmethod
    def endpoints(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any],
    ) -> tuple[str, str]:
        raise NotImplementedError

    @staticmethod
    @asynccontextmanager
    async def certificate_files(certificate: str, private_key: str) -> AsyncIterator[tuple[str, str]]:
        cert_file = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", prefix="connect-api-bank-cert-", suffix=".pem", delete=False
        )
        key_file = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", prefix="connect-api-bank-key-", suffix=".pem", delete=False
        )
        cert_path = Path(cert_file.name)
        key_path = Path(key_file.name)
        try:
            cert_file.write(certificate)
            key_file.write(private_key)
            cert_file.flush()
            key_file.flush()
            cert_file.close()
            key_file.close()
            os.chmod(cert_path, 0o600)
            os.chmod(key_path, 0o600)
            yield str(cert_path), str(key_path)
        finally:
            try:
                cert_file.close()
            except Exception:
                pass
            try:
                key_file.close()
            except Exception:
                pass
            cert_path.unlink(missing_ok=True)
            key_path.unlink(missing_ok=True)

    @classmethod
    def configuration(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
    ) -> tuple[str, str, str, str, str, str, int]:
        values = {
            key: str(credentials.get(key) or "").strip()
            for key in ("client_id", "client_secret", "certificate", "private_key", "pix_key")
        }
        required = ["client_id", "client_secret", "pix_key"]
        if cls.certificate_required:
            required.extend(["certificate", "private_key"])
        missing = [key for key in required if not values[key]]
        if bool(values["certificate"]) != bool(values["private_key"]):
            missing.extend(key for key in ("certificate", "private_key") if not values[key])
        if missing:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                f"Credenciais {cls.name} incompletas.",
                details={"missing_fields": missing},
            )
        settings = dict(settings or {})
        token_url, resource_base_url = cls.endpoints(
            environment=environment.upper(), credentials=credentials, settings=settings
        )
        try:
            expiration = int(settings.get("pix_expiration_seconds", 3600))
        except (TypeError, ValueError) as exc:
            raise BankProviderError(
                "BANK_INVALID_REQUEST", "pix_expiration_seconds deve ser um número inteiro."
            ) from exc
        if expiration <= 0:
            raise BankProviderError(
                "BANK_INVALID_REQUEST", "pix_expiration_seconds deve ser maior que zero."
            )
        return (
            token_url,
            resource_base_url,
            values["client_id"],
            values["client_secret"],
            values["certificate"],
            values["private_key"],
            expiration,
        )

    @classmethod
    @asynccontextmanager
    async def client(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> AsyncIterator[tuple[BankHTTPClient, str, int]]:
        (
            token_url,
            resource_base_url,
            client_id,
            client_secret,
            certificate,
            private_key,
            expiration,
        ) = cls.configuration(environment=environment, credentials=credentials, settings=settings)
        certificate_context = (
            cls.certificate_files(certificate, private_key)
            if certificate and private_key
            else _null_certificate()
        )
        async with certificate_context as cert:
            auth = OAuth2ClientCredentials(
                provider=cls.name,
                environment=environment.upper(),
                token_url=token_url,
                allowed_hosts=cls.allowed_hosts,
                client_id=client_id,
                client_secret=client_secret,
                redis=None,
                scopes=cls.scopes,
                client_auth="BASIC",
                body_mode="FORM",
                cert=cert,
            )
            material = await auth.material()
            async with BankHTTPClient(
                provider=cls.name,
                base_url=resource_base_url,
                allowed_hosts=cls.allowed_hosts,
                headers={
                    **material.headers,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "Connect-API-Platform/1.0",
                },
                cert=cert,
            ) as bank_client:
                yield bank_client, str(credentials["pix_key"]).strip(), expiration

    @staticmethod
    def txid(internal_id: str) -> str:
        candidate = re.sub(r"[^A-Za-z0-9]", "", internal_id)
        if 26 <= len(candidate) <= 35:
            return candidate[:35]
        return hashlib.sha256(internal_id.encode("utf-8")).hexdigest()[:32]

    @staticmethod
    def debtor(request: BankChargeRequest) -> dict[str, str] | None:
        tax_id = re.sub(r"\D", "", request.customer.tax_id or "")
        if len(tax_id) not in {11, 14}:
            return None
        result = {"nome": request.customer.name}
        result["cpf" if len(tax_id) == 11 else "cnpj"] = tax_id
        return result

    @staticmethod
    def agreement_data(request: BankChargeRequest) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = request.agreement or {}
        return (
            str(agreement.get("environment") or "HOMOLOGATION").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    @staticmethod
    def result_from_payload(provider: str, txid: str, data: dict[str, Any]) -> BankChargeResult:
        provider_txid = str(data.get("txid") or txid)
        location = data.get("location") or (data.get("loc") or {}).get("location")
        document_url = None
        if isinstance(location, str) and location:
            document_url = location if location.startswith("http") else f"https://{location}"
        return BankChargeResult(
            provider=provider,
            external_id=provider_txid,
            status=str(data.get("status") or "ATIVA").upper(),
            txid=provider_txid,
            pix_copy_paste=data.get("pixCopiaECola"),
            document_url=document_url,
            raw={key: data.get(key) for key in ("txid", "status", "calendario", "valor", "loc", "location")},
        )

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        async with self.client(
            environment=context.environment.value,
            credentials=context.credentials,
            settings=context.settings,
            correlation_id=context.correlation_id,
        ):
            pass
        return {
            "status": "CONNECTED",
            "provider": self.name,
            "authentication_verified": True,
            "financial_operation": False,
        }

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        if request.charge_type.upper() not in {"PIX", "PIX_COB"}:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                f"O driver {self.name} rc.28 implementa somente Pix Cob imediata.",
                422,
                {"provider": self.name, "charge_type": request.charge_type.upper()},
            )
        if Decimal(request.amount) <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor da cobrança precisa ser maior que zero.", 422)
        environment, credentials, settings = self.agreement_data(request)
        txid = self.txid(request.internal_id)
        try:
            async with self.client(environment=environment, credentials=credentials, settings=settings) as (
                client,
                pix_key,
                expiration,
            ):
                payload: dict[str, Any] = {
                    "calendario": {"expiracao": expiration},
                    "valor": {"original": f"{Decimal(request.amount):.2f}"},
                    "chave": pix_key,
                }
                debtor = self.debtor(request)
                if debtor:
                    payload["devedor"] = debtor
                if request.description:
                    payload["solicitacaoPagador"] = request.description[:140]
                data = (await client.request("PUT", f"/cob/{txid}", json=payload)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self.result_from_payload(self.name, txid, data)

    async def get_charge(
        self, external_id: str, agreement: dict[str, Any] | None = None
    ) -> BankChargeResult:
        agreement = agreement or {}
        environment = str(agreement.get("environment") or "HOMOLOGATION").upper()
        credentials = dict(agreement.get("credentials") or {})
        settings = dict(agreement.get("settings") or {})
        try:
            async with self.client(environment=environment, credentials=credentials, settings=settings) as (
                client,
                _,
                _,
            ):
                data = (await client.request("GET", f"/cob/{external_id}")).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self.result_from_payload(self.name, external_id, data)

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        agreement = agreement or {}
        environment = str(agreement.get("environment") or "HOMOLOGATION").upper()
        credentials = dict(agreement.get("credentials") or {})
        settings = dict(agreement.get("settings") or {})
        try:
            async with self.client(environment=environment, credentials=credentials, settings=settings) as (
                client,
                _,
                _,
            ):
                await client.request(
                    "PATCH",
                    f"/cob/{external_id}",
                    json={"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"},
                )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
