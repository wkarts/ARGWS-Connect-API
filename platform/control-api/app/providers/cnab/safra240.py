from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from app.providers.cnab.cnab240 import (
    CNAB240Generator,
    CNAB240ReturnParser,
    CNABCompany,
    CNABTitle,
    ascii_text,
    ddmmyyyy,
    numeric,
    record,
)


@dataclass(frozen=True, slots=True)
class SafraCNAB240Settings:
    """Opções negociais que o manual Safra exige no Segmento P.

    Não assumimos carteira, emissão, distribuição ou política de protesto em
    nome do tenant. Esses valores pertencem ao convênio homologado com o banco.
    """

    wallet: str
    registration_mode: str
    document_type: str
    boleto_emission: str
    boleto_distribution: str
    species_code: str
    acceptance: str
    protest_code: str
    protest_days: int
    writeoff_code: str
    writeoff_days: int

    @classmethod
    def from_agreement(cls, wallet: str | None, settings: dict[str, Any] | None) -> "SafraCNAB240Settings":
        data = dict(settings or {})
        required = (
            "registration_mode",
            "document_type",
            "boleto_emission",
            "boleto_distribution",
            "species_code",
            "acceptance",
            "protest_code",
            "protest_days",
            "writeoff_code",
            "writeoff_days",
        )
        missing = [key for key in required if data.get(key) in (None, "")]
        if not str(wallet or "").strip():
            missing.insert(0, "wallet")
        if missing:
            raise ValueError(
                "Configuração CNAB Safra incompleta. Informe no convênio: " + ", ".join(missing)
            )

        result = cls(
            wallet=str(wallet).strip(),
            registration_mode=str(data["registration_mode"]).strip(),
            document_type=str(data["document_type"]).strip(),
            boleto_emission=str(data["boleto_emission"]).strip(),
            boleto_distribution=str(data["boleto_distribution"]).strip(),
            species_code=str(data["species_code"]).strip().zfill(2),
            acceptance=str(data["acceptance"]).strip().upper(),
            protest_code=str(data["protest_code"]).strip(),
            protest_days=int(data["protest_days"]),
            writeoff_code=str(data["writeoff_code"]).strip(),
            writeoff_days=int(data["writeoff_days"]),
        )
        result.validate()
        return result

    def validate(self) -> None:
        if self.wallet not in {"1", "2"}:
            raise ValueError("Carteira Safra inválida: use 1 (Simples) ou 2 (Vinculada).")
        if self.registration_mode not in {"1", "3"}:
            raise ValueError("Forma de cadastramento Safra inválida: use 1 ou 3.")
        if self.document_type not in {"1", "2"}:
            raise ValueError("Tipo de documento Safra inválido: use 1 (Tradicional) ou 2 (Escritural).")
        if self.boleto_emission not in {"1", "2"}:
            raise ValueError("Emissão do boleto Safra inválida: use 1 (Banco) ou 2 (Cliente).")
        if self.boleto_distribution not in {"1", "2"}:
            raise ValueError("Distribuição do boleto Safra inválida: use 1 (Banco) ou 2 (Cliente).")
        if self.species_code not in {"02", "04", "12", "16", "17", "31", "33"}:
            raise ValueError("Espécie de título Safra não suportada pelo manual atual.")
        if self.acceptance not in {"A", "N"}:
            raise ValueError("Aceite Safra inválido: use A ou N.")
        if self.protest_code not in {"1", "2", "3", "7", "8"}:
            raise ValueError("Código de protesto Safra inválido para entrada de título.")
        if self.writeoff_code not in {"1", "2"}:
            raise ValueError("Código de baixa/devolução Safra inválido para entrada de título.")
        if not 0 <= self.protest_days <= 99:
            raise ValueError("Prazo de protesto Safra deve estar entre 0 e 99 dias.")
        if not 0 <= self.writeoff_days <= 999:
            raise ValueError("Prazo de baixa/devolução Safra deve estar entre 0 e 999 dias.")
        if self.protest_code in {"1", "2"} and self.protest_days == 0:
            raise ValueError("Prazo de protesto é obrigatório quando o convênio solicita protesto.")
        if self.writeoff_code == "1" and self.writeoff_days == 0:
            raise ValueError("Prazo de baixa/devolução é obrigatório quando o convênio solicita baixa.")
        if self.protest_code in {"1", "2"} and self.writeoff_code == "1":
            if self.writeoff_days < self.protest_days:
                raise ValueError("Prazo de baixa/devolução não pode ser menor que o prazo de protesto.")
        if self.wallet == "1" and self.protest_code == "1":
            raise ValueError("Safra reserva protesto em dias corridos (código 1) à Cobrança Vinculada.")
        if self.wallet == "2" and self.protest_code == "2":
            raise ValueError("Safra reserva protesto em dias úteis (código 2) à Cobrança Simples.")


class SafraCNAB240Generator(CNAB240Generator):
    """Cobrança Safra CNAB 240 — manual oficial Agosto/2026.

    Escopo desta primeira implementação: entrada de títulos (movimento 01),
    Segmentos P/Q obrigatórios, sem juros, desconto, abatimento ou segmentos
    opcionais R/S/Y. Esses recursos só serão anunciados após implementação
    específica e homologação documental.
    """

    BANK_CODE = "422"
    FILE_LAYOUT_VERSION = "103"
    LOT_LAYOUT_VERSION = "060"

    def __init__(
        self,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        *,
        settings: SafraCNAB240Settings,
        generation_time: str = "000000",
    ) -> None:
        if numeric(company.bank_code, 3) != self.BANK_CODE:
            raise ValueError("SafraCNAB240Generator exige código bancário 422.")
        self.company = company
        self.sequence = sequence
        self.generation_date = generation_date
        self.settings = settings
        raw_time = "".join(ch for ch in generation_time if ch.isdigit())
        if len(raw_time) != 6:
            raise ValueError("generation_time deve usar HHMMSS com 6 dígitos.")
        self.generation_time = raw_time

    @staticmethod
    def _tax_type(value: str) -> str:
        digits = "".join(ch for ch in str(value) if ch.isdigit())
        if len(digits) == 11:
            return "1"
        if len(digits) == 14:
            return "2"
        raise ValueError("CPF/CNPJ da empresa deve possuir 11 ou 14 dígitos para o CNAB Safra.")

    @staticmethod
    def _payer_tax_type(value: str) -> str:
        digits = "".join(ch for ch in str(value) if ch.isdigit())
        if len(digits) == 11:
            return "1"
        if len(digits) == 14:
            return "2"
        raise ValueError("CPF/CNPJ do pagador deve possuir 11 ou 14 dígitos para o CNAB Safra.")

    @staticmethod
    def _document_number(value: str) -> str:
        normalized = ascii_text(value, 15).strip()
        # O campo físico tem 15 posições, mas o manual Safra declara
        # disponibilidade de 10 posições para o cliente.
        if len(normalized) > 10:
            raise ValueError("Número do documento Safra excede as 10 posições disponíveis.")
        return normalized.ljust(15)

    @staticmethod
    def _our_number(value: str) -> str:
        digits = "".join(ch for ch in str(value or "") if ch.isdigit())
        if not digits or int(digits or "0") == 0:
            return "0" * 20
        if len(digits) > 9:
            raise ValueError("Nosso Número Safra deve possuir no máximo 9 posições numéricas.")
        return numeric(digits, 20)

    @staticmethod
    def _zip(value: str) -> tuple[str, str]:
        digits = "".join(ch for ch in str(value or "") if ch.isdigit())
        if len(digits) != 8 or digits == "00000000":
            raise ValueError("CEP do pagador é obrigatório e deve possuir 8 dígitos no CNAB Safra.")
        return digits[:5], digits[5:]

    def file_header(self) -> str:
        c = self.company
        return record(
            self.BANK_CODE,
            "0000",
            "0",
            " " * 9,
            self._tax_type(c.tax_id),
            numeric(c.tax_id, 14),
            ascii_text(c.agreement, 20),
            numeric(c.branch, 5),
            ascii_text(c.branch_digit, 1),
            numeric(c.account, 12),
            ascii_text(c.account_digit, 1),
            " ",
            ascii_text(c.name, 30),
            ascii_text("BANCO SAFRA S/A", 30),
            " " * 10,
            "1",
            ddmmyyyy(self.generation_date),
            self.generation_time,
            numeric(self.sequence, 6),
            self.FILE_LAYOUT_VERSION,
            "00000",
            " " * 20,
            " " * 20,
            " " * 29,
        )

    def lot_header(self) -> str:
        c = self.company
        return record(
            self.BANK_CODE,
            "0001",
            "1",
            "R",
            "01",
            "  ",
            self.LOT_LAYOUT_VERSION,
            " ",
            self._tax_type(c.tax_id),
            numeric(c.tax_id, 15),
            ascii_text(c.agreement, 20),
            numeric(c.branch, 5),
            ascii_text(c.branch_digit, 1),
            numeric(c.account, 12),
            ascii_text(c.account_digit, 1),
            " ",
            ascii_text(c.name, 30),
            " " * 40,
            " " * 40,
            numeric(self.sequence, 8),
            ddmmyyyy(self.generation_date),
            "00000000",
            " " * 33,
        )

    def segment_p(self, title: CNABTitle, sequence: int) -> str:
        c = self.company
        document_number = self._document_number(title.document_number)
        return record(
            self.BANK_CODE,
            "0001",
            "3",
            numeric(sequence, 5),
            "P",
            " ",
            "01",
            numeric(c.branch, 5),
            ascii_text(c.branch_digit, 1),
            numeric(c.account, 12),
            ascii_text(c.account_digit, 1),
            " ",
            self._our_number(title.our_number),
            self.settings.wallet,
            self.settings.registration_mode,
            self.settings.document_type,
            self.settings.boleto_emission,
            self.settings.boleto_distribution,
            document_number,
            ddmmyyyy(title.due_date),
            numeric(title.amount, 15),
            "00000",
            " ",
            self.settings.species_code,
            self.settings.acceptance,
            ddmmyyyy(self.generation_date),
            "3",  # C018: isento de juros na capacidade implementada nesta release
            "00000000",
            numeric(0, 15),
            "0",  # campo numérico sem desconto nesta capacidade
            "00000000",
            numeric(0, 15),
            numeric(0, 15),
            numeric(0, 15),
            ascii_text(title.document_number, 25),
            self.settings.protest_code,
            numeric(self.settings.protest_days, 2),
            self.settings.writeoff_code,
            numeric(self.settings.writeoff_days, 3),
            "09",  # G065: Real
            "0" * 10,
            " ",
        )

    def segment_q(self, title: CNABTitle, sequence: int) -> str:
        cep, suffix = self._zip(title.payer_zip_code)
        if not title.payer_name.strip():
            raise ValueError("Nome do pagador é obrigatório para o CNAB Safra.")
        if not title.payer_address.strip():
            raise ValueError("Endereço do pagador é obrigatório para o CNAB Safra.")
        if not title.payer_city.strip() or len(title.payer_state.strip()) != 2:
            raise ValueError("Cidade e UF do pagador são obrigatórias para o CNAB Safra.")
        return record(
            self.BANK_CODE,
            "0001",
            "3",
            numeric(sequence, 5),
            "Q",
            " ",
            "01",
            self._payer_tax_type(title.payer_tax_id),
            numeric(title.payer_tax_id, 15),
            ascii_text(title.payer_name, 40),
            ascii_text(title.payer_address, 40),
            " " * 15,
            cep,
            suffix,
            ascii_text(title.payer_city, 15),
            ascii_text(title.payer_state, 2),
            "0",
            "0" * 15,
            " " * 40,
            "000",
            " " * 20,
            " " * 8,
        )

    def lot_trailer(self, title_count: int, total: Decimal) -> str:
        record_count = 2 + title_count * 2
        simple_count = title_count if self.settings.wallet == "1" else 0
        simple_total = total if self.settings.wallet == "1" else Decimal("0")
        linked_count = title_count if self.settings.wallet == "2" else 0
        linked_total = total if self.settings.wallet == "2" else Decimal("0")
        return record(
            self.BANK_CODE,
            "0001",
            "5",
            " " * 9,
            numeric(record_count, 6),
            numeric(simple_count, 6),
            numeric(simple_total, 17),
            numeric(linked_count, 6),
            numeric(linked_total, 17),
            "0" * 6,
            "0" * 17,
            "0" * 6,
            "0" * 17,
            " " * 8,
            " " * 117,
        )

    def file_trailer(self, record_count: int) -> str:
        return record(
            self.BANK_CODE,
            "9999",
            "9",
            " " * 9,
            "000001",
            numeric(record_count, 6),
            "000000",
            " " * 205,
        )


class SafraCNAB240ReturnParser(CNAB240ReturnParser):
    """Parser Safra T/U com códigos de movimento documentados no manual 08/2026."""

    OCCURRENCES = {
        **CNAB240ReturnParser.OCCURRENCES,
        "04": "Transferência de carteira/entrada",
        "05": "Transferência de carteira/baixa",
        "07": "Confirmação da instrução de desconto",
        "08": "Confirmação do cancelamento de desconto",
        "15": "Franco de pagamento",
        "24": "Retirada de cartório e manutenção em carteira",
        "25": "Protestado e baixado",
        "26": "Instrução rejeitada",
        "27": "Alteração de outros dados confirmada",
        "29": "Ocorrência do pagador",
        "33": "Alteração de rateio confirmada",
        "34": "Cancelamento de rateio confirmado",
        "51": "Título DDA reconhecido pelo pagador",
        "52": "Título DDA não reconhecido pelo pagador",
        "53": "Título DDA recusado pela CIP",
    }

    def parse(self, content: bytes) -> list[dict[str, object]]:
        lines = [line.rstrip("\r\n") for line in content.decode("latin-1").splitlines() if line.strip()]
        if lines and lines[0][:3] != self.BANK_CODE if hasattr(self, "BANK_CODE") else False:
            raise ValueError("Arquivo CNAB informado não pertence ao Banco Safra (422).")
        events = super().parse(content)
        for event in events:
            event["provider"] = "SAFRA"
            event["bank_code"] = "422"
        return events
