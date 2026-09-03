from __future__ import annotations

from datetime import date

from app.providers.banking.core.capabilities import BankingAuthType, BankingCapability, BankingEnvironment, BankingIntegrationMode, ProviderStatus
from app.providers.banking.core.manifest import AuthenticationManifest, BankInstitutionReference, CredentialField, DocumentationReference, ProviderManifest

CHECKED_AT = date(2026, 8, 23)

STONE_MANIFEST = ProviderManifest(
    code="STONE",
    name="Stone",
    institution=BankInstitutionReference(name="Stone Instituição de Pagamento S.A."),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.SANDBOX, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.BALANCE, BankingCapability.STATEMENT, BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.JWT_CLIENT_ASSERTION,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("private_key", "Chave privada RSA PEM", secret=True, field_type="file", accepted_extensions=(".pem", ".key")),
            CredentialField("account_id", "Account ID Stone"),
            CredentialField("pix_key", "Chave Pix recebedora"),
            CredentialField("application_name", "User-Agent da aplicação", required=False),
        ),
        notes="OAuth2 client_credentials com client_assertion JWT RS256 assinado pela aplicação.",
    ),
    documentation=(
        DocumentationReference(url="https://docs.openbank.stone.com.br/docs/guias/token-de-acesso/", title="Token de acesso Stone OpenBank", checked_at=CHECKED_AT),
        DocumentationReference(url="https://docs.openbank.stone.com.br/docs/referencia-da-api/pix/apis-padrao/cob/criar-cobranca/", title="Criar cobrança Pix imediata", checked_at=CHECKED_AT),
        DocumentationReference(url="https://docs.openbank.stone.com.br/docs/referencia-da-api/pix/apis-padrao/cob/detalhes-cobranca-imediata/", title="Detalhar cobrança Pix imediata", checked_at=CHECKED_AT),
        DocumentationReference(url="https://docs.openbank.stone.com.br/sandbox/docs/referencia-da-api/dados-da-conta/contas-vinculadas/", title="Saldo e extrato da conta", checked_at=CHECKED_AT),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa autenticação Stone, saldo, extrato e Pix Cob imediata.",
        "Extrato usa o endpoint oficial sem inventar parâmetros remotos e aplica o intervalo solicitado localmente.",
        "Status IMPLEMENTED não implica homologação nem produção liberada.",
    ),
    metadata={"documentation_status": "PUBLIC_VERIFIED", "product": "STONE_OPENBANK", "jwt_algorithm": "RS256"},
)
