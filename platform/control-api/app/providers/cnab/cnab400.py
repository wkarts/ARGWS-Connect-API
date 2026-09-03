from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from app.providers.cnab.cnab240 import CNABCompany, CNABTitle, ascii_text, numeric


def record400(*parts: str) -> str:
    value = "".join(parts)
    if len(value) > 400:
        raise ValueError(f"Registro CNAB 400 maior que 400 posições: {len(value)}")
    return value.ljust(400)


@dataclass(frozen=True, slots=True)
class CNAB400Layout:
    """Metadados genéricos; cada banco deve especializar para homologação."""

    service_code: str = "01"
    service_name: str = "COBRANCA"
    wallet: str = ""
    currency_code: str = "9"
    acceptance: str = "N"
    species_code: str = "01"
    instruction_1: str = "00"
    instruction_2: str = "00"


class CNAB400Generator:
    """Gerador-base CNAB 400 com registros de 400 posições.

    O CNAB 400 não possui um único mapa universal entre bancos. Este núcleo
    entrega o lifecycle e a serialização exata; homologações devem sobrescrever
    ``detail`` quando o convênio exigir posições específicas.
    """

    def __init__(
        self,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        layout: CNAB400Layout | None = None,
    ) -> None:
        self.company = company
        self.sequence = sequence
        self.generation_date = generation_date
        self.layout = layout or CNAB400Layout()

    def header(self) -> str:
        c = self.company
        return record400(
            "0",
            "1",
            ascii_text("REMESSA", 7),
            numeric(self.layout.service_code, 2),
            ascii_text(self.layout.service_name, 15),
            ascii_text(c.agreement, 20),
            ascii_text(c.name, 30),
            numeric(c.bank_code, 3),
            ascii_text("BANCO", 15),
            self.generation_date.strftime("%d%m%y"),
            " " * 8,
            "MX",
            numeric(self.sequence, 7),
            " " * 277,
            numeric(1, 6),
        )

    def detail(self, title: CNABTitle, sequence: int) -> str:
        c = self.company
        payer_digits = "".join(ch for ch in title.payer_tax_id if ch.isdigit())
        payer_type = "01" if len(payer_digits) <= 11 else "02"
        return record400(
            "1",
            "02",
            numeric(c.tax_id, 14),
            numeric(c.branch, 4),
            ascii_text(c.branch_digit, 1),
            numeric(c.account, 8),
            ascii_text(c.account_digit, 1),
            " " * 6,
            ascii_text(title.document_number, 25),
            numeric(title.our_number, 11),
            "0" * 10,
            " " * 25,
            "0",
            self.layout.wallet[:1].ljust(1),
            self.layout.currency_code[:1],
            ascii_text(title.document_number, 10),
            title.due_date.strftime("%d%m%y"),
            numeric(title.amount, 13),
            numeric(c.bank_code, 3),
            numeric(c.branch, 5),
            self.layout.species_code[:2].ljust(2, "0"),
            self.layout.acceptance[:1],
            self.generation_date.strftime("%d%m%y"),
            self.layout.instruction_1[:2].ljust(2, "0"),
            self.layout.instruction_2[:2].ljust(2, "0"),
            "0" * 13,
            "0" * 6,
            "0" * 13,
            "0" * 13,
            payer_type,
            numeric(payer_digits, 14),
            ascii_text(title.payer_name, 40),
            ascii_text(title.payer_address, 40),
            " " * 12,
            numeric(title.payer_zip_code, 8),
            ascii_text(title.payer_city, 15),
            ascii_text(title.payer_state, 2),
            " " * 34,
            numeric(sequence, 6),
        )

    def trailer(self, sequence: int) -> str:
        return record400("9", " " * 393, numeric(sequence, 6))

    def generate(self, titles: list[CNABTitle]) -> bytes:
        lines = [self.header()]
        sequence = 2
        for title in titles:
            lines.append(self.detail(title, sequence))
            sequence += 1
        lines.append(self.trailer(sequence))
        if any(len(line) != 400 for line in lines):
            raise ValueError("CNAB inválido: todos os registros devem ter 400 posições.")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")


class CNAB400ReturnParser:
    """Parser defensivo de retorno CNAB 400.

    O CNAB 400 varia por banco. Este parser cobre as posições mais comuns
    usadas em cobrança e normaliza os dados para o mesmo contrato do CNAB 240.
    Um adapter bancário pode especializar as posições sem alterar o lifecycle
    de importação, conciliação e liquidação da plataforma.
    """

    OCCURRENCES: dict[str, str] = {
        "02": "Entrada confirmada",
        "03": "Entrada rejeitada",
        "06": "Liquidação",
        "09": "Baixa",
        "10": "Baixa solicitada",
        "14": "Vencimento alterado",
        "15": "Liquidação em cartório",
        "17": "Liquidação após baixa",
        "19": "Confirmação de protesto",
        "23": "Entrada em cartório",
        "28": "Tarifa",
        "30": "Alteração rejeitada",
    }

    @staticmethod
    def _decimal(raw: str) -> Decimal | None:
        digits = "".join(ch for ch in raw if ch.isdigit())
        if not digits:
            return None
        return Decimal(int(digits)) / Decimal("100")

    @staticmethod
    def _date(raw: str) -> date | None:
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) != 6 or digits == "000000":
            return None
        try:
            year = int(digits[4:6])
            year += 2000 if year < 80 else 1900
            return date(year, int(digits[2:4]), int(digits[0:2]))
        except ValueError:
            return None

    @staticmethod
    def _normalize_identifier(value: str) -> str:
        normalized = value.strip()
        if normalized.isdigit():
            return normalized.lstrip("0") or "0"
        return normalized

    def parse(self, content: bytes) -> list[dict[str, object]]:
        text = content.decode("latin-1")
        lines = [line.rstrip("\r\n") for line in text.splitlines() if line.strip()]
        if not lines:
            raise ValueError("Arquivo de retorno CNAB 400 vazio.")
        invalid = [index + 1 for index, line in enumerate(lines) if len(line) != 400]
        if invalid:
            raise ValueError(
                "Arquivo de retorno CNAB 400 possui registro com tamanho inválido "
                f"nas linhas: {invalid[:20]}."
            )

        events: list[dict[str, object]] = []
        for line in lines:
            if line[0:1] != "1":
                continue
            occurrence_code = line[108:110]
            our_number = line[62:73].strip()
            document_number = line[116:126].strip()
            event = {
                "sequence": line[394:400],
                "occurrence_code": occurrence_code,
                "occurrence_description": self.OCCURRENCES.get(
                    occurrence_code, f"Ocorrência {occurrence_code}"
                ),
                "our_number": our_number,
                "our_number_normalized": self._normalize_identifier(our_number),
                "document_number": document_number,
                "document_number_normalized": self._normalize_identifier(document_number),
                "occurrence_date": self._date(line[110:116]),
                "due_date": self._date(line[146:152]),
                "title_amount": self._decimal(line[152:165]),
                "amount": self._decimal(line[253:266]),
                "net_amount": self._decimal(line[253:266]),
                "credit_date": self._date(line[295:301]),
                "raw": line,
            }
            # Alguns bancos retornam o valor liquidado na posição comum do
            # valor do título. Preserve um fallback determinístico.
            if event["amount"] in {None, Decimal("0")} and occurrence_code in {"06", "15", "17"}:
                event["amount"] = event["title_amount"]
                event["net_amount"] = event["title_amount"]
            events.append(event)
        return events
