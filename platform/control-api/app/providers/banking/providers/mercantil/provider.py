from __future__ import annotations

from datetime import date
from typing import Any

from app.core.errors import APIError
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.cnab.cnab240 import CNABCompany
from app.providers.cnab.mercantil240 import (
    MercantilCNAB240Generator,
    MercantilCNAB240ReturnParser,
    MercantilCNAB240Settings,
)


class MercantilBankingProvider:
    name = "MERCANTIL"
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
    ) -> MercantilCNAB240Generator:
        data = dict(settings or {})
        agreement_number = str(data.pop("agreement_number", "") or company.agreement or "")
        return MercantilCNAB240Generator(
            company,
            sequence=sequence,
            generation_date=generation_date,
            generation_time=generation_time,
            settings=MercantilCNAB240Settings.from_agreement(
                agreement_number,
                wallet,
                data,
            ),
        )

    @staticmethod
    def parse_cnab240_return(content: bytes) -> list[dict[str, object]]:
        return MercantilCNAB240ReturnParser().parse(content)

    @staticmethod
    def _direct_api_not_available() -> APIError:
        return APIError(
            "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
            "O provider Banco Mercantil rc.29 possui executor CNAB240, mas DIRECT_API não está implementado.",
            422,
            {"provider": "MERCANTIL", "implemented_modes": ["CNAB"]},
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
