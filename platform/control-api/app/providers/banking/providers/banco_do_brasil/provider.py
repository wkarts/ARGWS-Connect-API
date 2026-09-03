from __future__ import annotations

import hashlib
import re
import unicodedata
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Any, AsyncIterator

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankChargeResult
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.cnab.banco_do_brasil_400 import (
    BancoDoBrasilCBR641Generator,
    BancoDoBrasilCBR641Settings,
    BancoDoBrasilCBR643ReturnParser,
)
from app.providers.cnab.cnab240 import CNABCompany, CNABTitle


def _bb_company_number(value: object) -> str:
    """Converte o identificador interno no campo BB 'Seu Número' (10 posições)."""
    token = str(value or "").strip().rsplit("-", 1)[-1]
    normalized = unicodedata.normalize("NFKD", token).encode("ascii", "ignore").decode("ascii")
    normalized = " ".join(normalized.upper().split())
    if not normalized:
        raise ValueError("Seu Número BB não pode ficar vazio após normalização do controle interno.")
    if len(normalized) > 10:
        raise ValueError("Seu Número BB excede 10 posições após normalização do controle interno.")
    return normalized.ljust(10)


class BancoDoBrasilCBR641ProviderGenerator(BancoDoBrasilCBR641Generator):
    """Generator usado pelo provider, preservando controle interno e wire BB."""

    def detail(self, title: CNABTitle, record_sequence: int) -> str:
        line = super().detail(title, record_sequence)
        company_number = _bb_company_number(title.document_number)
        return f"{line[:110]}{company_number}{line[120:]}"


class BancoDoBrasilBankingProvider:
    name = "BANCO_DO_BRASIL"
    driver_version = "1.0.0-rc.32"

    _base_urls = {
        "SANDBOX": "https://api.sandbox.bb.com.br/cobrancas/v2",
        "HOMOLOGATION": "https://api.hm.bb.com.br/cobrancas/v2",
        "PRODUCTION": "https://api.bb.com.br/cobrancas/v2",
    }
    _token_urls = {
        "SANDBOX": "https://oauth.sandbox.bb.com.br/oauth/token",
        "HOMOLOGATION": "https://oauth.hm.bb.com.br/oauth/token",
        "PRODUCTION": "https://oauth.bb.com.br/oauth/token",
    }
    _allowed_hosts = {
        "api.sandbox.bb.com.br",
        "api.hm.bb.com.br",
        "api.bb.com.br",
        "oauth.sandbox.bb.com.br",
        "oauth.hm.bb.com.br",
        "oauth.bb.com.br",
    }
    _oauth_scopes = (
        "cobrancas.boletos-info",
        "cobrancas.boletos-requisicao",
        "cobrancas.convenio-requisicao",
    )

    @staticmethod
    def implemented_modes() -> frozenset[BankingIntegrationMode]:
        return frozenset({BankingIntegrationMode.DIRECT_API, BankingIntegrationMode.CNAB})

    @staticmethod
    def build_cnab400_generator(
        *,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        wallet: str | None,
        settings: dict[str, Any] | None,
    ) -> BancoDoBrasilCBR641Generator:
        data = dict(settings or {})
        agreement_number = str(data.pop("agreement_number", "") or company.agreement or "")
        return BancoDoBrasilCBR641ProviderGenerator(
            company,
            sequence=sequence,
            generation_date=generation_date,
            settings=BancoDoBrasilCBR641Settings.from_agreement(
                agreement_number,
                wallet,
                data,
            ),
        )

    @staticmethod
    def parse_cnab400_return(content: bytes) -> list[dict[str, object]]:
        return BancoDoBrasilCBR643ReturnParser().parse(content)

    @classmethod
    def _configuration(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
    ) -> tuple[str, str, str, str, str, str]:
        env = environment.strip().upper()
        base_url = cls._base_urls.get(env)
        token_url = cls._token_urls.get(env)
        if not base_url or not token_url:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "Ambiente da API Cobranças do Banco do Brasil inválido.",
                details={"environment": env},
            )

        data = dict(settings or {})
        client_id = str(credentials.get("client_id") or "").strip()
        client_secret = str(credentials.get("client_secret") or "").strip()
        app_key = str(
            credentials.get("developer_application_key")
            or credentials.get("gw_dev_app_key")
            or credentials.get("gw-dev-app-key")
            or ""
        ).strip()
        agreement = str(
            credentials.get("numero_convenio")
            or data.get("numero_convenio")
            or data.get("agreement_number")
            or ""
        ).strip()

        missing = [
            key
            for key, value in (
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("developer_application_key", app_key),
                ("numero_convenio", agreement),
            )
            if not value
        ]
        if missing:
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "Credenciais/configuração da API Cobranças BB incompletas.",
                details={"missing_fields": missing},
            )
        if not re.fullmatch(r"[0-9A-Fa-f]{31}", app_key):
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "developer_application_key do Banco do Brasil deve conter exatamente 31 caracteres hexadecimais.",
                details={"field": "developer_application_key"},
            )
        if not agreement.isdigit():
            raise BankProviderError(
                "BANK_INVALID_CREDENTIALS",
                "numero_convenio do Banco do Brasil deve ser numérico.",
                details={"field": "numero_convenio"},
            )
        return base_url, token_url, client_id, client_secret, app_key, agreement

    @classmethod
    @asynccontextmanager
    async def _client(
        cls,
        *,
        environment: str,
        credentials: dict[str, Any],
        settings: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> AsyncIterator[tuple[BankHTTPClient, str, str]]:
        base_url, token_url, client_id, client_secret, app_key, agreement = cls._configuration(
            environment=environment,
            credentials=credentials,
            settings=settings,
        )
        auth = OAuth2ClientCredentials(
            provider=cls.name,
            environment=environment.upper(),
            token_url=token_url,
            allowed_hosts=cls._allowed_hosts,
            client_id=client_id,
            client_secret=client_secret,
            redis=None,
            scopes=cls._oauth_scopes,
            client_auth="BASIC",
            body_mode="FORM",
        )
        material = await auth.material()
        async with BankHTTPClient(
            provider=cls.name,
            base_url=base_url,
            allowed_hosts=cls._allowed_hosts,
            headers={
                **material.headers,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "Connect-API-Platform/1.0",
            },
        ) as client:
            yield client, app_key, agreement

    @staticmethod
    def _api_params(app_key: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"gw-dev-app-key": app_key, **{key: value for key, value in (extra or {}).items() if value not in (None, "")}}

    @staticmethod
    def _date(value: date) -> str:
        return value.strftime("%d.%m.%Y")

    @staticmethod
    def _optional_int(value: Any) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise APIError("BANK_INVALID_REQUEST", "Uma configuração numérica do Banco do Brasil é inválida.", 422) from exc

    @staticmethod
    def _optional_float(value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(Decimal(str(value)))
        except (TypeError, ValueError, ArithmeticError) as exc:
            raise APIError("BANK_INVALID_REQUEST", "Uma configuração monetária do Banco do Brasil é inválida.", 422) from exc

    @staticmethod
    def _payer(request: BankChargeRequest) -> dict[str, Any]:
        tax_id = re.sub(r"\D", "", request.customer.tax_id or "")
        if len(tax_id) not in {11, 14}:
            raise APIError(
                "BANK_INVALID_REQUEST",
                "A API Cobranças BB exige CPF ou CNPJ válido do pagador.",
                422,
                {"provider": "BANCO_DO_BRASIL"},
            )
        address = dict(request.customer.address or {})
        payload: dict[str, Any] = {
            "tipoInscricao": 1 if len(tax_id) == 11 else 2,
            "numeroInscricao": tax_id,
            "nome": request.customer.name,
            "endereco": address.get("street") or address.get("address"),
            "cep": re.sub(r"\D", "", str(address.get("postal_code") or address.get("zip_code") or address.get("cep") or "")),
            "cidade": address.get("city") or address.get("cidade"),
            "bairro": address.get("district") or address.get("neighborhood") or address.get("bairro"),
            "uf": address.get("state") or address.get("uf"),
            "telefone": request.customer.phone,
            "email": request.customer.email,
        }
        if payload["cep"]:
            payload["cep"] = int(payload["cep"])
        return {key: value for key, value in payload.items() if value not in (None, "")}

    @staticmethod
    def _beneficiary_number(value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").upper()
        normalized = re.sub(r"[^A-Z0-9' -]", "", normalized)
        normalized = " ".join(normalized.split())
        return normalized or "CONNECTAPI"

    @staticmethod
    def _client_title_number(*, agreement: str, request: BankChargeRequest, settings: dict[str, Any]) -> str:
        explicit = str(settings.get("numero_titulo_cliente") or "").strip()
        if explicit:
            if not re.fullmatch(r"\d{20}", explicit):
                raise APIError("BANK_INVALID_REQUEST", "numero_titulo_cliente do BB deve possuir 20 dígitos.", 422)
            return explicit
        agreement_part = agreement.zfill(7)
        if len(agreement_part) != 7:
            raise APIError(
                "BANK_INVALID_REQUEST",
                "A composição automática do Nosso Número BB exige convênio de até 7 dígitos.",
                422,
            )
        numeric_document = re.sub(r"\D", "", request.document_number or "")
        if numeric_document and len(numeric_document) <= 10:
            sequence = numeric_document.zfill(10)
        else:
            digest = hashlib.sha256(request.internal_id.encode("utf-8")).digest()
            sequence = f"{int.from_bytes(digest[:8], 'big') % 10_000_000_000:010d}"
        return f"000{agreement_part}{sequence}"

    @staticmethod
    def _result(data: dict[str, Any], external_id: str | None = None) -> BankChargeResult:
        qr = dict(data.get("qrCode") or {})
        identifier = str(data.get("numero") or data.get("id") or external_id or "")
        return BankChargeResult(
            provider="BANCO_DO_BRASIL",
            external_id=identifier,
            status=str(data.get("estadoTituloCobranca") or data.get("codigoEstadoTituloCobranca") or data.get("status") or "REGISTERED").upper(),
            our_number=identifier or None,
            txid=str(qr.get("txId") or "") or None,
            digitable_line=data.get("linhaDigitavel") or data.get("codigoLinhaDigitavel"),
            barcode=data.get("codigoBarraNumerico") or data.get("textoCodigoBarrasTituloCobranca"),
            pix_copy_paste=qr.get("emv"),
            document_url=data.get("urlImagemBoleto"),
            raw={
                key: data.get(key)
                for key in (
                    "numero",
                    "id",
                    "linhaDigitavel",
                    "codigoLinhaDigitavel",
                    "codigoBarraNumerico",
                    "textoCodigoBarrasTituloCobranca",
                    "numeroContratoCobranca",
                    "codigoEstadoTituloCobranca",
                    "estadoTituloCobranca",
                    "valorOriginalTituloCobranca",
                    "valorAtualTituloCobranca",
                    "valorPagoSacado",
                    "dataVencimentoTituloCobranca",
                    "urlImagemBoleto",
                    "observacao",
                    "qrCode",
                )
                if key in data
            },
        )

    @classmethod
    def _agreement_data(cls, request: BankChargeRequest) -> tuple[str, dict[str, Any], dict[str, Any]]:
        agreement = request.agreement or {}
        return (
            str(agreement.get("environment") or "SANDBOX").upper(),
            dict(agreement.get("credentials") or {}),
            dict(agreement.get("settings") or {}),
        )

    async def health_check(self, context: BankingProviderContext) -> dict[str, Any]:
        try:
            async with self._client(
                environment=context.environment.value,
                credentials=context.credentials,
                settings=context.settings,
                correlation_id=context.correlation_id,
            ):
                pass
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return {
            "status": "CONNECTED",
            "provider": self.name,
            "authentication_verified": True,
            "financial_operation": False,
        }

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        charge_type = request.charge_type.upper()
        if charge_type not in {"BOLETO", "BOLETO_PIX", "BOLETO_HYBRID"}:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "A API Cobranças BB deste provider registra boleto ou boleto híbrido com Pix.",
                422,
                {"provider": self.name, "charge_type": charge_type},
            )
        if Decimal(request.amount) <= 0:
            raise APIError("INVALID_CHARGE_AMOUNT", "O valor da cobrança precisa ser maior que zero.", 422)
        environment, credentials, settings = self._agreement_data(request)
        try:
            async with self._client(environment=environment, credentials=credentials, settings=settings) as (client, app_key, agreement):
                payload: dict[str, Any] = {
                    "numeroConvenio": int(agreement),
                    "dataEmissao": self._date(date.today()),
                    "dataVencimento": self._date(request.due_date),
                    "valorOriginal": float(Decimal(request.amount)),
                    "numeroTituloBeneficiario": self._beneficiary_number(request.document_number),
                    "numeroTituloCliente": self._client_title_number(agreement=agreement, request=request, settings=settings),
                    "pagador": self._payer(request),
                    "indicadorPix": str(settings.get("indicador_pix") or ("S" if charge_type != "BOLETO" else "N")).upper(),
                }
                optional = {
                    "numeroCarteira": self._optional_int(settings.get("numero_carteira") or credentials.get("carteira_convenio")),
                    "numeroVariacaoCarteira": self._optional_int(settings.get("numero_variacao_carteira") or credentials.get("variacao_carteira_convenio")),
                    "codigoModalidade": self._optional_int(settings.get("codigo_modalidade")),
                    "valorAbatimento": self._optional_float(settings.get("valor_abatimento")),
                    "quantidadeDiasProtesto": self._optional_int(settings.get("quantidade_dias_protesto")),
                    "quantidadeDiasNegativacao": self._optional_int(settings.get("quantidade_dias_negativacao")),
                    "orgaoNegativador": self._optional_int(settings.get("orgao_negativador")),
                    "indicadorAceiteTituloVencido": settings.get("indicador_aceite_titulo_vencido"),
                    "numeroDiasLimiteRecebimento": self._optional_int(settings.get("numero_dias_limite_recebimento")),
                    "codigoAceite": settings.get("codigo_aceite"),
                    "codigoTipoTitulo": self._optional_int(settings.get("codigo_tipo_titulo")),
                    "descricaoTipoTitulo": settings.get("descricao_tipo_titulo"),
                    "indicadorPermissaoRecebimentoParcial": settings.get("indicador_permissao_recebimento_parcial"),
                    "campoUtilizacaoBeneficiario": settings.get("campo_utilizacao_beneficiario"),
                    "mensagemBloquetoOcorrencia": settings.get("mensagem_bloqueto_ocorrencia") or request.description[:165],
                    "idLocationPix": self._optional_int(settings.get("id_location_pix")),
                    "idLocationRecorrencia": self._optional_int(settings.get("id_location_recorrencia")),
                    "desconto": settings.get("desconto"),
                    "segundoDesconto": settings.get("segundo_desconto"),
                    "terceiroDesconto": settings.get("terceiro_desconto"),
                    "jurosMora": settings.get("juros_mora"),
                    "multa": settings.get("multa"),
                    "beneficiarioFinal": settings.get("beneficiario_final"),
                }
                payload.update({key: value for key, value in optional.items() if value not in (None, "")})
                data = (
                    await client.request(
                        "POST",
                        "/boletos",
                        params=self._api_params(app_key),
                        json=payload,
                    )
                ).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data)

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult:
        agreement = agreement or {}
        environment = str(agreement.get("environment") or "SANDBOX").upper()
        credentials = dict(agreement.get("credentials") or {})
        settings = dict(agreement.get("settings") or {})
        try:
            async with self._client(environment=environment, credentials=credentials, settings=settings) as (client, app_key, convenio):
                data = (
                    await client.request(
                        "GET",
                        f"/boletos/{external_id}",
                        params=self._api_params(app_key, {"numeroConvenio": int(convenio)}),
                    )
                ).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
        return self._result(data, external_id)

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None:
        agreement = agreement or {}
        environment = str(agreement.get("environment") or "SANDBOX").upper()
        credentials = dict(agreement.get("credentials") or {})
        settings = dict(agreement.get("settings") or {})
        try:
            async with self._client(environment=environment, credentials=credentials, settings=settings) as (client, app_key, convenio):
                await client.request(
                    "POST",
                    f"/boletos/{external_id}/baixar",
                    params=self._api_params(app_key),
                    json={"numeroConvenio": int(convenio)},
                )
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def list_bills(self, context: BankingProviderContext, *, filters: dict[str, Any]) -> Any:
        required = [key for key in ("indicadorSituacao", "agenciaBeneficiario", "contaBeneficiario") if filters.get(key) in (None, "")]
        if required:
            raise APIError("BANK_INVALID_REQUEST", "Preencha os filtros obrigatórios da consulta de boletos BB.", 422, {"missing_fields": required})
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, _):
                return (await client.request("GET", "/boletos", params=self._api_params(app_key, filters), correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def update_bill(self, context: BankingProviderContext, external_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, convenio):
                body = {"numeroConvenio": int(convenio), **payload}
                return (await client.request("PATCH", f"/boletos/{external_id}", params=self._api_params(app_key), json=body, correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def generate_linked_pix(self, context: BankingProviderContext, external_id: str) -> dict[str, Any]:
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, convenio):
                return (await client.request("POST", f"/boletos/{external_id}/gerar-pix", params=self._api_params(app_key), json={"numeroConvenio": int(convenio)}, correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def cancel_linked_pix(self, context: BankingProviderContext, external_id: str) -> dict[str, Any]:
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, convenio):
                return (await client.request("POST", f"/boletos/{external_id}/cancelar-pix", params=self._api_params(app_key), json={"numeroConvenio": int(convenio)}, correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def get_linked_pix(self, context: BankingProviderContext, external_id: str) -> dict[str, Any]:
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, convenio):
                return (await client.request("GET", f"/boletos/{external_id}/pix", params=self._api_params(app_key, {"numeroConvenio": int(convenio)}), correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def list_return_movement(self, context: BankingProviderContext, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, convenio):
                return (await client.request("POST", f"/convenios/{convenio}/listar-retorno-movimento", params=self._api_params(app_key), json=payload, correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def list_operational_downs(self, context: BankingProviderContext, *, filters: dict[str, Any]) -> dict[str, Any]:
        required = [key for key in ("agencia", "conta", "carteira", "variacao", "dataInicioAgendamentoTitulo", "dataFimAgendamentoTitulo") if filters.get(key) in (None, "")]
        if required:
            raise APIError("BANK_INVALID_REQUEST", "Preencha os filtros obrigatórios da baixa operacional BB.", 422, {"missing_fields": required})
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, _):
                return (await client.request("GET", "/boletos-baixa-operacional", params=self._api_params(app_key, filters), correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc

    async def set_operational_down_query(self, context: BankingProviderContext, *, enabled: bool) -> dict[str, Any]:
        try:
            async with self._client(environment=context.environment.value, credentials=context.credentials, settings=context.settings, correlation_id=context.correlation_id) as (client, app_key, convenio):
                action = "ativar-consulta-baixa-operacional" if enabled else "desativar-consulta-baixa-operacional"
                return (await client.request("PATCH", f"/convenios/{convenio}/{action}", params=self._api_params(app_key), correlation_id=context.correlation_id)).json()
        except BankProviderError as exc:
            raise exc.as_api_error() from exc
