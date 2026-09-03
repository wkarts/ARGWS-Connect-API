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

SICREDI_MANIFEST = ProviderManifest(
    code="SICREDI",
    name="Sicredi",
    institution=BankInstitutionReference(
        name="Banco Cooperativo Sicredi S.A.",
        bank_code="748",
        ispb="01181521",
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
                "token_url",
                "URL OAuth da homologação",
                required=False,
                description="Obrigatória no ambiente de homologação conforme dados de credenciamento.",
            ),
            CredentialField(
                "resource_base_url",
                "Base da API Pix da homologação",
                required=False,
                description="Obrigatória no ambiente de homologação conforme dados de credenciamento.",
            ),
        ),
        scopes=("cob.write", "cob.read"),
        certificate_required=True,
        notes="OAuth2 Client Credentials com HTTP Basic e mTLS.",
    ),
    documentation=(
        DocumentationReference(
            url=(
                "https://developer.sicredi.com.br/api-portal/sites/default/files/"
                "Guia_tecnico_integracoes_APIPix_Sicredi_v1.9.5.pdf"
            ),
            title="Guia técnico de integrações API Pix Sicredi",
            version="1.9.5",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa somente Pix Cob imediata.",
        "Produção usa o servidor /api/v2 indicado no guia técnico 1.9.5.",
        "Homologação exige as URLs entregues no credenciamento; nenhuma URL ausente é inferida.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "API_PIX",
        "mtls": True,
        "oauth_body": "FORM",
    },
)
