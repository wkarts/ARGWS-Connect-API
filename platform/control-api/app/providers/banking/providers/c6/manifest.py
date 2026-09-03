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

C6_MANIFEST = ProviderManifest(
    code="C6",
    name="C6 Bank",
    institution=BankInstitutionReference(
        name="BANCO C6 S.A.",
        bank_code="336",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({
        BankingIntegrationMode.DIRECT_API,
        BankingIntegrationMode.CNAB,
    }),
    implemented_modes=frozenset({BankingIntegrationMode.CNAB}),
    environments=frozenset({BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.CNAB_400}),
    authentication=AuthenticationManifest(
        BankingAuthType.NONE,
        notes=(
            "O executor rc.29 é exclusivamente CNAB400. Não existe credencial HTTP neste modo. "
            "Código do beneficiário, conta cobrança, carteira e parâmetros do convênio pertencem ao tenant."
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://cms-assets-p.c6bank.com.br/uploads/manual-cnab.pdf",
            title="C6 Empresas — Cobrança Bancária — Padrão CNAB 400 Posições",
            version="2.7 — Julho/2025",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://developers.c6bank.com.br/",
            title="Portal oficial C6 Bank Developers",
            checked_at=CHECKED_AT,
        ),
    ),
    cnab=CNABManifest(
        layouts=("400",),
        homologated=False,
        notes=(
            "Manual C6 v2.7. A instituição descreve implantação por 'Teste em Produção'; "
            "todo título aceito compõe a carteira real. Validação operacional com o banco continua obrigatória."
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Capability efetiva rc.29: CNAB_400 para entrada de títulos em Carteira 10 (Cobrança Simples Emissão Banco).",
        "Carteira 20 permanece fora do escopo até implementar e testar Nosso Número/DV conforme o manual C6.",
        "DIRECT_API continua apenas catalogado; este manifest não cria BankConnection C6.",
        "Juros, descontos, multa, abatimento, registro opcional tipo 2 e comandos de alteração não são anunciados nesta primeira capability.",
        "IMPLEMENTED não significa HOMOLOGATED nem PRODUCTION_READY.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "COBRANCA_CNAB400",
        "manual_version": "2.7",
        "manual_date": "2025-07",
        "bank_code": "336",
        "cnab_settings_schema": [
            {"key": "wallet", "source": "BankAgreement.wallet", "allowed": ["10"]},
            {"key": "beneficiary_code", "source": "BankAgreement.settings", "type": "numeric", "max_length": 12},
            {"key": "collection_account", "source": "BankAgreement.settings", "type": "numeric", "max_length": 12},
            {"key": "species_code", "source": "BankAgreement.settings", "allowed": ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15", "16", "17", "33", "99"]},
            {"key": "acceptance", "source": "BankAgreement.settings", "allowed": ["A", "N"]},
        ],
    },
)
