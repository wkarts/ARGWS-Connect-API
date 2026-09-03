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

CHECKED_AT = date(2026, 8, 23)

SAFRA_MANIFEST = ProviderManifest(
    code="SAFRA",
    name="Banco Safra",
    institution=BankInstitutionReference(
        name="BANCO SAFRA S.A.",
        bank_code="422",
        ispb="58160789",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({
        BankingIntegrationMode.CNAB,
        BankingIntegrationMode.OPEN_FINANCE,
    }),
    implemented_modes=frozenset({BankingIntegrationMode.CNAB}),
    environments=frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION}),
    capabilities=frozenset({BankingCapability.CNAB_240}),
    authentication=AuthenticationManifest(
        BankingAuthType.NONE,
        notes="CNAB não usa credencial HTTP. Convênio, agência, conta, carteira e parâmetros de cobrança pertencem ao BankAgreement do tenant.",
    ),
    documentation=(
        DocumentationReference(
            url="https://www.safra.com.br/servicos-para-sua-empresa/cobranca.htm",
            title="Cobrança — Banco Safra",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://www.safra.com.br/data/files/25/00/42/7B/6F1FF9103FAE9CF9423EF9C2/CNAB%20240%20-%2008.26.pdf",
            title="Layout Padrão Safra 240 — Cobrança Produto 500",
            version="08.26",
            checked_at=CHECKED_AT,
        ),
    ),
    cnab=CNABManifest(
        layouts=("240",),
        homologated=False,
        notes=(
            "Layout de arquivo 103 e layout de lote 060. "
            "A homologação do arquivo/convênio com a Mesa de Implantação Safra continua obrigatória."
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "Executor rc.28 implementa CNAB 240 Safra para entrada de títulos, segmentos P/Q, e retorno T/U.",
        "DIRECT_API não está implementado e o provider não aparece em BankConnection.",
        "Carteira e decisões de emissão/distribuição/protesto/baixa são lidas do BankAgreement; não são inventadas pelo driver.",
        "Juros, descontos, abatimentos e segmentos opcionais R/S/Y permanecem fora da capacidade efetiva desta release.",
        "IMPLEMENTED não significa HOMOLOGATED ou PRODUCTION_READY.",
    ),
    metadata={
        "documentation_status": "PUBLIC_VERIFIED",
        "product": "COBRANCA_500_CNAB240",
        "file_layout_version": "103",
        "lot_layout_version": "060",
        "cnab_settings_schema": [
            {"key": "wallet", "source": "BankAgreement.wallet", "allowed": ["1", "2"]},
            {"key": "registration_mode", "allowed": ["1", "3"]},
            {"key": "document_type", "allowed": ["1", "2"]},
            {"key": "boleto_emission", "allowed": ["1", "2"]},
            {"key": "boleto_distribution", "allowed": ["1", "2"]},
            {"key": "species_code", "allowed": ["02", "04", "12", "16", "17", "31", "33"]},
            {"key": "acceptance", "allowed": ["A", "N"]},
            {"key": "protest_code", "allowed": ["1", "2", "3", "7", "8"]},
            {"key": "protest_days", "type": "integer"},
            {"key": "writeoff_code", "allowed": ["1", "2"]},
            {"key": "writeoff_days", "type": "integer"},
        ],
    },
)
