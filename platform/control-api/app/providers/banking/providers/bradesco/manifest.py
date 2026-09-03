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

BRADESCO_MANIFEST = ProviderManifest(
    code="BRADESCO",
    name="Bradesco",
    institution=BankInstitutionReference(
        name="Banco Bradesco S.A.",
        bank_code="237",
        ispb="60746948",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.OAUTH2_MTLS,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("client_secret", "Client Secret", secret=True),
            CredentialField(
                "certificate",
                "Certificado PEM",
                secret=True,
                field_type="file",
                accepted_extensions=(".pem", ".crt"),
            ),
            CredentialField(
                "private_key",
                "Chave privada PEM",
                secret=True,
                field_type="file",
                accepted_extensions=(".pem", ".key"),
            ),
            CredentialField("pix_key", "Chave Pix recebedora"),
            CredentialField(
                "production_token_url",
                "Endpoint OAuth de produção",
                required=False,
                description=(
                    "Obrigatório em produção quando fornecido/confirmado no onboarding. "
                    "O manual público fixa o token de homologação e a base Pix de produção, "
                    "mas não fixa de forma inequívoca o token de produção."
                ),
            ),
        ),
        scopes=("cob.read", "cob.write"),
        certificate_required=True,
        notes=(
            "OAuth2 Client Credentials com HTTP Basic e conexão mTLS conforme manual oficial API Pix Bradesco."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://wspf.bradesco.com.br/wsValidadorUniversal/Content/Pdf/Layout_API_PIX.pdf",
            title="Manual API Pix Bradesco",
            version="07",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://developers.bradesco.com.br/",
            title="Portal Bradesco Developers",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa somente Pix Cob imediata.",
        "Homologação usa os endpoints públicos documentados. Produção exige token_url confirmado pelo onboarding.",
        "Status IMPLEMENTED não implica homologação nem produção liberada.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED_WITH_PRODUCTION_TOKEN_ONBOARDING",
        "mtls": True,
        "resource_contract": "BACEN_PIX_COB",
    },
)
