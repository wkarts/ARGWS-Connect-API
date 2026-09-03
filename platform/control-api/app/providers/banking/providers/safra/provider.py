from __future__ import annotations

from datetime import date
from typing import Any

from app.core.errors import APIError
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.cnab.cnab240 import CNABCompany
from app.providers.cnab.safra240 import (
    SafraCNAB240Generator,
    SafraCNAB240ReturnParser,
    SafraCNAB240Settings,
)


class SafraBankingProvider:
    name = "SAFRA"
    driver_version = "1.0.0-rc.28"

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
    ) -> SafraCNAB240Generator:
        cnab_settings = SafraCNAB240Settings.from_agreement(wallet, settings)
        return SafraCNAB240Generator(
            company,
            sequence=sequence,
            generation_date=generation_date,
            settings=cnab_settings,
            generation_time=generation_time,
        )

    @staticmethod
    def parse_cnab240_return(content: bytes) -> list[dict[str, object]]:
        first_line = next(
            (line for line in content.decode("latin-1", errors="ignore").splitlines() if line.strip()),
            "",
        )
        if not first_line or len(first_line) != 240:
            raise ValueError("Arquivo de retorno Safra deve possuir registros de 240 posições.")
        if first_line[:3] != "422":
            raise ValueError("Arquivo CNAB informado não pertence ao Banco Safra (422).")
        events = SafraCNAB240ReturnParser().parse(content)
        for event in events:
            segments = dict(event.get("segments") or {})
            segment_t = segments.get("T")
            if isinstance(segment_t, str) and len(segment_t) == 240:
                # Manual Safra 08/2026: tipo inscrição na posição 133,
                # número 134-148 e nome 149-188.
                event["payer_tax_id"] = segment_t[133:148].strip()
                event["payer_name"] = segment_t[148:188].strip()
            event["provider"] = "SAFRA"
            event["bank_code"] = "422"
        return events

    @staticmethod
    def _direct_api_not_available() -> APIError:
        return APIError(
            "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
            "O provider Safra rc.28 possui executor CNAB 240, mas não possui DIRECT_API implementado.",
            422,
            {"provider": "SAFRA", "implemented_modes": ["CNAB"]},
        )

    async def health_check(self, context: Any) -> dict[str, Any]:
        del context
        return {
            "status": "CONFIGURED",
            "provider": self.name,
            "mode": "CNAB",
            "financial_operation": False,
            "configuration_only": True,
        }

    async def create_charge(self, *_: Any, **__: Any) -> Any:
        raise self._direct_api_not_available()

    async def get_charge(self, *_: Any, **__: Any) -> Any:
        raise self._direct_api_not_available()

    async def cancel_charge(self, *_: Any, **__: Any) -> Any:
        raise self._direct_api_not_available()
