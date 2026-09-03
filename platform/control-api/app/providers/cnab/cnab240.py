from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
import unicodedata


def ascii_text(value: str, length: int, align: str = "left", fill: str = " ") -> str:
    normalized = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    normalized = " ".join(normalized.upper().split())[:length]
    return normalized.rjust(length, fill) if align == "right" else normalized.ljust(length, fill)


def numeric(value: str | int | Decimal, length: int) -> str:
    if isinstance(value, Decimal):
        raw = str(int(value * 100))
    else:
        raw = "".join(ch for ch in str(value) if ch.isdigit())
    return raw[-length:].rjust(length, "0")


def ddmmyyyy(value: date) -> str:
    return value.strftime("%d%m%Y")


def record(*parts: str) -> str:
    value = "".join(parts)
    if len(value) > 240:
        raise ValueError(f"Registro CNAB maior que 240 posições: {len(value)}")
    return value.ljust(240)


@dataclass(frozen=True, slots=True)
class CNABTitle:
    document_number: str
    our_number: str
    due_date: date
    amount: Decimal
    payer_name: str
    payer_tax_id: str
    payer_address: str = ""
    payer_zip_code: str = ""
    payer_city: str = ""
    payer_state: str = ""
    issue_date: date | None = None


@dataclass(frozen=True, slots=True)
class CNABCompany:
    bank_code: str
    tax_id: str
    name: str
    agreement: str
    branch: str
    branch_digit: str
    account: str
    account_digit: str


class CNAB240Generator:
    """Núcleo CNAB 240 extensível.

    Os registros respeitam 240 posições e a estrutura FEBRABAN de arquivo/lote,
    mas cada banco exige homologação de campos, códigos de ocorrência e carteira.
    Adapters bancários devem especializar os métodos de segmento.
    """

    def __init__(self, company: CNABCompany, sequence: int, generation_date: date) -> None:
        self.company = company
        self.sequence = sequence
        self.generation_date = generation_date

    def file_header(self) -> str:
        c = self.company
        return record(
            numeric(c.bank_code, 3), "0000", "0", " " * 9, "2", numeric(c.tax_id, 14),
            ascii_text(c.agreement, 20), numeric(c.branch, 5), ascii_text(c.branch_digit, 1),
            numeric(c.account, 12), ascii_text(c.account_digit, 1), " ", ascii_text(c.name, 30),
            ascii_text("BANCO", 30), " " * 10, "1", ddmmyyyy(self.generation_date), "000000",
            numeric(self.sequence, 6), "103", "00000", " " * 20,
        )

    def lot_header(self) -> str:
        c = self.company
        return record(
            numeric(c.bank_code, 3), "0001", "1", "R", "01", "00", "030", " ", "2",
            numeric(c.tax_id, 15), ascii_text(c.agreement, 20), numeric(c.branch, 5),
            ascii_text(c.branch_digit, 1), numeric(c.account, 12), ascii_text(c.account_digit, 1),
            " ", ascii_text(c.name, 30), " " * 40, ascii_text("COBRANCA", 40),
        )

    def segment_p(self, title: CNABTitle, sequence: int) -> str:
        c = self.company
        return record(
            numeric(c.bank_code, 3), "0001", "3", numeric(sequence, 5), "P", " ", "01",
            numeric(c.branch, 5), ascii_text(c.branch_digit, 1), numeric(c.account, 12),
            ascii_text(c.account_digit, 1), " ", ascii_text(title.our_number, 20), "1", "1", "1", "2", "2",
            ascii_text(title.document_number, 15), ddmmyyyy(title.due_date), numeric(title.amount, 15),
            "00000", " ", "01", ddmmyyyy(title.issue_date or self.generation_date), "0", "00000000", numeric(0, 15),
            "0", "00000000", numeric(0, 15), numeric(0, 15), ascii_text(title.document_number, 25),
            "3", "00000000", "000000000000000", " " * 11,
        )

    def segment_q(self, title: CNABTitle, sequence: int) -> str:
        payer_type = "1" if len("".join(ch for ch in title.payer_tax_id if ch.isdigit())) <= 11 else "2"
        return record(
            numeric(self.company.bank_code, 3), "0001", "3", numeric(sequence, 5), "Q", " ", "01",
            payer_type, numeric(title.payer_tax_id, 15), ascii_text(title.payer_name, 40),
            ascii_text(title.payer_address, 40), "00000", "000", numeric(title.payer_zip_code, 8),
            ascii_text(title.payer_city, 15), ascii_text(title.payer_state, 2), "0", "0" * 15,
            ascii_text("", 40), "000", " " * 20,
        )

    def lot_trailer(self, title_count: int, total: Decimal) -> str:
        record_count = 2 + title_count * 2 + 1
        return record(
            numeric(self.company.bank_code, 3), "0001", "5", " " * 9,
            numeric(record_count, 6), numeric(title_count, 6), numeric(total, 17), "0" * 6, "0" * 17,
            "0" * 6, "0" * 17, "0" * 6, "0" * 17, " " * 8, " " * 117,
        )

    def file_trailer(self, record_count: int) -> str:
        return record(
            numeric(self.company.bank_code, 3), "9999", "9", " " * 9, "000001",
            numeric(record_count, 6), "000000", " " * 205,
        )

    def generate(self, titles: list[CNABTitle]) -> bytes:
        lines = [self.file_header(), self.lot_header()]
        seq = 1
        for title in titles:
            lines.append(self.segment_p(title, seq)); seq += 1
            lines.append(self.segment_q(title, seq)); seq += 1
        total = sum((item.amount for item in titles), Decimal("0"))
        lines.append(self.lot_trailer(len(titles), total))
        lines.append(self.file_trailer(len(lines) + 1))
        if any(len(line) != 240 for line in lines):
            raise ValueError("CNAB inválido: todos os registros devem ter 240 posições.")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")


class CNAB240ReturnParser:
    """Parser estrutural do retorno CNAB 240.

    Consolida os segmentos T e U em um único evento. O layout base segue as
    posições FEBRABAN; descrições e efeitos específicos continuam delegados ao
    adapter de cada banco/carteira.
    """

    OCCURRENCES: dict[str, str] = {
        "02": "Entrada confirmada",
        "03": "Entrada rejeitada",
        "06": "Liquidação",
        "09": "Baixa",
        "10": "Baixa solicitada",
        "11": "Título em carteira",
        "12": "Abatimento concedido",
        "13": "Abatimento cancelado",
        "14": "Vencimento alterado",
        "15": "Liquidação em cartório",
        "17": "Liquidação após baixa",
        "19": "Confirmação de instrução de protesto",
        "20": "Confirmação de sustação de protesto",
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
        if len(digits) != 8 or digits == "00000000":
            return None
        try:
            return date(int(digits[4:8]), int(digits[2:4]), int(digits[0:2]))
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
            raise ValueError("Arquivo de retorno CNAB 240 vazio.")
        invalid = [index + 1 for index, line in enumerate(lines) if len(line) != 240]
        if invalid:
            raise ValueError(
                "Arquivo de retorno CNAB 240 possui registro com tamanho inválido "
                f"nas linhas: {invalid[:20]}."
            )

        by_sequence: dict[str, dict[str, object]] = {}
        ordered: list[str] = []
        pending_t_sequence: str | None = None
        for line in lines:
            if line[7:8] != "3":
                continue
            segment = line[13:14]
            sequence = line[8:13]
            occurrence_code = line[15:17]
            if segment == "T":
                event: dict[str, object] = {
                    "sequence": sequence,
                    "occurrence_code": occurrence_code,
                    "occurrence_description": self.OCCURRENCES.get(
                        occurrence_code, f"Ocorrência {occurrence_code}"
                    ),
                    "our_number": line[37:57].strip(),
                    "our_number_normalized": self._normalize_identifier(line[37:57]),
                    "document_number": line[58:73].strip(),
                    "document_number_normalized": self._normalize_identifier(line[58:73]),
                    "due_date": self._date(line[73:81]),
                    "title_amount": self._decimal(line[81:96]),
                    "payer_tax_id": line[132:147].strip(),
                    "payer_name": line[147:187].strip(),
                    "amount": None,
                    "net_amount": None,
                    "occurrence_date": None,
                    "credit_date": None,
                    "segments": {"T": line},
                }
                by_sequence[sequence] = event
                ordered.append(sequence)
                pending_t_sequence = sequence
            elif segment == "U":
                target_sequence = pending_t_sequence
                event = by_sequence.get(target_sequence or "")
                if event is None:
                    target_sequence = sequence
                    event = {
                        "sequence": sequence,
                        "occurrence_code": occurrence_code,
                        "occurrence_description": self.OCCURRENCES.get(
                            occurrence_code, f"Ocorrência {occurrence_code}"
                        ),
                        "our_number": "",
                        "our_number_normalized": "",
                        "document_number": "",
                        "document_number_normalized": "",
                        "due_date": None,
                        "title_amount": None,
                        "payer_tax_id": "",
                        "payer_name": "",
                        "segments": {},
                    }
                    by_sequence[target_sequence] = event
                    ordered.append(target_sequence)
                event["occurrence_code"] = occurrence_code or event.get("occurrence_code")
                event["occurrence_description"] = self.OCCURRENCES.get(
                    str(event["occurrence_code"]), f"Ocorrência {event['occurrence_code']}"
                )
                event["interest_amount"] = self._decimal(line[17:32])
                event["discount_amount"] = self._decimal(line[32:47])
                event["abatement_amount"] = self._decimal(line[47:62])
                event["iof_amount"] = self._decimal(line[62:77])
                event["amount"] = self._decimal(line[77:92])
                event["net_amount"] = self._decimal(line[92:107])
                event["occurrence_date"] = self._date(line[137:145])
                event["credit_date"] = self._date(line[145:153])
                segments = dict(event.get("segments") or {})
                segments["U"] = line
                event["segments"] = segments
                pending_t_sequence = None

        return [by_sequence[key] for key in ordered]
