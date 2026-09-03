from __future__ import annotations

from datetime import date
from typing import Any

from app.core.errors import APIError
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.cnab.c6_400 import (
    C6CNAB400Generator,
    C6CNAB400ReturnParser,
    C6CNAB400Settings,
)
from app.providers.cnab.cnab240 import CNABCompany


class C6BankingProvider:
    name = "C6"
    driver_version = "1.0.0-rc.29"

    @staticmethod
    def implemented_modes() -> frozenset[BankingIntegrationMode]:
        return frozenset({BankingIntegrationMode.CNAB})

    @staticmethod
    def build_cnab400_generator(
        *,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        wallet: str | None,
        settings: dict[str, Any] | None,
    ) -> C6CNAB400Generator:
        return C6CNAB400Generator(
            company,
            sequence=sequence,
            generation_date=generation_date,
            settings=C6CNAB400Settings.from_agreement(wallet, settings),
        )

    @staticmethod
    def parse_cnab400_return(content: bytes) -> list[dict[str, object]]:
        return C6CNAB400ReturnParser().parse(content)

    @staticmethod
    def _direct_api_not_available() -> APIError:
        return APIError(
            "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
            "O provider C6 rc.29 possui executor CNAB400, mas DIRECT_API não está implementado.",
            422,
            {"provider": "C6", "implemented_modes": ["CNAB"]},
        )

    async def health_check(self, context: Any) -> dict[str, Any]:
        del context
        return {
            "status": "CONFIGURED",
            "provider": self.name,
            "mode": "CNAB",
            "configuration_only": True,
            "financial_operation": False,
        }

    async def create_charge(self, *_: Any, **__: Any) -> Any:
        raise self._direct_api_not_available()

    async def get_charge(self, *_: Any, **__: Any) -> Any:
        raise self._direct_api_not_available()

    async def cancel_charge(self, *_: Any, **__: Any) -> Any:
        raise self._direct_api_not_available()
