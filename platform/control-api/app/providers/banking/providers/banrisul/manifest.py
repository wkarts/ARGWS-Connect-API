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

BANRISUL_MANIFEST = ProviderManifest(
    code="BANRISUL",
    name="Banrisul",
    institution=BankInstitutionReference(
        name="Banco do Estado do Rio Grande do Sul S.A.",
        bank_code="041",
        ispb="92702067",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.OAUTH2_CLIENT_CREDENTIALS,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("client_secret", "Client Secret", secret=True),
            CredentialField("pix_key", "Chave Pix recebedora"),
            CredentialField(
                "certificate",
                "Certificado PEM opcional",
                required=False,
                secret=True,
                field_type="file",
                accepted_extensions=(".pem", ".crt"),
                description="Use quando o convênio Banrisul exigir certificado cliente.",
            ),
            CredentialField(
                "private_key",
                "Chave privada PEM opcional",
                required=False,
                secret=True,
                field_type="file",
                accepted_extensions=(".pem", ".key"),
            ),
        ),
        scopes=("cob.write", "cob.read"),
        certificate_required=False,
        notes=(
            "OAuth2 Client Credentials com HTTP Basic conforme API Pix 2.8.1. "
            "Certificado pode ser informado no BankConnection quando exigido pelo convênio."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://developers.banrisul.com.br/pages/docs/clientes-banrisul/api-pix-v2.8.1.html",
            title="API Pix Banrisul",
            version="2.8.1",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa somente Pix Cob imediata (criar, consultar e remover).",
        "Capabilities adicionais do catálogo não são anunciadas pelo executor.",
        "Status IMPLEMENTED não implica homologação nem produção liberada.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "API_PIX",
        "oauth_body": "FORM",
        "oauth_client_auth": "BASIC",
    },
)
