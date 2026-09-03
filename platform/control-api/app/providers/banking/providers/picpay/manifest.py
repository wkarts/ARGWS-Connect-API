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

PICPAY_MANIFEST = ProviderManifest(
    code="PICPAY",
    name="PicPay",
    institution=BankInstitutionReference(name="PicPay Instituição de Pagamento S.A."),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.OAUTH2_CLIENT_CREDENTIALS,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("client_secret", "Client Secret", secret=True),
        ),
        certificate_required=False,
        notes="OAuth2 client_credentials em JSON; token Bearer válido por 5 minutos.",
    ),
    documentation=(
        DocumentationReference(
            url="https://developers-business.picpay.com/pix/docs/authentication",
            title="Autenticação — API Pix PicPay",
            version="1.5.0",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://developers-business.picpay.com/pix/docs/api/charge-pix",
            title="Gerar cobrança com QRCode Pix",
            version="1.5.0",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://developers-business.picpay.com/pix/docs/api/find-charge",
            title="Consultar cobrança Pix",
            version="1.5.0",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://developers-business.picpay.com/pix/docs/api/charge-refund",
            title="Cancelar/reembolsar cobrança",
            version="1.5.0",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa criar, consultar e cancelar integralmente cobrança Pix.",
        "Webhook e demais produtos PicPay permanecem fora das capabilities efetivas.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "API_PIX",
        "oauth_body": "JSON",
    },
)
