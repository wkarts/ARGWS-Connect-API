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
    CNABManifest,
    DocumentationReference,
    ProviderManifest,
)

CHECKED_AT = date(2026, 8, 24)

ITAU_MANIFEST = ProviderManifest(
    code="ITAU",
    name="Itaú Unibanco",
    institution=BankInstitutionReference(
        name="ITAÚ UNIBANCO S.A.",
        bank_code="341",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({
        BankingIntegrationMode.DIRECT_API,
        BankingIntegrationMode.CNAB,
        BankingIntegrationMode.OPEN_FINANCE,
    }),
    implemented_modes=frozenset({BankingIntegrationMode.CNAB}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.CNAB_240}),
    authentication=AuthenticationManifest(
        BankingAuthType.NONE,
        notes="Executor rc.29 exclusivamente CNAB240 de Cobrança. Agência, conta, DAC e carteira pertencem ao tenant/convênio.",
    ),
    documentation=(
        DocumentationReference(
            url="https://download.itau.com.br/bankline/cobranca_cnab240.pdf",
            title="Itaú — Cobrança Bancária — Layout de Arquivos FEBRABAN 240",
            version="Janeiro/2017",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://www.itau.com.br/empresas/pagamentos-recebimentos/cobranca",
            title="Itaú Empresas — Cobrança",
            checked_at=CHECKED_AT,
        ),
    ),
    cnab=CNABManifest(
        layouts=("240",),
        homologated=False,
        notes=(
            "Layout Itaú FEBRABAN240 com adaptações próprias. O banco mantém validador de layout e recomenda validação/homologação antes da operação."
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Capability efetiva rc.29: CNAB_240 de Cobrança Itaú.",
        "Escopo inicial: carteiras escriturais 112/212, ocorrência 01, segmentos P/Q, Nosso Número zerado e atribuído pelo Itaú.",
        "Sem juros, desconto, IOF, abatimento, protesto/negativação, baixa automática e segmentos opcionais R/Y nesta capability.",
        "O manual oficial é de 2017 e continua publicado pelo Itaú; homologação atual no validador Itaú é obrigatória antes de produção.",
        "DIRECT_API e OPEN_FINANCE não são executores desta release.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "COBRANCA_CNAB240",
        "file_layout_version": "040",
        "lot_layout_version": "030",
        "bank_code": "341",
        "cnab_settings_schema": [
            {"key": "wallet", "source": "BankAgreement.wallet", "allowed": ["112", "212"]},
            {"key": "species_code", "source": "BankAgreement.settings", "allowed": ["01", "02", "03", "04", "05", "06", "07", "08", "09", "13", "15", "16", "17", "99"]},
            {"key": "acceptance", "source": "BankAgreement.settings", "allowed": ["A", "N"]},
        ],
    },
)
