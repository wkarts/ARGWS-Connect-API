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

CAIXA_MANIFEST = ProviderManifest(
    code="CAIXA",
    name="Caixa Econômica Federal",
    institution=BankInstitutionReference(
        name="CAIXA ECONOMICA FEDERAL",
        bank_code="104",
        ispb="00360305",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset({BankingEnvironment.SANDBOX, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.PIX_COB}),
    authentication=AuthenticationManifest(
        BankingAuthType.OAUTH2_CLIENT_CREDENTIALS,
        fields=(
            CredentialField("client_id", "Cliente ID"),
            CredentialField("client_secret", "Cliente Secret", secret=True),
            CredentialField(
                "token_url",
                "Token Endpoint",
                description="URL fornecida/confirmada no onboarding CAIXA. Deve usar HTTPS em domínio oficial *.caixa.gov.br.",
            ),
            CredentialField(
                "scope",
                "Scope OAuth",
                description="Scope autorizado para o recurso conforme Swagger/onboarding CAIXA.",
            ),
            CredentialField(
                "oauth_client_auth",
                "Forma de autenticação OAuth",
                description="BASIC ou BODY, exatamente conforme o onboarding/token endpoint contratado.",
            ),
            CredentialField(
                "oauth_body_mode",
                "Formato do corpo OAuth",
                description="FORM ou JSON, conforme o token endpoint contratado.",
            ),
            CredentialField(
                "oauth_client_id_field",
                "Nome do campo Cliente ID",
                required=False,
                description="Usado somente quando oauth_client_auth=BODY. Padrão CAIXA documental: cliente_id.",
            ),
            CredentialField(
                "oauth_client_secret_field",
                "Nome do campo Cliente Secret",
                required=False,
                secret=False,
                description="Usado somente quando oauth_client_auth=BODY. Padrão CAIXA documental: cliente_secret.",
            ),
            CredentialField("pix_key", "Chave Pix recebedora"),
            CredentialField(
                "user_agent",
                "HTTP User-Agent",
                description="Identificação não genérica recomendada pela documentação técnica CAIXA.",
            ),
            CredentialField(
                "certificate",
                "Certificado cliente PEM",
                required=False,
                secret=True,
                field_type="file",
                accepted_extensions=(".pem", ".crt"),
                description="Informe somente quando o onboarding CAIXA exigir mTLS para a aplicação.",
            ),
            CredentialField(
                "private_key",
                "Chave privada PEM",
                required=False,
                secret=True,
                field_type="file",
                accepted_extensions=(".pem", ".key"),
            ),
        ),
        certificate_required=False,
        notes=(
            "Grant Client Credentials documentado pela CAIXA. O wire do Token Endpoint deve seguir o onboarding; "
            "nenhuma forma BASIC/BODY é presumida pelo driver."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Documents/api-pix-automatico-manual-tecnico.pdf",
            title="API Pix Automático — Documento Técnico CAIXA",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Documents/documento-tecnico-convenio-pix-automatico.pdf",
            title="Documento Técnico Convênio Pix Automático CAIXA",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Paginas/default.aspx",
            title="Pix Automático CAIXA",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa somente Pix Cob imediata: PUT/GET/PATCH /cob/{txid}.",
        "Bases de recursos Sandbox/Produção são as publicadas no documento técnico do convênio.",
        "Token Endpoint e forma de envio das credenciais são confirmados pelo onboarding e validados contra domínio oficial CAIXA.",
        "IMPLEMENTED não significa SANDBOX_VERIFIED, HOMOLOGATED ou PRODUCTION_READY.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "PIX_AUTOMATICO_API_PIX",
        "resource_contract": "BACEN_PIX_COB",
    },
)
