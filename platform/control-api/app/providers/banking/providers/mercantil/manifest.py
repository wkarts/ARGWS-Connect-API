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

CHECKED_AT = date(2026, 8, 25)

MERCANTIL_MANIFEST = ProviderManifest(
    code="MERCANTIL",
    name="Banco Mercantil",
    institution=BankInstitutionReference(
        name="BANCO MERCANTIL DO BRASIL S.A.",
        bank_code="389",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({BankingIntegrationMode.CNAB, BankingIntegrationMode.OPEN_FINANCE}),
    implemented_modes=frozenset({BankingIntegrationMode.CNAB}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.CNAB_240}),
    authentication=AuthenticationManifest(
        BankingAuthType.NONE,
        notes="Executor rc.29 exclusivamente CNAB240. Contrato, agência, conta e carteira pertencem ao BankAgreement/BankAccount do tenant.",
    ),
    documentation=(
        DocumentationReference(
            url="https://bancomercantil.com.br/Empresas/Cobranca/Documentos%20Compartilhados/CobrancaCNAB240Mensagens.pdf",
            title="Banco Mercantil — Cobrança Escritural — Layout CNAB 240",
            version="01",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://bancomercantil.com.br/empresas/office-banking/cobranca",
            title="Banco Mercantil — Cobrança / Office Banking",
            checked_at=CHECKED_AT,
        ),
    ),
    cnab=CNABManifest(
        layouts=("240",),
        homologated=False,
        notes=(
            "O manual oficial exige testes com dados simulados antes da operação; a conclusão da homologação é comunicada formalmente pelo banco."
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Capability efetiva rc.29: CNAB_240 de Cobrança Escritural Mercantil.",
        "Escopo inicial: carteira 1 (Cobrança Simples com Registro), movimento 01, segmentos P/Q e retorno T/U.",
        "Nosso Número é enviado zerado para que o banco atribua a numeração na entrada, conforme C005 do manual.",
        "Sem juros, desconto, IOF, abatimento, protesto, mensagens R/S/Y ou outras carteiras nesta capability inicial.",
        "DIRECT_API não está implementado e o provider não aparece em BankConnection.",
        "IMPLEMENTED não significa HOMOLOGATED ou PRODUCTION_READY.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "COBRANCA_ESCRITURAL_CNAB240",
        "file_layout_version": "040",
        "lot_layout_version": "040",
        "bank_code": "389",
        "cnab_settings_schema": [
            {"key": "agreement_number", "source": "BankAgreement.agreement_number", "length": 9},
            {"key": "wallet", "source": "BankAgreement.wallet", "allowed": ["1"]},
            {"key": "species_code", "source": "BankAgreement.settings", "allowed": ["01", "02", "03", "05", "06", "07", "09"]},
            {"key": "acceptance", "source": "BankAgreement.settings", "allowed": ["S", "N"]},
        ],
    },
)
