from app.providers.banking.providers.asaas.manifest import ASAAS_MANIFEST
from app.providers.banking.providers.asaas.provider import AsaasBankingProvider

# O webhook é carregado diretamente pelo router específico para evitar ciclo
# registry -> provider package -> webhook -> BillingService -> registry.
__all__ = ["ASAAS_MANIFEST", "AsaasBankingProvider"]
