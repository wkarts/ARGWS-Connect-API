from __future__ import annotations

from app.core.errors import APIError
from app.providers.fiscal.base import FiscalProvider
from app.providers.fiscal.sandbox import SandboxNFSeProvider


class FiscalProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, FiscalProvider] = {}

    def register(self, provider: FiscalProvider) -> None:
        self._providers[provider.name.upper()] = provider

    def get(self, name: str) -> FiscalProvider:
        provider = self._providers.get(name.upper())
        if provider is None:
            raise APIError(
                "FISCAL_PROVIDER_NOT_IMPLEMENTED",
                "Provider fiscal não implementado. Cadastre/homologue o adapter específico antes de produção.",
                422,
                {"provider": name},
            )
        return provider

    def names(self) -> list[str]:
        return sorted(self._providers)


fiscal_providers = FiscalProviderRegistry()
fiscal_providers.register(SandboxNFSeProvider())
