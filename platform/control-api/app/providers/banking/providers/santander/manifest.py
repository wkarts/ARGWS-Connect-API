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

SANTANDER_MANIFEST = ProviderManifest(
    code="SANTANDER",
    name="Santander",
    institution=BankInstitutionReference(
        name="Banco Santander (Brasil) S.A.",
        bank_code="033",
        ispb="90400888",
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
        ),
        certificate_required=True,
        notes=(
            "OAuth 2.0 com certificado cliente/mTLS. O fluxo de token Pix Santander usa "
            "client_id/client_secret e grant_type=client_credentials conforme o User Guide oficial."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://developer.santander.com.br/sites/default/files/2024-01/User_Guide_API_PIX_Recebimentos_v11_15_01_24.pdf",
            title="API Pix Recebimentos — User Guide",
            version="11",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://developer.santander.com.br/",
            title="Santander Developer Portal",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa somente Pix Cob imediata.",
        "Boleto, DDA, transferências e Pix Automático permanecem fora das capabilities efetivas deste executor.",
        "Status IMPLEMENTED não implica homologação ou produção liberada.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "PIX_RECEBIMENTOS",
        "mtls": True,
    },
)
