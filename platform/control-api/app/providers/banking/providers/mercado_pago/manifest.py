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
)

CHECKED_AT = date(2026, 8, 23)

MERCADO_PAGO_MANIFEST = ProviderManifest(
    code="MERCADO_PAGO",
    name="Mercado Pago",
    institution=BankInstitutionReference(name="Mercado Pago Instituição de Pagamento Ltda."),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.SANDBOX, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.BEARER_TOKEN,
        fields=(CredentialField("access_token", "Access Token", secret=True),),
        notes="Access Token Bearer obtido nas credenciais da integração Mercado Pago.",
    ),
    documentation=(
        DocumentationReference(
            url=(
                "https://www.mercadopago.com.br/developers/pt/docs/"
                "checkout-api-orders/payment-integration/pix"
            ),
            title="Checkout API Orders — Pix",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url=(
                "https://www.mercadopago.com.br/developers/pt/reference/"
                "online-payments/checkout-api/overview"
            ),
            title="Orders API — consulta e cancelamento",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa Pix via POST /v1/orders, GET e cancelamento.",
        "A mesma base oficial é usada com credenciais de teste ou produção.",
        "Webhook e reembolso pós-liquidação não são anunciados nesta capability.",
    ),
    metadata={"documentation_status": "PUBLIC_VERIFIED", "product": "ORDERS_PIX"},
)
