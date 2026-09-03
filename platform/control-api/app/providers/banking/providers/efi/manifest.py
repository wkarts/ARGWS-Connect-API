from __future__ import annotations

from datetime import date

from app.providers.banking.core.capabilities import BankingAuthType, BankingCapability, BankingEnvironment, BankingIntegrationMode, ProviderStatus
from app.providers.banking.core.manifest import AuthenticationManifest, BankInstitutionReference, ConfigurationField, CredentialField, DocumentationReference, ProviderManifest

CHECKED_AT = date(2026, 8, 25)

EFI_MANIFEST = ProviderManifest(
    code="EFI",
    name="Efí Bank",
    institution=BankInstitutionReference(name="EFÍ S.A. - INSTITUIÇÃO DE PAGAMENTO", bank_code="364", ispb="09089356"),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.BALANCE, BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.OAUTH2_MTLS,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("client_secret", "Client Secret", secret=True),
            CredentialField("certificate", "Certificado PEM", secret=True, field_type="file", description="Certificado cliente Efí convertido para PEM.", accepted_extensions=(".pem", ".crt")),
            CredentialField("private_key", "Chave privada PEM", secret=True, field_type="file", description="Chave privada correspondente ao certificado cliente.", accepted_extensions=(".pem", ".key")),
            CredentialField("pix_key", "Chave Pix recebedora", required=False, description="Obrigatória apenas para emitir Pix Cob; consulta de saldo funciona sem este campo."),
        ),
        scopes=("cob.write", "cob.read", "gn.balance.read"),
        certificate_required=True,
        notes="OAuth2 Client Credentials com HTTP Basic e mTLS. O certificado cliente também é obrigatório na autorização.",
    ),
    settings=(
        ConfigurationField(
            "pix_expiration_seconds",
            "Expiração padrão do Pix (segundos)",
            field_type="integer",
            default=3600,
            minimum=1,
            maximum=86400,
            description="Prazo padrão usado nas cobranças Pix imediatas quando a operação não informar outro valor.",
        ),
    ),
    documentation=(
        DocumentationReference(url="https://dev.efipay.com.br/docs/api-pix/credenciais/", title="Credenciais, Certificado e Autorização — API Pix Efí", checked_at=CHECKED_AT),
        DocumentationReference(url="https://dev.efipay.com.br/docs/api-pix/cobrancas-imediatas/", title="Cobranças imediatas — API Pix Efí", checked_at=CHECKED_AT),
        DocumentationReference(url="https://dev.efipay.com.br/docs/api-pix/endpoints-exclusivos-efi/", title="Endpoints exclusivos Efí — saldo e configurações", checked_at=CHECKED_AT),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.32 implementa Pix Cob imediata e consulta de saldo normalizada no framework bancário.",
        "Não marcado como SANDBOX_VERIFIED: a execução automatizada não possui credenciais reais de homologação.",
        "CobV, Pix enviado/recebido, devolução, Pix Automático, pagamentos, extratos CNAB e webhooks permanecem catalogados no material oficial anexado, mas não são anunciados como capabilities efetivas até o adapter normalizado correspondente existir.",
    ),
    metadata={"documentation_status": "PUBLIC_VERIFIED", "product": "API_PIX", "oauth_body": "JSON", "mtls": True},
)
