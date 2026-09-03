from __future__ import annotations

from datetime import date

from app.providers.banking.core.capabilities import (
    BankingAuthType,
    BankingCapability,
    BankingEnvironment,
    BankingIntegrationMode,
    ProviderStatus,
)
from app.providers.banking.core.manifest import (
    AuthenticationManifest,
    BankInstitutionReference,
    CredentialField,
    DocumentationReference,
    ProviderManifest,
    WebhookManifest,
)

CHECKED_AT = date(2026, 8, 25)

ASAAS_MANIFEST = ProviderManifest(
    code="ASAAS",
    name="Asaas",
    institution=BankInstitutionReference(
        name="ASAAS GESTÃO FINANCEIRA INSTITUIÇÃO DE PAGAMENTO S.A.",
        ispb="19540550",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.SANDBOX, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset(
        {
            BankingCapability.BALANCE,
            BankingCapability.STATEMENT,
            BankingCapability.BOLETO_CREATE,
            BankingCapability.BOLETO_GET,
            BankingCapability.BOLETO_CANCEL,
            BankingCapability.BOLETO_HYBRID,
            BankingCapability.PIX_COB,
            BankingCapability.PIX_AUTOMATIC,
            BankingCapability.WEBHOOK,
        }
    ),
    authentication=AuthenticationManifest(
        BankingAuthType.API_KEY,
        fields=(CredentialField("api_key", "Chave de API", secret=True),),
        notes="A chave pertence ao tenant/empresa e é persistida apenas em formato criptografado.",
    ),
    documentation=(
        DocumentationReference(
            url="https://docs.asaas.com/docs/visao-geral",
            title="Visão geral da API Asaas",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://docs.asaas.com/reference/criar-nova-cobranca",
            title="Criar cobrança",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://docs.asaas.com/reference/recuperar-saldo-da-conta",
            title="Saldo da conta",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://docs.asaas.com/reference/listar-transacoes-financeiras",
            title="Extrato / transações financeiras",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://docs.asaas.com/docs/webhooks",
            title="Webhooks Asaas",
            checked_at=CHECKED_AT,
        ),
    ),
    webhook=WebhookManifest(
        True,
        "Validação e idempotência são realizadas pelo adapter específico Asaas antes de publicar eventos internos.",
    ),
    implementation_available=True,
    requires_homologation=False,
    notes=(
        "Executor rc.32 normaliza cobrança, Pix híbrido, Pix Automático, saldo e extrato financeiro.",
        "O SDK Java anexado contém serviços adicionais de transferências, Pix, boletos, contas e webhooks; eles não são promovidos como capability efetiva enquanto o contrato Connect|API correspondente não estiver implementado e testado.",
    ),
    metadata={
        "documentation_status": "SDK_AND_PUBLIC_CONTRACT_VERIFIED",
        "sdk_family": "asaas-api-sdk-java",
    },
)
