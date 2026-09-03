from __future__ import annotations

from datetime import date

from app.providers.banking.core.capabilities import BankingAuthType, BankingCapability, BankingEnvironment, BankingIntegrationMode, ProviderStatus
from app.providers.banking.core.manifest import AuthenticationManifest, BankInstitutionReference, CredentialField, DocumentationReference, ProviderManifest

CHECKED_AT = date(2026, 8, 23)

PAGBANK_MANIFEST = ProviderManifest(
    code="PAGBANK",
    name="PagBank",
    institution=BankInstitutionReference(name="PagSeguro Internet Instituição de Pagamento S.A.", bank_code="290"),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.SANDBOX, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.BEARER_TOKEN,
        fields=(CredentialField("access_token", "Token Bearer", secret=True),),
        notes="Token da integração PagBank enviado no header Authorization Bearer.",
    ),
    documentation=(
        DocumentationReference(url="https://developer.pagbank.com.br/reference/criar-pedido", title="Criar pedido", checked_at=CHECKED_AT),
        DocumentationReference(url="https://developer.pagbank.com.br/docs/pix", title="Pix e QR Code", checked_at=CHECKED_AT),
        DocumentationReference(url="https://developer.pagbank.com.br/reference/consultar-pedido", title="Consultar pedido", checked_at=CHECKED_AT),
        DocumentationReference(url="https://developer.pagbank.com.br/reference/cancelar-cobranca", title="Cancelar cobrança", checked_at=CHECKED_AT),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 cria e consulta QR Code Pix pelo recurso Orders.",
        "Cancelamento usa /charges/{charge_id}/cancel somente quando o PagBank já materializou uma charge.",
        "QR ainda sem charge não recebe endpoint de cancelamento inventado; sua expiração oficial permanece válida.",
    ),
    metadata={"documentation_status": "PUBLIC_VERIFIED", "product": "ORDERS_PIX"},
)
