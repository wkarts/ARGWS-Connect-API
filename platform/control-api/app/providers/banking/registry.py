from __future__ import annotations

from typing import Any

from app.core.errors import APIError
from app.providers.banking.base import BankingProvider
from app.providers.banking.core.capabilities import BankingCapability, BankingIntegrationMode
from app.providers.banking.core.manifest import ProviderManifest
from app.providers.banking.providers.asaas import ASAAS_MANIFEST, AsaasBankingProvider
from app.providers.banking.providers.banco_do_brasil import (
    BANCO_DO_BRASIL_MANIFEST,
    BancoDoBrasilBankingProvider,
)
from app.providers.banking.providers.banco_do_nordeste import (
    BANCO_DO_NORDESTE_MANIFEST,
    BancoDoNordesteBankingProvider,
)
from app.providers.banking.providers.banrisul import BANRISUL_MANIFEST, BanrisulBankingProvider
from app.providers.banking.providers.bradesco import BRADESCO_MANIFEST, BradescoBankingProvider
from app.providers.banking.providers.bs2 import BS2_MANIFEST, BS2BankingProvider
from app.providers.banking.providers.c6 import C6_MANIFEST, C6BankingProvider
from app.providers.banking.providers.caixa import CAIXA_MANIFEST, CaixaBankingProvider
from app.providers.banking.providers.catalog import ALL_PROVIDER_MANIFESTS
from app.providers.banking.providers.efi.manifest import EFI_MANIFEST
from app.providers.banking.providers.efi.provider import EfiBankingProvider
from app.providers.banking.providers.inter import INTER_MANIFEST, InterBankingProvider
from app.providers.banking.providers.itau import ITAU_MANIFEST, ItauBankingProvider
from app.providers.banking.providers.mercado_pago import MERCADO_PAGO_MANIFEST, MercadoPagoBankingProvider
from app.providers.banking.providers.mercantil import MERCANTIL_MANIFEST, MercantilBankingProvider
from app.providers.banking.providers.pagbank import PAGBANK_MANIFEST, PagBankBankingProvider
from app.providers.banking.providers.picpay import PICPAY_MANIFEST, PicPayBankingProvider
from app.providers.banking.providers.safra import SAFRA_MANIFEST, SafraBankingProvider
from app.providers.banking.providers.santander import SANTANDER_MANIFEST, SantanderBankingProvider
from app.providers.banking.providers.sicredi import SICREDI_MANIFEST, SicrediBankingProvider
from app.providers.banking.providers.stone import STONE_MANIFEST, StoneBankingProvider
from app.providers.banking.sandbox import SandboxBankingProvider


class BankingProviderRegistry:
    """Registry único de manifests e executores efetivamente instalados.

    O código do registry, ``provider.name`` e ``manifest.code`` precisam ser a
    mesma identidade. Um executor jamais pode ser registrado sob o namespace de
    outra instituição. O modo também é explícito: CNAB não implica DIRECT_API.
    """

    def __init__(self) -> None:
        self._manifests: dict[str, ProviderManifest] = {
            item.code.upper(): item for item in ALL_PROVIDER_MANIFESTS
        }
        for manifest in (
            ASAAS_MANIFEST,
            EFI_MANIFEST,
            BANRISUL_MANIFEST,
            SICREDI_MANIFEST,
            PICPAY_MANIFEST,
            MERCADO_PAGO_MANIFEST,
            PAGBANK_MANIFEST,
            STONE_MANIFEST,
            INTER_MANIFEST,
            SANTANDER_MANIFEST,
            BRADESCO_MANIFEST,
            BS2_MANIFEST,
            CAIXA_MANIFEST,
            BANCO_DO_NORDESTE_MANIFEST,
            SAFRA_MANIFEST,
            C6_MANIFEST,
            BANCO_DO_BRASIL_MANIFEST,
            ITAU_MANIFEST,
            MERCANTIL_MANIFEST,
        ):
            self._manifests[manifest.code] = manifest
        self._providers: dict[str, Any] = {
            "SANDBOX": SandboxBankingProvider(),
            "ASAAS": AsaasBankingProvider(),
            "EFI": EfiBankingProvider(),
            "BANRISUL": BanrisulBankingProvider(),
            "SICREDI": SicrediBankingProvider(),
            "PICPAY": PicPayBankingProvider(),
            "MERCADO_PAGO": MercadoPagoBankingProvider(),
            "PAGBANK": PagBankBankingProvider(),
            "STONE": StoneBankingProvider(),
            "INTER": InterBankingProvider(),
            "SANTANDER": SantanderBankingProvider(),
            "BRADESCO": BradescoBankingProvider(),
            "BS2": BS2BankingProvider(),
            "CAIXA": CaixaBankingProvider(),
            "BANCO_DO_NORDESTE": BancoDoNordesteBankingProvider(),
            "SAFRA": SafraBankingProvider(),
            "C6": C6BankingProvider(),
            "BANCO_DO_BRASIL": BancoDoBrasilBankingProvider(),
            "ITAU": ItauBankingProvider(),
            "MERCANTIL": MercantilBankingProvider(),
        }
        for code, provider in self._providers.items():
            self._assert_provider_identity(code, provider, self._manifests.get(code))

    @staticmethod
    def _assert_provider_identity(
        code: str,
        provider: Any,
        manifest: ProviderManifest | None,
    ) -> None:
        normalized = code.strip().upper()
        declared = str(getattr(provider, "name", "") or "").strip().upper()
        if declared != normalized:
            raise RuntimeError(
                f"Executor bancário {declared or '<sem name>'} não pode ser registrado como {normalized}."
            )
        if manifest is None or manifest.code.strip().upper() != normalized:
            raise RuntimeError(f"Manifest do provider {normalized} está ausente ou associado a outro código.")
        if not manifest.implementation_available or not manifest.effective_implemented_modes():
            raise RuntimeError(
                f"Executor {normalized} foi instalado sem manifest/capability de implementação efetiva."
            )

    def register_manifest(self, manifest: ProviderManifest) -> None:
        self._manifests[manifest.code.upper()] = manifest

    def register(self, name: str, provider: BankingProvider | Any, manifest: ProviderManifest | None = None) -> None:
        code = name.upper()
        candidate_manifest = manifest or self._manifests.get(code)
        self._assert_provider_identity(code, provider, candidate_manifest)
        self._providers[code] = provider
        if manifest is not None:
            self._manifests[code] = manifest

    def provider_or_none(self, name: str) -> BankingProvider | Any | None:
        return self._providers.get(name.upper())

    def installed(self, name: str) -> bool:
        return name.upper() in self._providers

    def manifest(self, name: str) -> ProviderManifest:
        manifest = self._manifests.get(name.upper())
        if manifest is None:
            raise APIError(
                "BANKING_PROVIDER_UNKNOWN",
                "Provider bancário não existe no catálogo desta versão.",
                404,
                {"provider": name},
            )
        return manifest

    def manifests(self) -> tuple[ProviderManifest, ...]:
        return tuple(sorted(self._manifests.values(), key=lambda item: (item.name.casefold(), item.code)))

    def mode_available(self, name: str, mode: BankingIntegrationMode) -> bool:
        manifest = self.manifest(name)
        return (
            manifest.implementation_available
            and name.upper() in self._providers
            and mode in manifest.effective_implemented_modes()
        )

    def connectable_manifests(self) -> tuple[ProviderManifest, ...]:
        """Somente providers com executor DIRECT_API pertencem a BankConnection."""
        return tuple(
            item
            for item in self.manifests()
            if item.implementation_available
            and item.code in self._providers
            and BankingIntegrationMode.DIRECT_API in item.effective_implemented_modes()
        )

    def support_matrix(self) -> list[dict[str, Any]]:
        return [
            {
                "provider": manifest.code,
                "name": manifest.name,
                "status": manifest.status.value,
                "implementation_available": manifest.implementation_available,
                "driver_installed": manifest.code in self._providers,
                "integration_modes": sorted(item.value for item in manifest.integration_modes),
                "implemented_modes": sorted(item.value for item in manifest.effective_implemented_modes()),
                "capabilities": {
                    capability.value: capability in manifest.capabilities
                    for capability in BankingCapability
                },
            }
            for manifest in self.manifests()
        ]

    def get(self, name: str) -> BankingProvider | Any:
        provider = self._providers.get(name.upper())
        if provider is None:
            manifest = self._manifests.get(name.upper())
            raise APIError(
                "BANKING_PROVIDER_NOT_AVAILABLE",
                "Provider bancário catalogado, porém sem executor implementado nesta versão."
                if manifest
                else "Provider bancário não instalado.",
                422,
                {
                    "provider": name,
                    "status": manifest.status.value if manifest else None,
                    "documentation": [item.url for item in manifest.documentation] if manifest else [],
                },
            )
        manifest = self._manifests.get(name.upper())
        self._assert_provider_identity(name.upper(), provider, manifest)
        return provider

    def get_for_mode(self, name: str, mode: BankingIntegrationMode) -> Any:
        manifest = self.manifest(name)
        if mode not in manifest.effective_implemented_modes():
            raise APIError(
                "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
                "O provider não possui executor para o modo de integração solicitado nesta versão.",
                422,
                {
                    "provider": name,
                    "mode": mode.value,
                    "implemented_modes": sorted(item.value for item in manifest.effective_implemented_modes()),
                },
            )
        return self.get(name)

    def get_for_capability(self, name: str, capability: BankingCapability) -> Any:
        manifest = self.manifest(name)
        if capability not in manifest.capabilities:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "A instituição não anuncia suporte a esta capacidade no contrato documental atual.",
                422,
                {"provider": name, "capability": capability.value},
            )
        return self.get(name)


banking_providers = BankingProviderRegistry()
