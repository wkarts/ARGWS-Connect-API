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

BANCO_DO_NORDESTE_MANIFEST = ProviderManifest(
    code="BANCO_DO_NORDESTE",
    name="Banco do Nordeste",
    institution=BankInstitutionReference(
        name="BANCO DO NORDESTE DO BRASIL S.A.",
        bank_code="004",
        ispb="07237373",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.CUSTOM,
        fields=(
            CredentialField("api_key", "API Key", secret=True),
            CredentialField("api_secret", "API Secret", secret=True),
            CredentialField(
                "api_key_header",
                "Header da API Key",
                description="Nome exato fornecido pelo Developer Portal/onboarding BNB.",
            ),
            CredentialField(
                "api_secret_header",
                "Header do API Secret",
                description="Nome exato fornecido pelo Developer Portal/onboarding BNB.",
            ),
            CredentialField("pix_key", "Chave Pix recebedora"),
        ),
        notes=(
            "O Developer Portal BNB confirma API Key + Secret por aplicação. "
            "Os nomes dos headers não são presumidos: devem vir do onboarding/portal da aplicação."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://portal.dev.bnb.gov.br/product/12/api/8",
            title="API Pix Banco do Nordeste 1.0.0",
            version="1.0.0",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://portal.dev.bnb.gov.br/node/3",
            title="Using our APIs — BNB Developer Portal",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://portal.dev.bnb.gov.br/index.php/node/4",
            title="Apps / API Key e Secret — BNB Developer Portal",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa somente Pix Cob imediata via PUT/GET/PATCH /cob/{txid}.",
        "Hosts e paths vêm diretamente da referência OAS3 oficial do BNB.",
        "Nomes de headers de autenticação são configuração de onboarding e passam por validação sintática; nenhum X-IBM-* é inferido.",
        "IMPLEMENTED não significa HOMOLOGATED ou PRODUCTION_READY.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "API_PIX_1_0_0",
        "resource_contract": "BACEN_PIX_COB",
    },
)
