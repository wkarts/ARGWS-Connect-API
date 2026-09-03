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

BS2_MANIFEST = ProviderManifest(
    code="BS2",
    name="Banco BS2",
    institution=BankInstitutionReference(
        name="Banco BS2 S.A.",
        bank_code="218",
        ispb="71027866",
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
            CredentialField(
                "scope",
                "Scope Pix",
                description="Informe exatamente o scope liberado para a aplicação no API Banking BS2.",
            ),
            CredentialField(
                "token_url",
                "Endpoint OAuth",
                description="URL fornecida no ambiente de homologação/produção pelo onboarding oficial BS2.",
            ),
            CredentialField(
                "resource_base_url",
                "Base URL da API",
                description="Base URL fornecida para o ambiente pelo onboarding oficial BS2.",
            ),
            CredentialField("pix_key", "Chave Pix recebedora"),
            CredentialField(
                "user_agent",
                "User-Agent de produção",
                required=False,
                description=(
                    "Em produção o BS2 exige o código User-Agent fornecido pelo banco. "
                    "Pode ficar vazio em homologação."
                ),
            ),
        ),
        scopes=("cob.write", "cob.read"),
        certificate_required=False,
        notes=(
            "OAuth2 Client Credentials com HTTP Basic e form-urlencoded. "
            "Hosts efetivos são recebidos no processo oficial de homologação/produção."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://devs.bs2.com/docs/primeirospassos",
            title="Primeiros Passos — homologação, produção e credenciais",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://devs.bs2.com/reference/post_auth-oauth-v2-token-1",
            title="Autenticação — OAuth2 Client Credentials",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://devs.bs2.com/reference/post_pix-direto-forintegration-v1-qrcodes-dinamico",
            title="QR Code Dinâmico — criar",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://devs.bs2.com/reference/get_pix-direto-forintegration-v1-cob-txid",
            title="Cobrança — consultar por TxId",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://devs.bs2.com/reference/patch_pix-direto-forintegration-v1-cob-txid",
            title="Cobrança — revisar/remover",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa Pix Cob imediata usando QR Code Dinâmico BS2 para retornar copia-e-cola.",
        "token_url/resource_base_url vêm do onboarding e são aceitos somente em domínios oficiais BS2/Banco Bonsucesso.",
        "Status IMPLEMENTED não implica homologação ou produção liberada.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED_WITH_ONBOARDING_HOSTS",
        "oauth": "CLIENT_CREDENTIALS_BASIC_FORM",
        "production_user_agent_required": True,
    },
)
