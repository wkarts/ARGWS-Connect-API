from __future__ import annotations

import base64
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.contracts.balance import BalanceResult
from app.providers.banking.contracts.statements import (
    BankTransactionResult,
    StatementRequest,
    StatementResult,
)
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers._bacen_pix import BacenPixCobMTLSProvider
from app.providers.banking.providers.inter.client import inter_http_client
from app.providers.banking.providers.inter.constants import (
    BANKING_BALANCE,
    BANKING_ENRICHED_STATEMENT,
    BANKING_PAYMENT,
    BANKING_PAYMENT_DARF,
    BANKING_PAYMENT_PIX,
    BANKING_STATEMENT_PDF,
    BANKING_WEBHOOK,
    BILLING,
    BILLING_SUMMARY,
    BILLING_WEBHOOK,
    BILLING_WEBHOOK_CALLBACKS,
    PIX_COB,
    PIX_COBV,
    PIX_COBV_BATCH,
    PIX_LOCATIONS,
    PIX_RECEIVED,
    PIX_WEBHOOK,
    PIX_WEBHOOK_CALLBACKS,
    SCOPE_BANKING_WEBHOOK_READ,
    SCOPE_BANKING_WEBHOOK_WRITE,
    SCOPE_BILLING_READ,
    SCOPE_BILLING_WRITE,
    SCOPE_BOLETO_PAYMENT_READ,
    SCOPE_BOLETO_PAYMENT_WRITE,
    SCOPE_COB_READ,
    SCOPE_COB_WRITE,
    SCOPE_COBV_BATCH_READ,
    SCOPE_COBV_BATCH_WRITE,
    SCOPE_COBV_READ,
    SCOPE_COBV_WRITE,
    SCOPE_DARF_PAYMENT_WRITE,
    SCOPE_LOCATION_READ,
    SCOPE_LOCATION_WRITE,
    SCOPE_PIX_PAYMENT_READ,
    SCOPE_PIX_PAYMENT_WRITE,
    SCOPE_PIX_READ,
    SCOPE_PIX_WEBHOOK_READ,
    SCOPE_PIX_WEBHOOK_WRITE,
    SCOPE_PIX_WRITE,
    SCOPE_STATEMENT_READ,
)


class InterBankingProvider:
    name = "INTER"
    driver_version = "1.0.0-rc.31"

    @staticmethod
    def _decimal(value: Any, *, default: str = "0") -> Decimal:
        try:
            return Decimal(str(value if value not in (None, "") else default))
        except (InvalidOperation, ValueError, TypeError):
            return Decimal(default)

    @staticmethod
    def _date(value: Any) -> date:
        raw = str(value or "").strip()
        for candidate in (raw[:10],):
            try:
                return date.fromisoformat(candidate)
            except ValueError:
                continue
        return date.today()

    @staticmethod
    def _datetime(value: Any) -> datetime | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        normalized = raw.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed
        except ValueError:
            for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
                try:
                    return datetime.strptime(raw[:10], fmt).replace(tzinfo=UTC)
                except ValueError:
                    continue
        return None

    @staticmethod
    def _json(response: Any) -> dict[str, Any] | list[Any]:
        if response.status_code in {202, 204} or not response.content:
            return {}
        try:
            value = response.json()
        except ValueError as exc:
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta JSON do Banco Inter inválida.") from exc
        if not isinstance(value, (dict, list)):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta do Banco Inter fora do contrato esperado.")
        return value

    @classmethod
    async def _request(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        scopes: tuple[str, ...],
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        correlation_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any] | list[Any]:
        async with inter_http_client(
            environment=environment,
            credentials=credentials,
            scopes=scopes,
            correlation_id=correlation_id,
        ) as (client, _):
            response = await client.request(
                method,
                path,
                params=params,
                json=payload,
                correlation_id=correlation_id,
                idempotency_key=idempotency_key,
            )
            return cls._json(response)

    @staticmethod
    def _agreement_data(request: BankChargeRequest) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = request.agreement or {}
        return (
            str(agreement.get("environment") or "SANDBOX").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    @staticmethod
    def _person_payload(request: BankChargeRequest) -> dict[str, Any]:
        customer = request.customer
        tax_id = "".join(ch for ch in str(customer.tax_id or "") if ch.isdigit())
        address = dict(customer.address or {})
        payload: dict[str, Any] = {
            "cpfCnpj": tax_id or None,
            "tipoPessoa": "FISICA" if len(tax_id) == 11 else "JURIDICA" if len(tax_id) == 14 else None,
            "nome": customer.name,
            "endereco": address.get("street") or address.get("logradouro"),
            "numero": address.get("number") or address.get("numero"),
            "complemento": address.get("complement") or address.get("complemento"),
            "bairro": address.get("neighborhood") or address.get("bairro"),
            "cidade": address.get("city") or address.get("cidade"),
            "uf": address.get("state") or address.get("uf"),
            "cep": address.get("zip_code") or address.get("cep"),
            "email": customer.email,
        }
        phone = "".join(ch for ch in str(customer.phone or "") if ch.isdigit())
        if len(phone) >= 10:
            payload["ddd"] = phone[-11:-9] if len(phone) >= 11 else phone[-10:-8]
            payload["telefone"] = phone[-9:] if len(phone) >= 11 else phone[-8:]
        return {key: value for key, value in payload.items() if value not in (None, "")}

    @classmethod
    def _billing_result(cls, request_code: str, data: dict[str, Any]) -> BankChargeResult:
        billing = data.get("cobranca") if isinstance(data.get("cobranca"), dict) else {}
        billet = data.get("boleto") if isinstance(data.get("boleto"), dict) else {}
        pix = data.get("pix") if isinstance(data.get("pix"), dict) else {}
        raw_status = str(billing.get("situacao") or "A_RECEBER").upper()
        status = {
            "RECEBIDO": "PAID",
            "MARCADO_RECEBIDO": "PAID",
            "A_RECEBER": "PENDING",
            "ATRASADO": "OVERDUE",
            "CANCELADO": "CANCELLED",
            "EXPIRADO": "EXPIRED",
            "FALHA_EMISSAO": "FAILED",
            "EM_PROCESSAMENTO": "PROCESSING",
            "PROTESTO": "PROTEST",
        }.get(raw_status, raw_status)
        return BankChargeResult(
            provider=cls.name,
            external_id=request_code,
            status=status,
            our_number=str(billet.get("nossoNumero") or "") or None,
            txid=str(pix.get("txid") or "") or None,
            digitable_line=str(billet.get("linhaDigitavel") or "") or None,
            barcode=str(billet.get("codigoBarras") or "") or None,
            pix_copy_paste=str(pix.get("pixCopiaECola") or "") or None,
            raw=data,
        )

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        # Autentica com um scope real publicado; não executa movimentação financeira.
        async with inter_http_client(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_STATEMENT_READ,),
            correlation_id=context.correlation_id,
        ):
            pass
        return {
            "status": "CONNECTED",
            "provider": self.name,
            "authentication_verified": True,
            "financial_operation": False,
        }

    async def get_balance(self, context: BankingProviderContext) -> BalanceResult:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_STATEMENT_READ,),
            method="GET",
            path=BANKING_BALANCE,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Saldo Banco Inter fora do contrato esperado.")
        blocked = sum(
            (
                self._decimal(data.get("bloqueadoCheque")),
                self._decimal(data.get("bloqueadoJudicialmente")),
                self._decimal(data.get("bloqueadoAdministrativo")),
            ),
            Decimal("0"),
        )
        available = self._decimal(data.get("disponivel"))
        return BalanceResult(
            available=available,
            current=available,
            blocked=blocked,
            credit_limit=self._decimal(data.get("limite")),
            reference_at=self._datetime(data.get("dataReferencia")),
            provider_reference=str(data.get("dataReferencia") or "") or None,
            provider_status="AVAILABLE",
            provider_metadata={"data_referencia": data.get("dataReferencia")},
            raw_response=dict(data),
        )

    async def get_statement(
        self,
        context: BankingProviderContext,
        request: StatementRequest,
    ) -> StatementResult:
        try:
            page = max(0, int(request.cursor or "0"))
        except ValueError as exc:
            raise BankProviderError("BANK_INVALID_REQUEST", "Cursor de extrato Banco Inter inválido.") from exc
        page_size = max(1, min(1000, int(context.settings.get("statement_page_size") or 50)))
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_STATEMENT_READ,),
            method="GET",
            path=BANKING_ENRICHED_STATEMENT,
            params={
                "dataInicio": request.start_date.isoformat(),
                "dataFim": request.end_date.isoformat(),
                "pagina": page,
                "tamanhoPagina": page_size,
            },
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Extrato Banco Inter fora do contrato esperado.")
        transactions: list[BankTransactionResult] = []
        for index, item in enumerate(data.get("transacoes") or []):
            if not isinstance(item, dict):
                continue
            details = item.get("detalhes") if isinstance(item.get("detalhes"), dict) else {}
            amount = self._decimal(item.get("valor"))
            operation = str(item.get("tipoOperacao") or "").upper()
            if operation == "D" and amount > 0:
                amount = -amount
            transaction_id = str(item.get("idTransacao") or f"INTER-{request.start_date.isoformat()}-{page}-{index}")
            transactions.append(
                BankTransactionResult(
                    provider_transaction_id=transaction_id,
                    external_id=transaction_id,
                    amount=amount,
                    transaction_date=self._date(item.get("dataTransacao") or item.get("dataInclusao")),
                    transaction_type=(
                        "DEBIT" if operation == "D" else "CREDIT" if operation == "C" else operation or "UNKNOWN"
                    ),
                    description=str(item.get("descricao") or item.get("titulo") or item.get("tipoTransacao") or ""),
                    document_number=str(item.get("numeroDocumento") or "") or None,
                    end_to_end_id=str(details.get("endToEndId") or details.get("endToEnd") or "") or None,
                    txid=str(details.get("txid") or details.get("txId") or "") or None,
                    bank_reference=str(details.get("codigoSolicitacao") or transaction_id),
                    payer_name=str(details.get("nomePagador") or "") or None,
                    payer_tax_id=str(details.get("cpfCnpjPagador") or "") or None,
                    provider_status=str(item.get("tipoTransacao") or "") or None,
                    provider_metadata={
                        "tipo_operacao": item.get("tipoOperacao"),
                        "tipo_transacao": item.get("tipoTransacao"),
                        "tipo_detalhe": details.get("tipoDetalhe"),
                        "titulo": item.get("titulo"),
                    },
                    raw_response=dict(item),
                )
            )
        last_page = bool(data.get("ultimaPagina", True))
        next_cursor = None if last_page else str(page + 1)
        return StatementResult(
            transactions=tuple(transactions),
            next_cursor=next_cursor,
            has_more=not last_page,
            provider_reference=next_cursor,
            provider_metadata={
                "total_paginas": data.get("totalPaginas"),
                "total_elementos": data.get("totalElementos"),
                "numero_de_elementos": data.get("numeroDeElementos"),
                "pagina": page,
            },
            raw_response=dict(data),
        )

    async def get_statement_pdf(
        self,
        context: BankingProviderContext,
        *,
        start_date: date,
        end_date: date,
    ) -> bytes:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_STATEMENT_READ,),
            method="GET",
            path=BANKING_STATEMENT_PDF,
            params={"dataInicio": start_date.isoformat(), "dataFim": end_date.isoformat()},
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict) or not data.get("pdf"):
            raise BankProviderError("BANK_RESPONSE_INVALID", "PDF de extrato Banco Inter não retornado.")
        try:
            return base64.b64decode(str(data["pdf"]), validate=True)
        except ValueError as exc:
            raise BankProviderError("BANK_RESPONSE_INVALID", "PDF de extrato Banco Inter inválido.") from exc

    async def _create_pix_cob(self, request: BankChargeRequest, *, due: bool) -> BankChargeResult:
        environment, credentials, settings = self._agreement_data(request)
        txid = BacenPixCobMTLSProvider.txid(request.internal_id)
        pix_key = str(credentials.get("pix_key") or "").strip()
        if not pix_key:
            raise APIError(
                "BANK_INVALID_CREDENTIALS",
                "A chave Pix recebedora é obrigatória para cobrança Pix Banco Inter.",
                422,
                {"missing_fields": ["pix_key"]},
            )
        debtor = BacenPixCobMTLSProvider.debtor(request)
        if due:
            payload: dict[str, Any] = {
                "calendario": {
                    "dataDeVencimento": request.due_date.isoformat(),
                    "validadeAposVencimento": int(settings.get("pix_validity_after_due_days") or 0),
                },
                "valor": {"original": f"{Decimal(request.amount):.2f}"},
                "chave": pix_key,
            }
            path = f"{PIX_COBV}/{txid}"
            scopes = (SCOPE_COBV_WRITE,)
        else:
            payload = {
                "calendario": {"expiracao": int(settings.get("pix_expiration_seconds") or 3600)},
                "valor": {"original": f"{Decimal(request.amount):.2f}"},
                "chave": pix_key,
            }
            path = f"{PIX_COB}/{txid}"
            scopes = (SCOPE_COB_WRITE,)
        if debtor:
            payload["devedor"] = debtor
        if request.description:
            payload["solicitacaoPagador"] = request.description[:140]
        try:
            data = await self._request(
                environment=environment,
                credentials=credentials,
                scopes=scopes,
                method="PUT",
                path=path,
                payload=payload,
                idempotency_key=f"INTER-{txid}",
            )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        if not isinstance(data, dict):
            raise APIError("BANK_RESPONSE_INVALID", "Cobrança Pix Banco Inter fora do contrato esperado.", 502)
        return BacenPixCobMTLSProvider.result_from_payload(self.name, txid, data)

    async def _create_billing(self, request: BankChargeRequest) -> BankChargeResult:
        environment, credentials, settings = self._agreement_data(request)
        payload: dict[str, Any] = {
            "seuNumero": request.document_number,
            "valorNominal": f"{Decimal(request.amount):.2f}",
            "dataVencimento": request.due_date.isoformat(),
            "numDiasAgenda": int(settings.get("billing_scheduled_days") or 0),
            "pagador": self._person_payload(request),
        }
        receiving_method = str(settings.get("inter_receiving_method") or "").strip()
        if receiving_method:
            payload["formasRecebimento"] = receiving_method
        if request.description:
            payload["mensagem"] = {"linha1": request.description[:78]}
        try:
            issued = await self._request(
                environment=environment,
                credentials=credentials,
                scopes=(SCOPE_BILLING_WRITE,),
                method="POST",
                path=BILLING,
                payload=payload,
                idempotency_key=f"INTER-BILLING-{request.internal_id}",
            )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        if not isinstance(issued, dict) or not issued.get("codigoSolicitacao"):
            raise APIError("BANK_RESPONSE_INVALID", "Banco Inter não retornou codigoSolicitacao da cobrança.", 502)
        request_code = str(issued["codigoSolicitacao"])
        try:
            retrieved = await self._request(
                environment=environment,
                credentials=credentials,
                scopes=(SCOPE_BILLING_READ,),
                method="GET",
                path=f"{BILLING}/{request_code}",
            )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        if not isinstance(retrieved, dict):
            raise APIError("BANK_RESPONSE_INVALID", "Consulta da cobrança Banco Inter fora do contrato esperado.", 502)
        return self._billing_result(request_code, {**retrieved, "emissao": issued})

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        charge_type = request.charge_type.strip().upper()
        if charge_type in {"PIX", "PIX_COB"}:
            return await self._create_pix_cob(request, due=False)
        if charge_type == "PIX_COBV":
            return await self._create_pix_cob(request, due=True)
        if charge_type in {"BOLETO", "BOLETO_PIX", "BOLETO_HYBRID"}:
            return await self._create_billing(request)
        raise APIError(
            "BANK_CAPABILITY_NOT_SUPPORTED",
            "Tipo de cobrança não suportado pelo contrato Banco Inter instalado.",
            422,
            {"provider": self.name, "charge_type": charge_type},
        )

    async def get_billing(self, context: BankingProviderContext, request_code: str) -> BankChargeResult:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_READ,),
            method="GET",
            path=f"{BILLING}/{request_code}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Cobrança Banco Inter fora do contrato esperado.")
        return self._billing_result(request_code, data)

    async def cancel_billing(
        self,
        context: BankingProviderContext,
        request_code: str,
        *,
        reason: str,
    ) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_WRITE,),
            method="POST",
            path=f"{BILLING}/{request_code}/cancelar",
            payload={"motivoCancelamento": reason},
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-CANCEL-{request_code}",
        )

    async def get_billing_pdf(self, context: BankingProviderContext, request_code: str) -> bytes:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_READ,),
            method="GET",
            path=f"{BILLING}/{request_code}/pdf",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict) or not data.get("pdf"):
            raise BankProviderError("BANK_RESPONSE_INVALID", "PDF de cobrança Banco Inter não retornado.")
        try:
            return base64.b64decode(str(data["pdf"]), validate=True)
        except ValueError as exc:
            raise BankProviderError("BANK_RESPONSE_INVALID", "PDF de cobrança Banco Inter inválido.") from exc

    async def list_billings(
        self,
        context: BankingProviderContext,
        *,
        start_date: date,
        end_date: date,
        page: int = 0,
        page_size: int = 50,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "dataInicial": start_date.isoformat(),
            "dataFinal": end_date.isoformat(),
            "paginacao.paginaAtual": max(0, page),
            "paginacao.itensPorPagina": max(1, min(1000, page_size)),
        }
        params.update({key: value for key, value in (filters or {}).items() if value not in (None, "")})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_READ,),
            method="GET",
            path=BILLING,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista de cobranças Banco Inter inválida.")
        return data

    async def billing_summary(
        self,
        context: BankingProviderContext,
        *,
        start_date: date,
        end_date: date,
        filters: dict[str, Any] | None = None,
    ) -> list[Any]:
        params = {"dataInicial": start_date.isoformat(), "dataFinal": end_date.isoformat()}
        params.update({key: value for key, value in (filters or {}).items() if value not in (None, "")})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_READ,),
            method="GET",
            path=BILLING_SUMMARY,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, list):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Sumário de cobranças Banco Inter inválido.")
        return data

    async def get_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> BankChargeResult:
        agreement = agreement or {}
        environment = str(agreement.get("environment") or "SANDBOX").upper()
        credentials = dict(agreement.get("credentials") or {})
        # Compatibilidade com cobranças Pix rc.28: tenta Cob primeiro. Cobranças
        # Billing v3 devem preferir get_billing, que não depende de heurística.
        try:
            data = await self._request(
                environment=environment,
                credentials=credentials,
                scopes=(SCOPE_COB_READ,),
                method="GET",
                path=f"{PIX_COB}/{external_id}",
            )
            if isinstance(data, dict):
                return BacenPixCobMTLSProvider.result_from_payload(self.name, external_id, data)
        except BankProviderError as exc:
            if exc.provider_http_status != 404:
                raise exc.as_api_error() from exc
        try:
            data = await self._request(
                environment=environment,
                credentials=credentials,
                scopes=(SCOPE_BILLING_READ,),
                method="GET",
                path=f"{BILLING}/{external_id}",
            )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        if not isinstance(data, dict):
            raise APIError("BANK_RESPONSE_INVALID", "Cobrança Banco Inter fora do contrato esperado.", 502)
        return self._billing_result(external_id, data)

    async def cancel_charge(
        self,
        external_id: str,
        agreement: dict[str, Any] | None = None,
    ) -> None:
        agreement = agreement or {}
        environment = str(agreement.get("environment") or "SANDBOX").upper()
        credentials = dict(agreement.get("credentials") or {})
        # Mantém semântica histórica para Pix Cob. Billing v3 usa cancel_billing
        # com motivo explícito exigido pelo contrato oficial.
        try:
            await self._request(
                environment=environment,
                credentials=credentials,
                scopes=(SCOPE_COB_WRITE,),
                method="PATCH",
                path=f"{PIX_COB}/{external_id}",
                payload={"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"},
                idempotency_key=f"INTER-PIX-CANCEL-{external_id}",
            )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def create_due_pix_charge(
        self,
        context: BankingProviderContext,
        *,
        txid: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_WRITE,),
            method="PUT",
            path=f"{PIX_COBV}/{txid}",
            payload=payload,
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-COBV-{txid}",
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "CobV Banco Inter fora do contrato esperado.")
        return data

    async def get_due_pix_charge(self, context: BankingProviderContext, txid: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_READ,),
            method="GET",
            path=f"{PIX_COBV}/{txid}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "CobV Banco Inter fora do contrato esperado.")
        return data

    async def update_due_pix_charge(
        self,
        context: BankingProviderContext,
        *,
        txid: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_COBV_WRITE,),
            method="PATCH",
            path=f"{PIX_COBV}/{txid}",
            payload=payload,
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-COBV-PATCH-{txid}",
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Revisão CobV Banco Inter inválida.")
        return data

    async def manage_due_pix_batch(
        self,
        context: BankingProviderContext,
        *,
        batch_id: str,
        method: str,
        payload: dict[str, Any] | None = None,
        suffix: str = "",
    ) -> dict[str, Any]:
        scope = SCOPE_COBV_BATCH_READ if method.upper() == "GET" else SCOPE_COBV_BATCH_WRITE
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(scope,),
            method=method,
            path=f"{PIX_COBV_BATCH}/{batch_id}{suffix}",
            payload=payload,
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-COBV-BATCH-{batch_id}" if method.upper() != "GET" else None,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lote CobV Banco Inter fora do contrato esperado.")
        return data

    async def list_received_pix(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "inicio": start.isoformat().replace("+00:00", "Z"),
            "fim": end.isoformat().replace("+00:00", "Z"),
            "paginacao.paginaAtual": max(0, page),
            "paginacao.itensPorPagina": max(1, min(1000, page_size)),
        }
        params.update({key: value for key, value in (filters or {}).items() if value not in (None, "")})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_READ,),
            method="GET",
            path=PIX_RECEIVED,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista de Pix recebidos Banco Inter inválida.")
        return data

    async def get_received_pix(self, context: BankingProviderContext, e2e_id: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_READ,),
            method="GET",
            path=f"{PIX_RECEIVED}/{e2e_id}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Pix recebido Banco Inter inválido.")
        return data

    async def refund_pix(
        self,
        context: BankingProviderContext,
        *,
        e2e_id: str,
        refund_id: str,
        value: Decimal,
        nature: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"valor": f"{value:.2f}"}
        if nature:
            payload["natureza"] = nature
        if description:
            payload["descricao"] = description
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_WRITE,),
            method="PUT",
            path=f"{PIX_RECEIVED}/{e2e_id}/devolucao/{refund_id}",
            payload=payload,
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-REFUND-{e2e_id}-{refund_id}",
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Devolução Pix Banco Inter inválida.")
        return data

    async def get_pix_refund(
        self,
        context: BankingProviderContext,
        *,
        e2e_id: str,
        refund_id: str,
    ) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_READ,),
            method="GET",
            path=f"{PIX_RECEIVED}/{e2e_id}/devolucao/{refund_id}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Consulta de devolução Pix Banco Inter inválida.")
        return data

    async def pay_boleto(self, context: BankingProviderContext, payload: dict[str, Any]) -> dict[str, Any]:
        required = {"codBarraLinhaDigitavel", "valorPagar", "dataPagamento", "dataVencimento", "cpfCnpjBeneficiario"}
        missing = sorted(key for key in required if payload.get(key) in (None, ""))
        if missing:
            raise BankProviderError("BANK_INVALID_REQUEST", "Pagamento de boleto Banco Inter incompleto.", details={"missing_fields": missing})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BOLETO_PAYMENT_WRITE,),
            method="POST",
            path=BANKING_PAYMENT,
            payload=payload,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta de pagamento de boleto Banco Inter inválida.")
        return data

    async def list_boleto_payments(
        self,
        context: BankingProviderContext,
        *,
        start_date: date,
        end_date: date,
        filters: dict[str, Any] | None = None,
    ) -> list[Any]:
        params = {"dataInicio": start_date.isoformat(), "dataFim": end_date.isoformat()}
        params.update({key: value for key, value in (filters or {}).items() if value not in (None, "")})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BOLETO_PAYMENT_READ,),
            method="GET",
            path=BANKING_PAYMENT,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, list):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Lista de pagamentos Banco Inter inválida.")
        return data

    async def cancel_boleto_payment(self, context: BankingProviderContext, transaction_code: str) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BOLETO_PAYMENT_WRITE,),
            method="DELETE",
            path=f"{BANKING_PAYMENT}/{transaction_code}",
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-PAYMENT-CANCEL-{transaction_code}",
        )

    async def pay_darf(self, context: BankingProviderContext, payload: dict[str, Any]) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_DARF_PAYMENT_WRITE,),
            method="POST",
            path=BANKING_PAYMENT_DARF,
            payload=payload,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta DARF Banco Inter inválida.")
        return data

    async def pay_pix(self, context: BankingProviderContext, payload: dict[str, Any]) -> dict[str, Any]:
        required = {"valor", "dataPagamento", "destinatario"}
        missing = sorted(key for key in required if payload.get(key) in (None, ""))
        if missing:
            raise BankProviderError("BANK_INVALID_REQUEST", "Pagamento Pix Banco Inter incompleto.", details={"missing_fields": missing})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_PAYMENT_WRITE,),
            method="POST",
            path=BANKING_PAYMENT_PIX,
            payload=payload,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta de pagamento Pix Banco Inter inválida.")
        return data

    async def get_pix_payment(self, context: BankingProviderContext, request_code: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_PAYMENT_READ,),
            method="GET",
            path=f"{BANKING_PAYMENT_PIX}/{request_code}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Consulta de pagamento Pix Banco Inter inválida.")
        return data

    async def create_location(self, context: BankingProviderContext, billing_type: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_LOCATION_WRITE,),
            method="POST",
            path=PIX_LOCATIONS,
            payload={"tipoCob": billing_type},
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Location Pix Banco Inter inválida.")
        return data

    async def get_location(self, context: BankingProviderContext, location_id: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_LOCATION_READ,),
            method="GET",
            path=f"{PIX_LOCATIONS}/{location_id}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Location Pix Banco Inter inválida.")
        return data

    async def unlink_location(self, context: BankingProviderContext, location_id: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_LOCATION_WRITE,),
            method="DELETE",
            path=f"{PIX_LOCATIONS}/{location_id}/txid",
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-LOC-UNLINK-{location_id}",
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Desvinculação de Location Banco Inter inválida.")
        return data

    async def configure_pix_webhook(
        self,
        context: BankingProviderContext,
        *,
        pix_key: str,
        webhook_url: str,
    ) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_WEBHOOK_WRITE,),
            method="PUT",
            path=f"{PIX_WEBHOOK}/{pix_key}",
            payload={"webhookUrl": webhook_url},
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-PIX-WEBHOOK-{pix_key}",
        )

    async def get_pix_webhook(self, context: BankingProviderContext, pix_key: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_WEBHOOK_READ,),
            method="GET",
            path=f"{PIX_WEBHOOK}/{pix_key}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Webhook Pix Banco Inter inválido.")
        return data

    async def delete_pix_webhook(self, context: BankingProviderContext, pix_key: str) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_WEBHOOK_WRITE,),
            method="DELETE",
            path=f"{PIX_WEBHOOK}/{pix_key}",
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-PIX-WEBHOOK-DELETE-{pix_key}",
        )

    async def list_pix_webhook_callbacks(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        txid: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "dataHoraInicio": start.isoformat().replace("+00:00", "Z"),
            "dataHoraFim": end.isoformat().replace("+00:00", "Z"),
            "pagina": max(0, page),
            "tamanhoPagina": max(1, min(1000, page_size)),
        }
        if txid:
            params["txid"] = txid
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_PIX_WEBHOOK_READ,),
            method="GET",
            path=PIX_WEBHOOK_CALLBACKS,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Callbacks Pix Banco Inter inválidos.")
        return data

    async def configure_billing_webhook(self, context: BankingProviderContext, webhook_url: str) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_WRITE,),
            method="PUT",
            path=BILLING_WEBHOOK,
            payload={"webhookUrl": webhook_url},
            correlation_id=context.correlation_id,
            idempotency_key="INTER-BILLING-WEBHOOK",
        )

    async def get_billing_webhook(self, context: BankingProviderContext) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_READ,),
            method="GET",
            path=BILLING_WEBHOOK,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Webhook de cobrança Banco Inter inválido.")
        return data

    async def delete_billing_webhook(self, context: BankingProviderContext) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_WRITE,),
            method="DELETE",
            path=BILLING_WEBHOOK,
            correlation_id=context.correlation_id,
            idempotency_key="INTER-BILLING-WEBHOOK-DELETE",
        )

    async def list_billing_webhook_callbacks(
        self,
        context: BankingProviderContext,
        *,
        start: datetime,
        end: datetime,
        page: int = 0,
        page_size: int = 50,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "dataHoraInicio": start.isoformat().replace("+00:00", "Z"),
            "dataHoraFim": end.isoformat().replace("+00:00", "Z"),
            "pagina": max(0, page),
            "tamanhoPagina": max(1, min(1000, page_size)),
        }
        params.update({key: value for key, value in (filters or {}).items() if value not in (None, "")})
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BILLING_READ,),
            method="GET",
            path=BILLING_WEBHOOK_CALLBACKS,
            params=params,
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Callbacks de cobrança Banco Inter inválidos.")
        return data

    async def configure_banking_webhook(
        self,
        context: BankingProviderContext,
        *,
        webhook_type: str,
        webhook_url: str,
    ) -> None:
        if webhook_type not in {"pix-pagamento", "boleto-pagamento"}:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "Tipo de webhook Banking Inter inválido.",
                details={"allowed": ["pix-pagamento", "boleto-pagamento"]},
            )
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BANKING_WEBHOOK_WRITE,),
            method="PUT",
            path=f"{BANKING_WEBHOOK}/{webhook_type}",
            payload={"webhookUrl": webhook_url},
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-BANKING-WEBHOOK-{webhook_type}",
        )

    async def get_banking_webhook(self, context: BankingProviderContext, webhook_type: str) -> dict[str, Any]:
        data = await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BANKING_WEBHOOK_READ,),
            method="GET",
            path=f"{BANKING_WEBHOOK}/{webhook_type}",
            correlation_id=context.correlation_id,
        )
        if not isinstance(data, dict):
            raise BankProviderError("BANK_RESPONSE_INVALID", "Webhook Banking Banco Inter inválido.")
        return data

    async def delete_banking_webhook(self, context: BankingProviderContext, webhook_type: str) -> None:
        await self._request(
            environment=context.environment.value,
            credentials=context.credentials,
            scopes=(SCOPE_BANKING_WEBHOOK_WRITE,),
            method="DELETE",
            path=f"{BANKING_WEBHOOK}/{webhook_type}",
            correlation_id=context.correlation_id,
            idempotency_key=f"INTER-BANKING-WEBHOOK-DELETE-{webhook_type}",
        )
