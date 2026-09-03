# Compatibilidade: BillingService e Pix Automático ainda importam os contratos
# legados daqui enquanto a migração para capabilities ocorre progressivamente.
from app.providers.banking.base import *  # noqa: F403
from app.providers.banking.core import (
    BankConnectionStatus,
    BankingAuthType,
    BankingCapability,
    BankingEnvironment,
    BankingIntegrationMode,
    BankingProviderContext,
    ProviderManifest,
    ProviderStatus,
)
from app.providers.banking.registry import banking_providers

__all__ = [
    "BankConnectionStatus",
    "BankingAuthType",
    "BankingCapability",
    "BankingEnvironment",
    "BankingIntegrationMode",
    "BankingProviderContext",
    "ProviderManifest",
    "ProviderStatus",
    "banking_providers",
]
