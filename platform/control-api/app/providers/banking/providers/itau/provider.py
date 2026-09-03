from __future__ import annotations

from datetime import date
from typing import Any

from app.core.errors import APIError
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.cnab.cnab240 import CNABCompany
from app.providers.cnab.itau240 import ItauCNAB240Generator, ItauCNAB240ReturnParser, ItauCNAB240Settings


class ItauBankingProvider:
    name = "ITAU"
    driver_version = "1.0.0-rc.29"

    @staticmethod
    def implemented_modes() -> frozenset[BankingIntegrationMode]:
        return frozenset({BankingIntegrationMode.CNAB})

    @staticmethod
    def build_cnab240_generator(
        *,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        generation_time: str,
        wallet: str | None,
        settings: dict[str, Any] | None,
    ) -> ItauCNAB240Generator:
        return ItauCNAB240Generator(
            company,
            sequence=sequence,
            generation_date=generation_date,
            generation_time=generation_time,
            settings=ItauCNAB240Settings.from_agreement(wallet, settings),
        )

    @staticmethod
    def parse_cnab240_return(content: bytes) -> list[dict[str, object]]:
        return ItauCNAB240ReturnParser().parse(content)

    @staticmethod
    def _direct_api_not_available() -> APIError:
        return APIError(
            "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
            "O provider Itaú rc.29 possui executor CNAB240, mas DIRECT_API não está implementado.",
            422,
            {"provider": "ITAU", "implemented_modes": ["CNAB"]},
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
