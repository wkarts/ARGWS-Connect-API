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
from app.providers.banking.providers.inter.constants import ALL_INTER_SCOPES

CHECKED_AT = date(2026, 8, 25)

INTER_MANIFEST = ProviderManifest(
    code="INTER",
    name="Banco Inter",
    institution=BankInstitutionReference(
        name="Banco Inter S.A.",
        bank_code="077",
        ispb="00416968",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.DIRECT_API}),
    environments=frozenset(
        {
            BankingEnvironment.SANDBOX,
            BankingEnvironment.HOMOLOGATION,
            BankingEnvironment.PRODUCTION,
        }
    ),
    capabilities=frozenset(
        {
            BankingCapability.BALANCE,
            BankingCapability.STATEMENT,
            BankingCapability.BOLETO_CREATE,
            BankingCapability.BOLETO_GET,
            BankingCapability.BOLETO_CANCEL,
            BankingCapability.BOLETO_HYBRID,
            BankingCapability.PIX_COB,
            BankingCapability.PIX_COBV,
            BankingCapability.PIX_RECEIVED,
            BankingCapability.PIX_PAYMENT,
            BankingCapability.PIX_REFUND,
            BankingCapability.PIX_WEBHOOK,
            BankingCapability.PAYMENT_BOLETO,
            BankingCapability.PAYMENT_TAX,
            BankingCapability.PAYMENT_BATCH,
        }
    ),
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
            CredentialField(
                "current_account",
                "Conta corrente",
                required=False,
                description=(
                    "Use quando a integração Inter possuir acesso a mais de uma conta. "
                    "Quando informado, é enviado no header oficial x-conta-corrente."
                ),
            ),
            CredentialField(
                "pix_key",
                "Chave Pix recebedora",
                required=False,
                description="Necessária para operações Pix Cob/CobV que exigem chave recebedora.",
            ),
        ),
        scopes=ALL_INTER_SCOPES,
        certificate_required=True,
        notes=(
            "OAuth2 Client Credentials oficial do Inter: POST /oauth/v2/token, corpo FORM com "
            "client_id/client_secret/grant_type/scope e certificado mTLS. O endpoint e o wire não "
            "são mais parâmetros do tenant."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python",
            title="Banco Inter — SDK Python PJ oficial",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python/blob/master/inter_sdk_python/commons/structures/Constants.py",
            title="Banco Inter — endpoints e scopes oficiais",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python/blob/master/inter_sdk_python/commons/utils/TokenUtils.py",
            title="Banco Inter — OAuth2 Client Credentials + mTLS",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python/blob/master/inter_sdk_python/commons/enums/EnvironmentEnum.py",
            title="Banco Inter — Production, UAT e Sandbox",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python/tree/master/inter_sdk_python/banking",
            title="Banco Inter — Banking API oficial",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python/tree/master/inter_sdk_python/billing",
            title="Banco Inter — Billing/Cobrança API oficial",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://github.com/inter-co/pj-sdk-python/tree/master/inter_sdk_python/pix",
            title="Banco Inter — Pix API oficial",
            version="master@594744c",
            checked_at=CHECKED_AT,
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    rate_limits={
        "contract": "Respeitar limites retornados/contratados pelo Inter; o provider não mascara HTTP 429.",
    },
    notes=(
        "Executor rc.31 usa diretamente o contrato HTTP publicado pelo Banco Inter, sem depender da SDK em runtime.",
        "Cobrança v3, Pix Cob/CobV, Pix recebidos/devolução e Banking Payments são fronteiras independentes dentro do mesmo provider INTER.",
        "Status IMPLEMENTED não implica homologação real nem PRODUCTION_READY; credenciais reais continuam necessárias para promover readiness.",
    ),
    metadata={
        "documentation_status": "OFFICIAL_SDK_CONTRACT_VERIFIED",
        "official_sdk_commit": "594744c905ca402d9771f943753420ce334eb594",
        "resource_hosts": [
            "cdpj.partners.bancointer.com.br",
            "cdpj.partners.uatbi.com.br",
            "cdpj-sandbox.partners.uatinter.co",
        ],
        "token_path": "/oauth/v2/token",
        "oauth_client_auth": "BODY",
        "oauth_body_mode": "FORM",
    },
)
