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
        raise ValueError(f"{field} excede {length} posições numéricas no CNAB240 Itaú.")
    return raw.rjust(length, "0")


def _money(value: Decimal, length: int, field: str) -> str:
    if value < 0:
        raise ValueError(f"{field} não pode ser negativo no CNAB240 Itaú.")
    raw = str(int(value * Decimal("100")))
    if len(raw) > length:
        raise ValueError(f"{field} excede {length} posições no CNAB240 Itaú.")
    return raw.rjust(length, "0")


def _alpha(value: object, length: int, field: str, *, truncate: bool = False) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    normalized = " ".join(normalized.upper().split())
    if len(normalized) > length:
        if not truncate:
            raise ValueError(f"{field} excede {length} posições no CNAB240 Itaú.")
        normalized = normalized[:length]
    return normalized.ljust(length)


def _company_document_number(value: object) -> str:
    """Mapeia o identificador interno para o campo Itaú de 10 posições.

    O sistema usa documentos no formato ``REC-AAAAmm-<controle>``. O banco não
    deve receber os separadores/prefixos internos quando o controle final já é
    o identificador da empresa. Não há cálculo de Nosso Número neste helper.
    """
    token = str(value or "").strip().rsplit("-", 1)[-1]
    return _alpha(token, 10, "Número documento")


def _record() -> list[str]:
    return [" "] * 240


def _put(buffer: list[str], start: int, end: int, value: str, field: str) -> None:
    length = end - start + 1
    if len(value) != length:
        raise ValueError(f"{field} deve ocupar exatamente {length} posições no CNAB240 Itaú.")
    buffer[start - 1 : end] = list(value)


def _date8(value: date) -> str:
    return value.strftime("%d%m%Y")


def _parse_date8(raw: str) -> date | None:
    digits = _digits(raw)
    if len(digits) != 8 or digits == "00000000":
        return None
    try:
        return date(int(digits[4:8]), int(digits[2:4]), int(digits[0:2]))
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


@dataclass(frozen=True, slots=True)
class ItauCNAB240Settings:
    wallet: str
    species_code: str
    acceptance: str

    @classmethod
    def from_agreement(cls, wallet: str | None, settings: dict[str, Any] | None) -> "ItauCNAB240Settings":
        data = dict(settings or {})
        wallet_value = _digits(wallet)
        species = _digits(data.get("species_code"))
        acceptance = str(data.get("acceptance") or "").strip().upper()
        missing = []
        if not wallet_value:
            missing.append("wallet")
        if not species:
            missing.append("species_code")
        if not acceptance:
            missing.append("acceptance")
        if missing:
            raise ValueError("Configuração CNAB240 Itaú incompleta. Informe: " + ", ".join(missing))
        item = cls(wallet=wallet_value.zfill(3), species_code=species.zfill(2), acceptance=acceptance)
        item.validate()
        return item

    def validate(self) -> None:
        if self.wallet not in {"112", "212"}:
            raise ValueError(
                "A rc.29 implementa apenas carteiras Itaú 112 e 212, escriturais eletrônicas simples/contratuais."
            )
        if self.species_code not in {
            "01", "02", "03", "04", "05", "06", "07", "08", "09", "13", "15", "16", "17", "99",
        }:
            raise ValueError("Espécie de título Itaú não consta na Nota 11 do manual oficial.")
        if self.acceptance not in {"A", "N"}:
            raise ValueError("Aceite Itaú deve ser A ou N.")


class ItauCNAB240Generator:
    BANK_CODE = "341"
    FILE_LAYOUT = "040"
    LOT_LAYOUT = "030"

    def __init__(
        self,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        *,
        settings: ItauCNAB240Settings,
        generation_time: str = "000000",
    ) -> None:
        if _num(company.bank_code, 3, "Código do banco") != self.BANK_CODE:
            raise ValueError("ItauCNAB240Generator exige código bancário 341.")
        tax = _digits(company.tax_id)
        if len(tax) not in {11, 14}:
            raise ValueError("CPF/CNPJ do beneficiário Itaú deve possuir 11 ou 14 dígitos.")
        if len(_digits(company.branch)) > 4 or len(_digits(company.account)) > 5:
            raise ValueError("Agência Itaú aceita 4 dígitos e conta corrente 5 dígitos neste layout.")
        dac = _digits(company.account_digit)
        if len(dac) != 1:
            raise ValueError("DAC agência/conta Itaú deve possuir 1 dígito em account_digit.")
        time_digits = _digits(generation_time)
        if len(time_digits) != 6:
            raise ValueError("generation_time Itaú deve usar HHMMSS com 6 dígitos.")
        self.company = company
        self.sequence = sequence
        self.generation_date = generation_date
        self.settings = settings
        self.generation_time = time_digits

    @staticmethod
    def _tax_type(value: object) -> str:
        size = len(_digits(value))
        if size == 11:
            return "1"
        if size == 14:
            return "2"
        raise ValueError("CPF/CNPJ deve possuir 11 ou 14 dígitos no CNAB240 Itaú.")

    def file_header(self) -> str:
        c = self.company
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0000", "Lote")
        _put(b, 8, 8, "0", "Tipo registro")
        _put(b, 9, 17, " " * 9, "Complemento")
        _put(b, 18, 18, self._tax_type(c.tax_id), "Tipo inscrição")
        _put(b, 19, 32, _num(c.tax_id, 14, "CPF/CNPJ"), "CPF/CNPJ")
        _put(b, 33, 52, " " * 20, "Complemento")
        _put(b, 53, 53, "0", "Complemento")
        _put(b, 54, 57, _num(c.branch, 4, "Agência"), "Agência")
        _put(b, 58, 58, " ", "Complemento")
        _put(b, 59, 65, "0000000", "Complemento")
        _put(b, 66, 70, _num(c.account, 5, "Conta"), "Conta")
        _put(b, 71, 71, " ", "Complemento")
        _put(b, 72, 72, _num(c.account_digit, 1, "DAC"), "DAC")
        _put(b, 73, 102, _alpha(c.name, 30, "Nome empresa", truncate=True), "Nome empresa")
        _put(b, 103, 132, _alpha("BANCO ITAU SA", 30, "Nome banco"), "Nome banco")
        _put(b, 133, 142, " " * 10, "Complemento")
        _put(b, 143, 143, "1", "Código arquivo")
        _put(b, 144, 151, _date8(self.generation_date), "Data geração")
        _put(b, 152, 157, self.generation_time, "Hora geração")
        _put(b, 158, 163, "000000", "Sequencial retorno")
        _put(b, 164, 166, self.FILE_LAYOUT, "Layout arquivo")
        _put(b, 167, 171, "00000", "Complemento")
        _put(b, 172, 225, " " * 54, "Complemento")
        _put(b, 226, 228, "000", "Complemento")
        _put(b, 229, 240, " " * 12, "Complemento")
        return "".join(b)

    def lot_header(self) -> str:
        c = self.company
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "1", "Tipo registro")
        _put(b, 9, 9, "R", "Operação")
        _put(b, 10, 11, "01", "Serviço")
        _put(b, 12, 13, "00", "Complemento")
        _put(b, 14, 16, self.LOT_LAYOUT, "Layout lote")
        _put(b, 17, 17, " ", "Complemento")
        _put(b, 18, 18, self._tax_type(c.tax_id), "Tipo inscrição")
        _put(b, 19, 33, _num(c.tax_id, 15, "CPF/CNPJ"), "CPF/CNPJ")
        _put(b, 34, 53, " " * 20, "Complemento")
        _put(b, 54, 54, "0", "Complemento")
        _put(b, 55, 58, _num(c.branch, 4, "Agência"), "Agência")
        _put(b, 59, 59, " ", "Complemento")
        _put(b, 60, 66, "0000000", "Complemento")
        _put(b, 67, 71, _num(c.account, 5, "Conta"), "Conta")
        _put(b, 72, 72, " ", "Complemento")
        _put(b, 73, 73, _num(c.account_digit, 1, "DAC"), "DAC")
        _put(b, 74, 103, _alpha(c.name, 30, "Nome empresa", truncate=True), "Nome empresa")
        _put(b, 104, 183, " " * 80, "Complemento")
        _put(b, 184, 191, "00000000", "Sequencial retorno")
        _put(b, 192, 199, _date8(self.generation_date), "Data gravação")
        _put(b, 200, 207, "00000000", "Data crédito")
        _put(b, 208, 240, " " * 33, "Complemento")
        return "".join(b)

    def segment_p(self, title: CNABTitle, sequence: int) -> str:
        c = self.company
        document = _company_document_number(title.document_number)
        control = _alpha(title.document_number, 25, "Uso empresa")
        issue = title.issue_date or self.generation_date
        if issue > title.due_date:
            raise ValueError("Data de emissão Itaú não pode ser posterior ao vencimento.")
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "3", "Tipo registro")
        _put(b, 9, 13, _num(sequence, 5, "Sequencial lote"), "Sequencial lote")
        _put(b, 14, 14, "P", "Segmento")
        _put(b, 15, 15, " ", "Complemento")
        _put(b, 16, 17, "01", "Ocorrência")
        _put(b, 18, 18, "0", "Complemento")
        _put(b, 19, 22, _num(c.branch, 4, "Agência"), "Agência")
        _put(b, 23, 23, " ", "Complemento")
        _put(b, 24, 30, "0000000", "Complemento")
        _put(b, 31, 35, _num(c.account, 5, "Conta"), "Conta")
        _put(b, 36, 36, " ", "Complemento")
        _put(b, 37, 37, _num(c.account_digit, 1, "DAC"), "DAC")
        _put(b, 38, 40, self.settings.wallet, "Carteira")
        _put(b, 41, 48, "00000000", "Nosso Número")
        _put(b, 49, 49, "0", "DAC Nosso Número")
        _put(b, 50, 57, " " * 8, "Complemento")
        _put(b, 58, 62, "00000", "Complemento")
        _put(b, 63, 72, document, "Documento")
        _put(b, 73, 77, " " * 5, "Complemento")
        _put(b, 78, 85, _date8(title.due_date), "Vencimento")
        _put(b, 86, 100, _money(title.amount, 15, "Valor título"), "Valor título")
        _put(b, 101, 105, "00000", "Agência cobradora")
        _put(b, 106, 106, "0", "DAC agência cobradora")
        _put(b, 107, 108, self.settings.species_code, "Espécie")
        _put(b, 109, 109, self.settings.acceptance, "Aceite")
        _put(b, 110, 117, _date8(issue), "Data emissão")
        _put(b, 118, 118, "0", "Complemento")
        _put(b, 119, 126, "00000000", "Data juros")
        _put(b, 127, 141, "0" * 15, "Juros")
        _put(b, 142, 142, "0", "Complemento")
        _put(b, 143, 150, "00000000", "Data desconto")
        _put(b, 151, 165, "0" * 15, "Desconto")
        _put(b, 166, 180, "0" * 15, "IOF")
        _put(b, 181, 195, "0" * 15, "Abatimento")
        _put(b, 196, 220, control, "Uso empresa")
        _put(b, 221, 221, "0", "Protesto/negativação")
        _put(b, 222, 223, "00", "Prazo protesto/negativação")
        _put(b, 224, 224, "0", "Código baixa")
        _put(b, 225, 226, "00", "Prazo baixa")
        _put(b, 227, 239, "0" * 13, "Complemento")
        _put(b, 240, 240, " ", "Complemento")
        return "".join(b)

    def segment_q(self, title: CNABTitle, sequence: int) -> str:
        tax = _digits(title.payer_tax_id)
        if len(tax) == 11:
            tax_type = "1"
        elif len(tax) == 14:
            tax_type = "2"
        else:
            raise ValueError("CPF/CNPJ pagador Itaú deve possuir 11 ou 14 dígitos.")
        zip_code = _digits(title.payer_zip_code)
        if len(zip_code) != 8:
            raise ValueError("CEP pagador Itaú deve possuir 8 dígitos.")
        state = str(title.payer_state or "").strip().upper()
        if len(state) != 2:
            raise ValueError("UF do pagador Itaú deve possuir 2 caracteres.")
        if not title.payer_name.strip() or not title.payer_address.strip() or not title.payer_city.strip():
            raise ValueError("Nome, endereço e cidade do pagador são obrigatórios no CNAB240 Itaú.")
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "3", "Tipo registro")
        _put(b, 9, 13, _num(sequence, 5, "Sequencial lote"), "Sequencial lote")
        _put(b, 14, 14, "Q", "Segmento")
        _put(b, 15, 15, " ", "Complemento")
        _put(b, 16, 17, "01", "Ocorrência")
        _put(b, 18, 18, tax_type, "Tipo inscrição pagador")
        _put(b, 19, 33, _num(tax, 15, "CPF/CNPJ pagador"), "CPF/CNPJ pagador")
        _put(b, 34, 63, _alpha(title.payer_name, 30, "Nome pagador", truncate=True), "Nome pagador")
        _put(b, 64, 73, " " * 10, "Complemento")
        _put(b, 74, 113, _alpha(title.payer_address, 40, "Logradouro", truncate=True), "Logradouro")
        _put(b, 114, 128, " " * 15, "Bairro")
        _put(b, 129, 133, zip_code[:5], "CEP")
        _put(b, 134, 136, zip_code[5:], "Sufixo CEP")
        _put(b, 137, 151, _alpha(title.payer_city, 15, "Cidade", truncate=True), "Cidade")
        _put(b, 152, 153, state, "UF")
        _put(b, 154, 154, "0", "Tipo sacador")
        _put(b, 155, 169, "0" * 15, "Inscrição sacador")
        _put(b, 170, 199, " " * 30, "Sacador")
        _put(b, 200, 209, " " * 10, "Complemento")
        _put(b, 210, 212, "000", "Complemento")
        _put(b, 213, 240, " " * 28, "Complemento")
        return "".join(b)

    def lot_trailer(self, title_count: int, total: Decimal) -> str:
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "5", "Tipo registro")
        _put(b, 9, 17, " " * 9, "Complemento")
        _put(b, 18, 23, _num(2 + title_count * 2, 6, "Registros lote"), "Registros lote")
        _put(b, 24, 29, _num(title_count, 6, "Qtd simples"), "Qtd simples")
        _put(b, 30, 46, _money(total, 17, "Total simples"), "Total simples")
        _put(b, 47, 52, "000000", "Qtd vinculada")
        _put(b, 53, 69, "0" * 17, "Total vinculada")
        _put(b, 70, 115, "0" * 46, "Complemento")
        _put(b, 116, 123, " " * 8, "Aviso bancário")
        _put(b, 124, 240, " " * 117, "Complemento")
        return "".join(b)

    def file_trailer(self, total_records: int) -> str:
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "9999", "Lote")
        _put(b, 8, 8, "9", "Tipo registro")
        _put(b, 9, 17, " " * 9, "Complemento")
        _put(b, 18, 23, "000001", "Total lotes")
        _put(b, 24, 29, _num(total_records, 6, "Total registros"), "Total registros")
        _put(b, 30, 35, "000000", "Complemento")
        _put(b, 36, 240, " " * 205, "Complemento")
        return "".join(b)

    def generate(self, titles: list[CNABTitle]) -> bytes:
        if not titles:
            raise ValueError("Remessa Itaú precisa conter ao menos um título.")
        lines = [self.file_header(), self.lot_header()]
        seq = 1
        for title in titles:
            lines.append(self.segment_p(title, seq)); seq += 1
            lines.append(self.segment_q(title, seq)); seq += 1
        total = sum((item.amount for item in titles), Decimal("0"))
        lines.append(self.lot_trailer(len(titles), total))
        lines.append(self.file_trailer(len(lines) + 1))
        if any(len(line) != 240 for line in lines):
            raise ValueError("CNAB240 Itaú inválido: todos os registros devem possuir 240 posições.")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")


class ItauCNAB240ReturnParser:
    BANK_CODE = "341"
    OCCURRENCES = {
        "02": "Entrada confirmada",
        "03": "Entrada rejeitada",
        "04": "Alteração de dados acatada",
        "05": "Alteração de dados - baixa",
        "06": "Liquidação normal",
        "08": "Liquidação em cartório",
        "09": "Baixa simples",
        "10": "Baixa por liquidação",
        "11": "Em ser",
        "12": "Abatimento concedido",
        "13": "Abatimento cancelado",
        "14": "Vencimento alterado",
        "15": "Baixa rejeitada",
        "16": "Instrução rejeitada",
        "17": "Alteração rejeitada",
        "18": "Alteração rejeitada",
        "25": "Alegação do pagador",
        "32": "Baixa por protesto",
        "74": "Negativação expressa rejeitada",
        "75": "Entrada em negativação recebida",
        "77": "Exclusão de negativação recebida",
        "78": "Cancelamento de negativação recebido",
    }

    def parse(self, content: bytes) -> list[dict[str, object]]:
        lines = [line.rstrip("\r\n") for line in content.decode("latin-1").splitlines() if line.strip()]
        if not lines:
            raise ValueError("Arquivo retorno CNAB240 Itaú vazio.")
        invalid = [i + 1 for i, line in enumerate(lines) if len(line) != 240]
        if invalid:
            raise ValueError(f"Retorno Itaú possui registro fora de 240 posições: {invalid[:20]}.")
        if lines[0][0:3] != self.BANK_CODE or lines[0][7:8] != "0":
            raise ValueError("Arquivo informado não é retorno CNAB240 Itaú (341).")
        events: list[dict[str, object]] = []
        pending: dict[str, object] | None = None
        for line in lines:
            if line[7:8] != "3":
                continue
            segment = line[13:14]
            if segment == "T":
                occurrence = line[15:17]
                our_number = line[40:48].strip()
                document = line[105:130].strip() or line[58:68].strip()
                pending = {
                    "sequence": line[8:13],
                    "provider": "ITAU",
                    "bank_code": self.BANK_CODE,
                    "occurrence_code": occurrence,
                    "occurrence_description": self.OCCURRENCES.get(occurrence, f"Ocorrência {occurrence}"),
                    "wallet": line[37:40].strip(),
                    "our_number": our_number,
                    "our_number_normalized": _normalize_identifier(our_number),
                    "document_number": document,
                    "document_number_normalized": _normalize_identifier(document),
                    "your_number": line[58:68].strip(),
                    "due_date": _parse_date8(line[73:81]),
                    "title_amount": _decimal(line[81:96]),
                    "payer_tax_id": line[133:148].strip(),
                    "payer_name": line[148:178].strip(),
                    "errors": line[213:221].strip(),
                    "liquidation_code": line[221:223].strip(),
                    "amount": None,
                    "net_amount": None,
                    "occurrence_date": None,
                    "credit_date": None,
                    "segments": {"T": line},
                }
                events.append(pending)
            elif segment == "U" and pending is not None:
                occurrence = line[15:17].strip()
                if occurrence:
                    pending["occurrence_code"] = occurrence
                    pending["occurrence_description"] = self.OCCURRENCES.get(occurrence, f"Ocorrência {occurrence}")
                pending["interest_amount"] = _decimal(line[17:32])
                pending["discount_amount"] = _decimal(line[32:47])
                pending["abatement_amount"] = _decimal(line[47:62])
                pending["iof_amount"] = _decimal(line[62:77])
                pending["amount"] = _decimal(line[77:92])
                pending["net_amount"] = _decimal(line[92:107])
                pending["occurrence_date"] = _parse_date8(line[137:145])
                pending["credit_date"] = _parse_date8(line[145:153])
                segments = dict(pending.get("segments") or {})
                segments["U"] = line
                pending["segments"] = segments
                pending = None
        return events
