from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.contracts.statements import StatementRequest
from app.providers.banking.core.capabilities import (
    BankingCapability,
    BankingEnvironment,
    ProviderStatus,
)
from app.providers.banking.providers.inter import InterBankingProvider
from app.providers.banking.providers.inter.client import inter_base_url
from app.providers.banking.providers.inter.constants import (
    BILLING,
    INTER_TOKEN_PATH,
    SCOPE_BILLING_READ,
    SCOPE_BILLING_WRITE,
    SCOPE_STATEMENT_READ,
)
from app.providers.banking.providers.inter.manifest import INTER_MANIFEST


def test_inter_manifest_uses_official_sdk_auth_contract() -> None:
    assert INTER_MANIFEST.status is ProviderStatus.IMPLEMENTED
    assert INTER_MANIFEST.environments == frozenset(
        {
            BankingEnvironment.SANDBOX,
            BankingEnvironment.HOMOLOGATION,
            BankingEnvironment.PRODUCTION,
        }
    )
    fields = {field.key for field in INTER_MANIFEST.authentication.fields}
    assert fields == {
        "client_id",
        "client_secret",
        "certificate",
        "private_key",
        "current_account",
        "pix_key",
    }
    assert "token_url" not in fields
    assert "oauth_client_auth" not in fields
    assert "oauth_body_mode" not in fields
    assert INTER_TOKEN_PATH == "/oauth/v2/token"
    assert inter_base_url("HOMOLOGATION") == "https://cdpj.partners.uatbi.com.br"


def test_inter_manifest_announces_only_implemented_rc31_capabilities() -> None:
    expected = {
        BankingCapability.BALANCE,
        BankingCapability.STATEMENT,
        BankingCapability.BOLETO_CREATE,
        BankingCapability.BOLETO_GET,
        BankingCapability.BOLETO_CANCEL,
        BankingCapability.BOLETO_HYBRID,
        BankingCapability.PIX_COB,
        BankingCapability.PIX_COBV,
        BankingCapability.PIX_RECEIVED,
        BankingCapability.PIX_PAYMENT,
        BankingCapability.PIX_REFUND,
        BankingCapability.PIX_WEBHOOK,
        BankingCapability.PAYMENT_BOLETO,
        BankingCapability.PAYMENT_TAX,
        BankingCapability.PAYMENT_BATCH,
    }
    assert INTER_MANIFEST.capabilities == frozenset(expected)
    assert BankingCapability.BOLETO_UPDATE not in INTER_MANIFEST.capabilities
    assert BankingCapability.DDA not in INTER_MANIFEST.capabilities
    assert BankingCapability.ACCOUNT_INFO not in INTER_MANIFEST.capabilities
    assert INTER_MANIFEST.status is not ProviderStatus.PRODUCTION_READY


def test_inter_exported_provider_contains_complete_official_surfaces() -> None:
    provider = InterBankingProvider()
    for operation in (
        "get_basic_statement",
        "get_statement_pdf",
        "create_payment_batch",
        "get_payment_batch",
        "list_darf_payments",
        "list_immediate_pix_charges",
        "update_immediate_pix_charge",
        "list_due_pix_charges",
        "create_due_pix_batch",
        "get_due_pix_batch",
        "get_due_pix_batch_summary",
        "get_due_pix_batch_by_status",
        "list_due_pix_batches",
        "list_received_pix",
        "refund_pix",
        "list_locations",
        "configure_pix_webhook",
        "configure_billing_webhook",
        "configure_banking_webhook",
        "list_banking_webhook_callbacks",
    ):
        assert callable(getattr(provider, operation, None)), operation


@pytest.mark.asyncio
async def test_inter_enriched_statement_uses_official_page_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = InterBankingProvider()
    request_call = AsyncMock(
        return_value={
            "ultimaPagina": False,
            "totalPaginas": 3,
            "totalElementos": 1,
            "numeroDeElementos": 1,
            "transacoes": [
                {
                    "idTransacao": "T1",
                    "dataTransacao": "2026-08-25",
                    "tipoOperacao": "C",
                    "tipoTransacao": "PIX",
                    "valor": "10.50",
                    "titulo": "Pix recebido",
                    "detalhes": {"endToEndId": "E123", "txId": "TX123"},
                }
            ],
        }
    )
    monkeypatch.setattr(provider, "_request", request_call)
    context = type(
        "Context",
        (),
        {
            "environment": BankingEnvironment.PRODUCTION,
            "credentials": {},
            "settings": {"statement_page_size": 100},
            "correlation_id": "internal-only",
        },
    )()

    result = await provider.get_statement(
        context,  # type: ignore[arg-type]
        StatementRequest(start_date=date(2026, 8, 1), end_date=date(2026, 8, 25), cursor="1"),
    )

    kwargs = request_call.await_args.kwargs
    assert kwargs["scopes"] == (SCOPE_STATEMENT_READ,)
    assert kwargs["path"] == "/banking/v2/extrato/completo"
    assert kwargs["params"] == {
        "dataInicio": "2026-08-01",
        "dataFim": "2026-08-25",
        "pagina": 1,
        "tamanhoPagina": 100,
    }
    assert result.next_cursor == "2"
    assert result.has_more is True
    assert result.transactions[0].end_to_end_id == "E123"


@pytest.mark.asyncio
async def test_inter_billing_v3_issues_then_retrieves_official_result(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = InterBankingProvider()
    request_call = AsyncMock(
        side_effect=[
            {"codigoSolicitacao": "REQ-123"},
            {
                "cobranca": {"situacao": "A_RECEBER"},
                "boleto": {
                    "nossoNumero": "123456789",
                    "codigoBarras": "0019",
                    "linhaDigitavel": "00190",
                },
                "pix": {"txid": "TX123", "pixCopiaECola": "000201..."},
            },
        ]
    )
    monkeypatch.setattr(provider, "_request", request_call)
    request = BankChargeRequest(
        internal_id="REC-1",
        document_number="DOC-1",
        amount=Decimal("150.25"),
        due_date=date(2026, 9, 10),
        description="Mensalidade",
        customer=BankCustomer(
            name="Cliente Teste",
            tax_id="12345678901",
            email="cliente@example.com",
            phone="75999998888",
            address={
                "street": "Rua Um",
                "number": "10",
                "neighborhood": "Centro",
                "city": "Santo Antonio de Jesus",
                "state": "BA",
                "zip_code": "44570000",
            },
        ),
        charge_type="BOLETO_PIX",
        agreement={
            "environment": "PRODUCTION",
            "credentials": {},
            "settings": {"billing_scheduled_days": 0},
        },
    )

    result = await provider.create_charge(request)

    first = request_call.await_args_list[0].kwargs
    second = request_call.await_args_list[1].kwargs
    assert first["method"] == "POST"
    assert first["path"] == BILLING
    assert first["scopes"] == (SCOPE_BILLING_WRITE,)
    assert first["payload"]["seuNumero"] == "DOC-1"
    assert first["payload"]["valorNominal"] == "150.25"
    assert first["payload"]["pagador"]["cpfCnpj"] == "12345678901"
    assert second["method"] == "GET"
    assert second["path"] == f"{BILLING}/REQ-123"
    assert second["scopes"] == (SCOPE_BILLING_READ,)
    assert result.external_id == "REQ-123"
    assert result.our_number == "123456789"
    assert result.txid == "TX123"
    assert result.pix_copy_paste == "000201..."
    assert result.digitable_line == "00190"
