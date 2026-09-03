from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
import unicodedata
from typing import Any

from app.providers.cnab.cnab240 import CNABCompany, CNABTitle


def _digits(value: object) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _num(value: object, length: int, field: str) -> str:
    raw = _digits(value)
    if len(raw) > length:
        raise ValueError(f"{field} excede {length} posições numéricas no CNAB C6.")
    return raw.rjust(length, "0")


def _money(value: Decimal, length: int, field: str) -> str:
    if value < 0:
        raise ValueError(f"{field} não pode ser negativo no CNAB C6.")
    raw = str(int(value * Decimal("100")))
    if len(raw) > length:
        raise ValueError(f"{field} excede {length} posições no CNAB C6.")
    return raw.rjust(length, "0")


def _alpha(value: object, length: int, field: str, *, truncate: bool = False) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    normalized = " ".join(normalized.upper().split())
    if len(normalized) > length:
        if not truncate:
            raise ValueError(f"{field} excede {length} posições no CNAB C6.")
        normalized = normalized[:length]
    return normalized.ljust(length)


def _ddmmyy(value: date) -> str:
    return value.strftime("%d%m%y")


def _date6(raw: str) -> date | None:
    digits = _digits(raw)
    if len(digits) != 6 or digits == "000000":
        return None
    try:
        year = int(digits[4:6])
        year += 2000 if year < 80 else 1900
        return date(year, int(digits[2:4]), int(digits[0:2]))
    except ValueError:
        return None


def _decimal(raw: str) -> Decimal | None:
    digits = _digits(raw)
    if not digits:
        return None
    return Decimal(int(digits)) / Decimal("100")


def _normalize_identifier(value: str) -> str:
    normalized = value.strip()
    if normalized.isdigit():
        return normalized.lstrip("0") or "0"
    return normalized


def _record() -> list[str]:
    return [" "] * 400


def _put(buffer: list[str], start: int, end: int, value: str, field: str) -> None:
    length = end - start + 1
    if len(value) != length:
        raise ValueError(f"{field} deve ocupar exatamente {length} posições no CNAB C6.")
    buffer[start - 1 : end] = list(value)


@dataclass(frozen=True, slots=True)
class C6CNAB400Settings:
    beneficiary_code: str
    collection_account: str
    wallet: str
    species_code: str
    acceptance: str

    @classmethod
    def from_agreement(
        cls,
        wallet: str | None,
        settings: dict[str, Any] | None,
    ) -> "C6CNAB400Settings":
        data = dict(settings or {})
        missing: list[str] = []
        for key in ("beneficiary_code", "collection_account", "species_code", "acceptance"):
            if data.get(key) in (None, ""):
                missing.append(key)
        if not str(wallet or "").strip():
            missing.append("wallet")
        if missing:
            raise ValueError(
                "Configuração CNAB C6 incompleta. Informe no convênio: " + ", ".join(missing)
            )
        item = cls(
            beneficiary_code=_digits(data["beneficiary_code"]),
            collection_account=_digits(data["collection_account"]),
            wallet=str(wallet).strip(),
            species_code=str(data["species_code"]).strip().zfill(2),
            acceptance=str(data["acceptance"]).strip().upper(),
        )
        item.validate()
        return item

    def validate(self) -> None:
        if self.wallet != "10":
            raise ValueError(
                "A rc.29 implementa somente a Carteira 10 C6 (Cobrança Simples Emissão Banco). "
                "Carteira 20 exige Nosso Número/DV do cliente e permanece fora da capability efetiva."
            )
        if not self.beneficiary_code or len(self.beneficiary_code) > 12:
            raise ValueError("Código do Beneficiário C6 deve possuir até 12 dígitos.")
        if not self.collection_account or len(self.collection_account) > 12:
            raise ValueError("Conta Cobrança C6 deve possuir até 12 dígitos.")
        if self.species_code not in {
            "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
            "11", "12", "13", "15", "16", "17", "33", "99",
        }:
            raise ValueError("Espécie de título C6 não consta na Nota 2 do manual 2.7.")
        if self.acceptance not in {"A", "N"}:
            raise ValueError("Aceite C6 deve ser A ou N.")


class C6CNAB400Generator:
    """Cobrança C6 Bank — CNAB400, manual público v2.7 (jul/2025).

    Escopo rc.29: entrada de títulos (ocorrência 01), Carteira 10, emissão pelo
    banco, sem juros, desconto, multa, abatimento ou registro opcional tipo 2.
    Campos fora desse escopo não são simulados.
    """

    BANK_CODE = "336"

    def __init__(
        self,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        *,
        settings: C6CNAB400Settings,
    ) -> None:
        if _num(company.bank_code, 3, "Código do banco") != self.BANK_CODE:
            raise ValueError("C6CNAB400Generator exige código bancário 336.")
        tax_id = _digits(company.tax_id)
        if len(tax_id) != 14:
            raise ValueError("C6 Empresas exige CNPJ do beneficiário com 14 dígitos.")
        if sequence < 1 or sequence > 99_999_999:
            raise ValueError("Sequencial de remessa C6 deve estar entre 1 e 99999999.")
        self.company = company
        self.sequence = sequence
        self.generation_date = generation_date
        self.settings = settings

    def header(self) -> str:
        b = _record()
        _put(b, 1, 1, "0", "Tipo de registro")
        _put(b, 2, 2, "1", "Código de remessa")
        _put(b, 3, 9, "REMESSA", "Literal remessa")
        _put(b, 10, 11, "01", "Código do serviço")
        _put(b, 12, 19, "COBRANCA", "Literal do serviço")
        _put(b, 20, 26, " " * 7, "Uso do banco")
        _put(b, 27, 38, _num(self.settings.beneficiary_code, 12, "Código do Beneficiário"), "Código do Beneficiário")
        _put(b, 39, 46, " " * 8, "Uso do banco")
        _put(b, 47, 76, _alpha(self.company.name, 30, "Nome do Beneficiário", truncate=True), "Nome do Beneficiário")
        _put(b, 77, 79, self.BANK_CODE, "Código do banco")
        _put(b, 80, 94, " " * 15, "Uso do banco")
        _put(b, 95, 100, _ddmmyy(self.generation_date), "Data de gravação")
        _put(b, 101, 108, " " * 8, "Uso do banco")
        _put(b, 109, 120, _num(self.settings.collection_account, 12, "Conta Cobrança"), "Conta Cobrança")
        _put(b, 121, 386, " " * 266, "Uso do banco")
        _put(b, 387, 394, _num(self.sequence, 8, "Sequencial da remessa"), "Sequencial da remessa")
        _put(b, 395, 400, "000001", "Sequencial do registro")
        return "".join(b)

    def detail(self, title: CNABTitle, record_sequence: int) -> str:
        payer_digits = _digits(title.payer_tax_id)
        if len(payer_digits) == 11:
            payer_type = "01"
        elif len(payer_digits) == 14:
            payer_type = "02"
        else:
            raise ValueError("CPF/CNPJ do pagador C6 deve possuir 11 ou 14 dígitos.")
        zip_code = _digits(title.payer_zip_code)
        if len(zip_code) != 8:
            raise ValueError("CEP do pagador C6 é obrigatório e deve possuir 8 dígitos.")
        state = str(title.payer_state or "").strip().upper()
        if len(state) != 2:
            raise ValueError("UF do pagador C6 é obrigatória e deve possuir 2 caracteres.")
        if not str(title.payer_name or "").strip() or not str(title.payer_address or "").strip():
            raise ValueError("Nome e endereço do pagador são obrigatórios no CNAB C6.")
        if not str(title.payer_city or "").strip():
            raise ValueError("Cidade do pagador é obrigatória no CNAB C6.")
        document_control = _alpha(title.document_number, 25, "Uso Exclusivo do Beneficiário")
        company_control = _alpha(str(title.document_number)[-10:], 10, "Seu Número do Título")
        issue_date = title.issue_date or self.generation_date

        b = _record()
        _put(b, 1, 1, "1", "Tipo de registro")
        _put(b, 2, 3, "02", "Tipo de inscrição")
        _put(b, 4, 17, _num(self.company.tax_id, 14, "CNPJ do Beneficiário"), "CNPJ do Beneficiário")
        _put(b, 18, 29, _num(self.settings.beneficiary_code, 12, "Código do Beneficiário"), "Código do Beneficiário")
        _put(b, 30, 37, " " * 8, "Uso do banco")
        _put(b, 38, 62, document_control, "Uso Exclusivo do Beneficiário")
        _put(b, 63, 73, " " * 11, "Nosso Número")
        _put(b, 74, 74, " ", "Dígito do Nosso Número")
        _put(b, 75, 82, " " * 8, "Uso do banco")
        _put(b, 83, 85, self.BANK_CODE, "Código do banco")
        _put(b, 86, 106, " " * 21, "Uso do banco")
        _put(b, 107, 108, self.settings.wallet, "Carteira")
        _put(b, 109, 110, "01", "Código de ocorrência")
        _put(b, 111, 120, company_control, "Seu Número do Título")
        _put(b, 121, 126, _ddmmyy(title.due_date), "Data de vencimento")
        _put(b, 127, 139, _money(title.amount, 13, "Valor do título"), "Valor do título")
        _put(b, 140, 147, " " * 8, "Uso do banco")
        _put(b, 148, 149, self.settings.species_code, "Espécie do título")
        _put(b, 150, 150, self.settings.acceptance, "Aceite")
        _put(b, 151, 156, _ddmmyy(issue_date), "Data de emissão")
        _put(b, 157, 158, "00", "Instrução 1")
        _put(b, 159, 160, "00", "Instrução 2")
        _put(b, 161, 173, "0" * 13, "Juros ao dia")
        _put(b, 174, 179, "0" * 6, "Data desconto")
        _put(b, 180, 192, "0" * 13, "Valor desconto")
        _put(b, 193, 198, "0" * 6, "Data multa")
        _put(b, 199, 205, " " * 7, "Uso do banco")
        _put(b, 206, 218, "0" * 13, "Abatimento")
        _put(b, 219, 220, payer_type, "Tipo do pagador")
        _put(b, 221, 234, _num(payer_digits, 14, "CPF/CNPJ do pagador"), "CPF/CNPJ do pagador")
        _put(b, 235, 274, _alpha(title.payer_name, 40, "Nome do pagador", truncate=True), "Nome do pagador")
        _put(b, 275, 314, _alpha(title.payer_address, 40, "Endereço do pagador", truncate=True), "Endereço do pagador")
        _put(b, 315, 326, " " * 12, "Bairro do pagador")
        _put(b, 327, 334, zip_code, "CEP do pagador")
        _put(b, 335, 349, _alpha(title.payer_city, 15, "Cidade do pagador", truncate=True), "Cidade do pagador")
        _put(b, 350, 351, state, "UF do pagador")
        _put(b, 352, 381, " " * 30, "Beneficiário final/mensagem")
        _put(b, 382, 382, "0", "Indicador de multa")
        _put(b, 383, 384, "00", "Percentual de multa")
        _put(b, 385, 385, " ", "Uso do banco")
        _put(b, 386, 391, "0" * 6, "Data dos juros")
        _put(b, 392, 393, " " * 2, "Uso do banco")
        _put(b, 394, 394, " ", "Uso do banco")
        _put(b, 395, 400, _num(record_sequence, 6, "Sequencial do registro"), "Sequencial do registro")
        return "".join(b)

    @staticmethod
    def trailer(record_sequence: int) -> str:
        b = _record()
        _put(b, 1, 1, "9", "Tipo de registro")
        _put(b, 2, 394, " " * 393, "Uso do banco")
        _put(b, 395, 400, _num(record_sequence, 6, "Sequencial do registro"), "Sequencial do registro")
        return "".join(b)

    def generate(self, titles: list[CNABTitle]) -> bytes:
        if not titles:
            raise ValueError("Remessa C6 precisa conter ao menos um título.")
        lines = [self.header()]
        record_sequence = 2
        for title in titles:
            lines.append(self.detail(title, record_sequence))
            record_sequence += 1
        lines.append(self.trailer(record_sequence))
        if any(len(line) != 400 for line in lines):
            raise ValueError("CNAB C6 inválido: todos os registros devem possuir 400 posições.")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")


class C6CNAB400ReturnParser:
    OCCURRENCES: dict[str, str] = {
        "02": "Entrada confirmada",
        "03": "Entrada rejeitada",
        "04": "Alteração de dados (entrada)",
        "05": "Alteração de dados (baixa)",
        "06": "Liquidação do título",
        "07": "Liquidação do título após a baixa",
        "08": "Título liquidado em cartório",
        "09": "Baixa do título",
        "10": "Baixa realizada pelo beneficiário via arquivo",
        "12": "Abatimento concedido",
        "13": "Abatimento cancelado",
        "14": "Vencimento alterado",
        "15": "Baixa rejeitada",
        "16": "Instrução rejeitada",
        "17": "Alteração de dados rejeitada",
        "19": "Confirma instrução de protesto",
        "20": "Confirma sustação de protesto",
        "21": "Confirma não protestar",
        "23": "Protesto enviado a cartório",
        "32": "Baixa por protesto",
        "69": "Cancelamento de liquidação por cheque devolvido",
        "71": "Título cancelado pelo cartório",
        "72": "Baixa operacional",
        "74": "Cancelamento da baixa operacional",
        "75": "Pagamento parcial",
        "90": "Instrução de protesto rejeitada",
        "95": "Troca uso empresa",
        "96": "Extrato de movimentação da carteira",
        "97": "Tarifa de sustação de protesto",
        "98": "Tarifa de protesto",
        "99": "Custas de protesto",
    }

    def parse(self, content: bytes) -> list[dict[str, object]]:
        lines = [line.rstrip("\r\n") for line in content.decode("latin-1").splitlines() if line.strip()]
        if not lines:
            raise ValueError("Arquivo de retorno C6 vazio.")
        invalid = [index + 1 for index, line in enumerate(lines) if len(line) != 400]
        if invalid:
            raise ValueError(f"Retorno C6 possui registro fora de 400 posições: {invalid[:20]}.")
        header = lines[0]
        if header[0:1] != "0" or header[76:79] != self.BANK_CODE:
            raise ValueError("Arquivo informado não é um retorno de Cobrança C6 (336).")

        events: list[dict[str, object]] = []
        for line in lines:
            if line[0:1] != "1":
                continue
            occurrence = line[108:110]
            our_number = line[62:73].strip()
            document_number = line[37:62].strip() or line[116:126].strip()
            title_amount = _decimal(line[152:165])
            paid_amount = _decimal(line[253:266])
            if paid_amount in {None, Decimal("0")} and occurrence in {"06", "07", "08", "75"}:
                paid_amount = title_amount
            events.append(
                {
                    "sequence": line[394:400],
                    "provider": "C6",
                    "bank_code": self.BANK_CODE,
                    "occurrence_code": occurrence,
                    "occurrence_description": self.OCCURRENCES.get(occurrence, f"Ocorrência {occurrence}"),
                    "our_number": our_number,
                    "our_number_normalized": _normalize_identifier(our_number),
                    "document_number": document_number,
                    "document_number_normalized": _normalize_identifier(document_number),
                    "occurrence_date": _date6(line[110:116]),
                    "due_date": _date6(line[146:152]),
                    "title_amount": title_amount,
                    "amount": paid_amount,
                    "net_amount": paid_amount,
                    "credit_date": _date6(line[295:301]),
                    "rejection_fields": line[365:377].strip(),
                    "rejection_code": line[377:393].strip(),
                    "raw": line,
                }
            )
        return events

    BANK_CODE = "336"
