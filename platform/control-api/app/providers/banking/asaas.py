from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import httpx

from app.core.errors import APIError
from app.providers.banking.base import (
    BankChargeRequest,
    BankChargeResult,
    BankCustomer,
    PixAutomaticAuthorizationRequest,
    PixAutomaticAuthorizationResult,
)


class AsaasBankingProvider:
    """Adapter para a API de cobranças Asaas.

    As credenciais são recebidas pelo convênio bancário de cada empresa. O
    provider não mantém segredo global nem compartilha contexto entre tenants.
    Para produção, o convênio deve informar ``api_key`` e pode sobrescrever
    ``base_url``. O endpoint sandbox padrão é usado quando o ambiente do
    convênio é SANDBOX/HOMOLOGATION.
    """

    name = "ASAAS"
    production_url = "https://api.asaas.com/v3"
    sandbox_url = "https://api-sandbox.asaas.com/v3"

    @staticmethod
    def _configuration(agreement: dict[str, Any] | None) -> tuple[str, str]:
        data = agreement or {}
        credentials = dict(data.get("credentials") or {})
        provider_settings = dict(data.get("settings") or {})
        api_key = str(credentials.get("api_key") or credentials.get("access_token") or "").strip()
        if not api_key:
            raise APIError(
                "ASAAS_CREDENTIALS_MISSING",
                "Informe api_key nas credenciais do convênio Asaas.",
                422,
            )
        environment = str(data.get("environment") or provider_settings.get("environment") or "SANDBOX").upper()
        default_url = AsaasBankingProvider.production_url if environment == "PRODUCTION" else AsaasBankingProvider.sandbox_url
        base_url = str(credentials.get("base_url") or provider_settings.get("base_url") or default_url).rstrip("/")
        return base_url, api_key

    @classmethod
    def _client(cls, agreement: dict[str, Any] | None) -> httpx.AsyncClient:
        base_url, api_key = cls._configuration(agreement)
        return httpx.AsyncClient(
            base_url=base_url,
            headers={"access_token": api_key, "Content-Type": "application/json", "User-Agent": "Connect-API-Platform/1.0"},
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    @staticmethod
    async def _raise_api_error(response: httpx.Response, operation: str) -> None:
        if response.is_success:
            return
        try:
            body: Any = response.json()
        except ValueError:
            body = {"message": response.text[:1000]}
        message = "Falha na integração Asaas."
        if isinstance(body, dict):
            errors = body.get("errors")
            if isinstance(errors, list) and errors and isinstance(errors[0], dict):
                message = str(errors[0].get("description") or errors[0].get("code") or message)
            else:
                message = str(body.get("message") or message)
        raise APIError(
            "ASAAS_API_ERROR",
            message,
            502,
            {"operation": operation, "status_code": response.status_code},
        )

    async def _ensure_customer_data(
        self, client: httpx.AsyncClient, customer: BankCustomer, internal_reference: str
    ) -> str:
        if customer.tax_id:
            response = await client.get("/customers", params={"cpfCnpj": customer.tax_id, "limit": 1})
            await self._raise_api_error(response, "customer.search")
            data = response.json().get("data") or []
            if data:
                return str(data[0]["id"])
        address = customer.address or {}
        payload = {
            "name": customer.name,
            "cpfCnpj": customer.tax_id,
            "email": customer.email,
            "mobilePhone": customer.phone,
            "postalCode": address.get("postal_code") or address.get("zip_code") or address.get("cep"),
            "address": address.get("street") or address.get("address"),
            "addressNumber": address.get("number"),
            "complement": address.get("complement"),
            "province": address.get("district") or address.get("neighborhood"),
            "externalReference": f"connect-api-customer-{internal_reference}",
            "notificationDisabled": False,
        }
        payload = {key: value for key, value in payload.items() if value not in (None, "")}
        response = await client.post("/customers", json=payload)
        await self._raise_api_error(response, "customer.create")
        return str(response.json()["id"])

    async def _ensure_customer(self, client: httpx.AsyncClient, request: BankChargeRequest) -> str:
        return await self._ensure_customer_data(client, request.customer, request.internal_id)

    @staticmethod
    def _billing_type(charge_type: str) -> str:
        normalized = charge_type.upper()
        if normalized == "PIX":
            return "PIX"
        if normalized == "BOLETO":
            return "BOLETO"
        return "UNDEFINED"

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        agreement = request.agreement or {}
        async with self._client(agreement) as client:
            customer_id = await self._ensure_customer(client, request)
            payload: dict[str, Any] = {
                "customer": customer_id,
                "billingType": self._billing_type(request.charge_type),
                "value": float(Decimal(request.amount)),
                "dueDate": request.due_date.isoformat(),
                "description": request.description[:500],
                "externalReference": request.internal_id,
                "postalService": False,
            }
            provider_settings = dict(agreement.get("settings") or {})
            if provider_settings.get("fine_percent") is not None:
                payload["fine"] = {"value": float(provider_settings["fine_percent"]), "type": "PERCENTAGE"}
            if provider_settings.get("interest_percent_monthly") is not None:
                payload["interest"] = {"value": float(provider_settings["interest_percent_monthly"])}
            response = await client.post("/payments", json=payload)
            await self._raise_api_error(response, "payment.create")
            data = response.json()
            payment_id = str(data["id"])
            pix_copy_paste = None
            txid = None
            digitable_line = data.get("identificationField")
            barcode = data.get("barCode")
            our_number = data.get("nossoNumero") or data.get("nossoNumeroFormatado")
            identification_response = await client.get(f"/payments/{payment_id}/identificationField")
            if identification_response.is_success:
                identification = identification_response.json()
                digitable_line = identification.get("identificationField") or identification.get("linhaDigitavel") or digitable_line
                barcode = identification.get("barCode") or identification.get("barcode") or barcode
                our_number = identification.get("nossoNumero") or our_number
            if request.charge_type.upper() in {"PIX", "BOLETO", "BOLETO_PIX", "UNDEFINED"}:
                pix_response = await client.get(f"/payments/{payment_id}/pixQrCode")
                if pix_response.is_success:
                    pix = pix_response.json()
                    pix_copy_paste = pix.get("payload")
                    # A API não expõe um txid separado neste endpoint; o ID da cobrança
                    # permanece como identificador externo e a expiração é preservada no raw.
                    txid = str(pix.get("transactionId") or "") or None
                else:
                    pix = {}
            else:
                pix = {}
            return BankChargeResult(
                provider=self.name,
                external_id=payment_id,
                status=str(data.get("status") or "PENDING").upper(),
                our_number=our_number,
                txid=txid,
                digitable_line=digitable_line,
                barcode=barcode,
                pix_copy_paste=pix_copy_paste,
                document_url=data.get("bankSlipUrl") or data.get("invoiceUrl"),
                raw={
                    "id": payment_id,
                    "status": data.get("status"),
                    "invoiceUrl": data.get("invoiceUrl"),
                    "bankSlipUrl": data.get("bankSlipUrl"),
                    "billingType": data.get("billingType"),
                    "dueDate": data.get("dueDate"),
                    "value": data.get("value"),
                    "pixExpirationDate": pix.get("expirationDate"),
                },
            )

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        async with self._client(agreement) as client:
            response = await client.delete(f"/payments/{external_id}")
            await self._raise_api_error(response, "payment.cancel")

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult:
        async with self._client(agreement) as client:
            response = await client.get(f"/payments/{external_id}")
            await self._raise_api_error(response, "payment.get")
            data = response.json()
            return BankChargeResult(
                provider=self.name,
                external_id=external_id,
                status=str(data.get("status") or "PENDING").upper(),
                our_number=data.get("nossoNumero"),
                digitable_line=data.get("identificationField"),
                barcode=data.get("barCode"),
                document_url=data.get("bankSlipUrl") or data.get("invoiceUrl"),
                raw={"status": data.get("status"), "billingType": data.get("billingType"), "dueDate": data.get("dueDate"), "value": data.get("value")},
            )


    async def create_pix_automatic_authorization(
        self, request: PixAutomaticAuthorizationRequest
    ) -> PixAutomaticAuthorizationResult:
        agreement = request.agreement or {}
        async with self._client(agreement) as client:
            customer_id = await self._ensure_customer_data(
                client, request.customer, request.internal_contract_id
            )
            immediate: dict[str, Any] = {
                "value": float(Decimal(request.immediate_amount)),
                "dueDate": request.immediate_due_date.isoformat(),
                "description": request.description[:35],
            }
            payload: dict[str, Any] = {
                "customerId": customer_id,
                "frequency": request.frequency.upper(),
                "contractId": request.internal_contract_id[:35],
                "startDate": request.start_date.isoformat(),
                "description": request.description[:35],
                "immediateQrCode": immediate,
                "paymentCreationMode": request.payment_creation_mode.upper(),
                "retryPolicy": request.retry_policy.upper(),
            }
            if request.finish_date is not None:
                payload["finishDate"] = request.finish_date.isoformat()
            if request.fixed_amount is not None:
                payload["value"] = float(Decimal(request.fixed_amount))
            elif request.min_limit_value is not None:
                payload["minLimitValue"] = float(Decimal(request.min_limit_value))
            response = await client.post("/pix/automatic/authorizations", json=payload)
            await self._raise_api_error(response, "pix_automatic.authorization.create")
            data = response.json()
            immediate_data = data.get("immediateQrCode") or data.get("qrCode") or {}
            external_id = str(data.get("id") or data.get("authorizationId") or "")
            if not external_id:
                raise APIError(
                    "ASAAS_INVALID_RESPONSE",
                    "A API Asaas não retornou o identificador da autorização Pix Automático.",
                    502,
                )
            return PixAutomaticAuthorizationResult(
                provider=self.name,
                external_id=external_id,
                status=str(data.get("status") or "CREATED").upper(),
                authorization_url=(
                    data.get("authorizationUrl")
                    or immediate_data.get("url")
                    or immediate_data.get("invoiceUrl")
                ),
                qr_copy_paste=immediate_data.get("payload") or data.get("payload"),
                qr_encoded_image=immediate_data.get("encodedImage") or data.get("encodedImage"),
                raw=data,
            )

    async def get_pix_automatic_authorization(
        self, external_id: str, agreement: dict[str, Any] | None = None
    ) -> PixAutomaticAuthorizationResult:
        async with self._client(agreement) as client:
            response = await client.get(f"/pix/automatic/authorizations/{external_id}")
            await self._raise_api_error(response, "pix_automatic.authorization.get")
            data = response.json()
            immediate_data = data.get("immediateQrCode") or data.get("qrCode") or {}
            return PixAutomaticAuthorizationResult(
                provider=self.name,
                external_id=external_id,
                status=str(data.get("status") or "CREATED").upper(),
                authorization_url=data.get("authorizationUrl") or immediate_data.get("url"),
                qr_copy_paste=immediate_data.get("payload") or data.get("payload"),
                qr_encoded_image=immediate_data.get("encodedImage") or data.get("encodedImage"),
                raw=data,
            )

    async def cancel_pix_automatic_authorization(
        self, external_id: str, agreement: dict[str, Any] | None = None
    ) -> None:
        async with self._client(agreement) as client:
            response = await client.delete(f"/pix/automatic/authorizations/{external_id}")
            await self._raise_api_error(response, "pix_automatic.authorization.cancel")
