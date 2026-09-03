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
        raise ValueError(f"{field} excede {length} posições numéricas no CNAB240 Mercantil.")
    return raw.rjust(length, "0")


def _money(value: Decimal, length: int, field: str) -> str:
    if value < 0:
        raise ValueError(f"{field} não pode ser negativo no CNAB240 Mercantil.")
    raw = str(int(value * Decimal("100")))
    if len(raw) > length:
        raise ValueError(f"{field} excede {length} posições no CNAB240 Mercantil.")
    return raw.rjust(length, "0")


def _alpha(value: object, length: int, field: str, *, truncate: bool = False) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    normalized = " ".join(normalized.upper().split())
    if len(normalized) > length:
        if not truncate:
            raise ValueError(f"{field} excede {length} posições no CNAB240 Mercantil.")
        normalized = normalized[:length]
    return normalized.ljust(length)


def _record() -> list[str]:
    return [" "] * 240


def _put(buffer: list[str], start: int, end: int, value: str, field: str) -> None:
    length = end - start + 1
    if len(value) != length:
        raise ValueError(f"{field} deve ocupar exatamente {length} posições no CNAB240 Mercantil.")
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


def _control10(value: object) -> str:
    raw = "".join(ch for ch in str(value or "").upper() if ch.isalnum())
    return raw[-10:].rjust(10, "0")


@dataclass(frozen=True, slots=True)
class MercantilCNAB240Settings:
    agreement: str
    wallet: str
    species_code: str
    acceptance: str

    @classmethod
    def from_agreement(
        cls,
        agreement_number: str | None,
        wallet: str | None,
        settings: dict[str, Any] | None,
    ) -> "MercantilCNAB240Settings":
        data = dict(settings or {})
        agreement = _digits(agreement_number)
        wallet_value = _digits(wallet)
        species_code = _digits(data.get("species_code"))
        acceptance = str(data.get("acceptance") or "").strip().upper()
        missing = []
        if not agreement:
            missing.append("agreement_number")
        if not wallet_value:
            missing.append("wallet")
        if not species_code:
            missing.append("species_code")
        if not acceptance:
            missing.append("acceptance")
        if missing:
            raise ValueError("Configuração CNAB240 Mercantil incompleta. Informe: " + ", ".join(missing))
        item = cls(
            agreement=agreement,
            wallet=wallet_value,
            species_code=species_code.zfill(2),
            acceptance=acceptance,
        )
        item.validate()
        return item

    def validate(self) -> None:
        if len(self.agreement) != 9:
            raise ValueError("Contrato de cobrança Mercantil deve possuir 9 dígitos conforme o layout oficial.")
        if self.wallet != "1":
            raise ValueError("A rc.29 implementa somente carteira 1 — Cobrança Simples com Registro — do Mercantil.")
        if self.species_code not in {"01", "02", "03", "05", "06", "07", "09"}:
            raise ValueError("Espécie de título Mercantil fora do domínio oficial C015.")
        if self.acceptance not in {"S", "N"}:
            raise ValueError("Aceite Mercantil deve ser S ou N conforme C016.")


class MercantilCNAB240Generator:
    BANK_CODE = "389"
    FILE_LAYOUT = "040"
    LOT_LAYOUT = "040"

    def __init__(
        self,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        *,
        settings: MercantilCNAB240Settings,
        generation_time: str = "000000",
    ) -> None:
        if _num(company.bank_code, 3, "Código do banco") != self.BANK_CODE:
            raise ValueError("MercantilCNAB240Generator exige código bancário 389.")
        tax = _digits(company.tax_id)
        if len(tax) not in {11, 14}:
            raise ValueError("CPF/CNPJ do beneficiário Mercantil deve possuir 11 ou 14 dígitos.")
        if len(_digits(company.branch)) > 5 or len(_digits(company.account)) > 12:
            raise ValueError("Agência/conta excedem o layout Mercantil.")
        if len(_digits(company.account_digit)) > 1:
            raise ValueError("DV da conta Mercantil deve possuir no máximo 1 dígito.")
        time_digits = _digits(generation_time)
        if len(time_digits) != 6:
            raise ValueError("generation_time Mercantil deve usar HHMMSS com 6 dígitos.")
        if sequence < 1 or sequence > 999_999:
            raise ValueError("Sequencial do arquivo Mercantil deve estar entre 1 e 999999.")
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
        raise ValueError("CPF/CNPJ deve possuir 11 ou 14 dígitos no CNAB240 Mercantil.")

    def file_header(self) -> str:
        c = self.company
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0000", "Lote")
        _put(b, 8, 8, "0", "Tipo registro")
        _put(b, 9, 17, " " * 9, "CNAB")
        _put(b, 18, 18, self._tax_type(c.tax_id), "Tipo inscrição")
        _put(b, 19, 32, _num(c.tax_id, 14, "CPF/CNPJ"), "CPF/CNPJ")
        _put(b, 33, 36, _num(c.branch, 4, "Agência contrato"), "Agência contrato")
        _put(b, 37, 45, self.settings.agreement, "Contrato cobrança")
        _put(b, 46, 52, " " * 7, "Filler")
        _put(b, 53, 57, _num(c.branch, 5, "Agência C/C"), "Agência C/C")
        _put(b, 58, 58, "0", "DV agência")
        _put(b, 59, 70, _num(c.account, 12, "Conta"), "Conta")
        _put(b, 71, 71, _num(c.account_digit or 0, 1, "DV conta"), "DV conta")
        _put(b, 72, 72, "0", "DV agência/conta")
        _put(b, 73, 102, _alpha(c.name, 30, "Nome empresa", truncate=True), "Nome empresa")
        _put(b, 103, 132, _alpha("MERCANTIL DO BRASIL", 30, "Nome banco"), "Nome banco")
        _put(b, 133, 142, " " * 10, "CNAB")
        _put(b, 143, 143, "1", "Número remessa")
        _put(b, 144, 151, _date8(self.generation_date), "Data arquivo")
        _put(b, 152, 157, self.generation_time, "Hora arquivo")
        _put(b, 158, 163, _num(self.sequence, 6, "Número sequencial"), "Número sequencial")
        _put(b, 164, 166, self.FILE_LAYOUT, "Versão layout")
        _put(b, 167, 171, "01600", "Densidade")
        _put(b, 172, 222, " " * 51, "Uso banco/CNAB")
        _put(b, 223, 225, " " * 3, "VANS")
        _put(b, 226, 228, "000", "Controle VANS")
        _put(b, 229, 230, "  ", "Serviço sem papel")
        _put(b, 231, 240, " " * 10, "Ocorrências")
        return "".join(b)

    def lot_header(self) -> str:
        c = self.company
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "1", "Tipo registro")
        _put(b, 9, 9, "R", "Operação")
        _put(b, 10, 11, "01", "Serviço")
        _put(b, 12, 13, "  ", "CNAB")
        _put(b, 14, 16, self.LOT_LAYOUT, "Layout lote")
        _put(b, 17, 17, " ", "CNAB")
        _put(b, 18, 18, self._tax_type(c.tax_id), "Tipo inscrição")
        _put(b, 19, 33, _num(c.tax_id, 15, "CPF/CNPJ"), "CPF/CNPJ")
        _put(b, 34, 37, _num(c.branch, 4, "Agência contrato"), "Agência contrato")
        _put(b, 38, 46, self.settings.agreement, "Contrato cobrança")
        _put(b, 47, 53, " " * 7, "Filler")
        _put(b, 54, 58, _num(c.branch, 5, "Agência C/C"), "Agência C/C")
        _put(b, 59, 59, "0", "DV agência")
        _put(b, 60, 71, _num(c.account, 12, "Conta"), "Conta")
        _put(b, 72, 72, _num(c.account_digit or 0, 1, "DV conta"), "DV conta")
        _put(b, 73, 73, "0", "DV agência/conta")
        _put(b, 74, 103, _alpha(c.name, 30, "Nome empresa", truncate=True), "Nome empresa")
        _put(b, 104, 183, " " * 80, "Mensagens")
        _put(b, 184, 191, _num(self.sequence, 8, "Número remessa"), "Número remessa")
        _put(b, 192, 199, _date8(self.generation_date), "Data gravação")
        _put(b, 200, 207, "00000000", "Data crédito")
        _put(b, 208, 240, " " * 33, "CNAB")
        return "".join(b)

    def segment_p(self, title: CNABTitle, sequence: int) -> str:
        c = self.company
        issue = title.issue_date or self.generation_date
        if issue > title.due_date or issue > self.generation_date:
            raise ValueError("Data de emissão Mercantil não pode superar vencimento ou geração do arquivo.")
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "3", "Tipo registro")
        _put(b, 9, 13, _num(sequence, 5, "Sequencial lote"), "Sequencial lote")
        _put(b, 14, 14, "P", "Segmento")
        _put(b, 15, 15, " ", "CNAB")
        _put(b, 16, 17, "01", "Movimento")
        _put(b, 18, 22, _num(c.branch, 5, "Agência contrato"), "Agência contrato")
        _put(b, 23, 23, "0", "DV agência contrato")
        _put(b, 24, 35, _num(c.account, 12, "Conta"), "Conta")
        _put(b, 36, 36, _num(c.account_digit or 0, 1, "DV conta"), "DV conta")
        _put(b, 37, 37, " ", "Filler")
        _put(b, 38, 47, "0000000000", "Nosso Número")
        _put(b, 48, 48, "0", "DV Nosso Número")
        _put(b, 49, 57, " " * 9, "Filler")
        _put(b, 58, 58, self.settings.wallet, "Carteira")
        _put(b, 59, 59, "0", "Cadastramento")
        _put(b, 60, 60, " ", "Tipo documento")
        _put(b, 61, 61, "0", "Emissão boleto")
        _put(b, 62, 62, " ", "Distribuição boleto")
        _put(b, 63, 72, _control10(title.document_number), "Seu Número")
        _put(b, 73, 77, " " * 5, "Filler")
        _put(b, 78, 85, _date8(title.due_date), "Vencimento")
        _put(b, 86, 100, _money(title.amount, 15, "Valor título"), "Valor título")
        _put(b, 101, 105, "00000", "Agência cobradora")
        _put(b, 106, 106, "0", "DV agência cobradora")
        _put(b, 107, 108, self.settings.species_code, "Espécie")
        _put(b, 109, 109, self.settings.acceptance, "Aceite")
        _put(b, 110, 117, _date8(issue), "Data emissão")
        _put(b, 118, 118, "0", "Código juros")
        _put(b, 119, 126, "00000000", "Data juros")
        _put(b, 127, 141, "0" * 15, "Juros")
        _put(b, 142, 142, "0", "Código desconto")
        _put(b, 143, 150, "00000000", "Data desconto")
        _put(b, 151, 165, "0" * 15, "Desconto")
        _put(b, 166, 180, "0" * 15, "IOF")
        _put(b, 181, 195, "0" * 15, "Abatimento")
        _put(b, 196, 220, _alpha(title.document_number, 25, "Controle empresa", truncate=True), "Controle empresa")
        _put(b, 221, 224, "0000", "Instruções")
        _put(b, 225, 227, " " * 3, "Filler")
        _put(b, 228, 229, "09", "Moeda")
        _put(b, 230, 239, "0" * 10, "Contrato operação crédito")
        _put(b, 240, 240, " ", "CNAB")
        return "".join(b)

    def segment_q(self, title: CNABTitle, sequence: int) -> str:
        tax = _digits(title.payer_tax_id)
        if len(tax) == 11:
            tax_type = "1"
        elif len(tax) == 14:
            tax_type = "2"
        else:
            raise ValueError("CPF/CNPJ do pagador Mercantil deve possuir 11 ou 14 dígitos.")
        zip_code = _digits(title.payer_zip_code)
        if len(zip_code) != 8:
            raise ValueError("CEP do pagador Mercantil deve possuir 8 dígitos.")
        state = str(title.payer_state or "").strip().upper()
        if len(state) != 2:
            raise ValueError("UF do pagador Mercantil deve possuir 2 caracteres.")
        if not title.payer_name.strip() or not title.payer_address.strip() or not title.payer_city.strip():
            raise ValueError("Nome, endereço e cidade do pagador são obrigatórios no CNAB240 Mercantil.")
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "3", "Tipo registro")
        _put(b, 9, 13, _num(sequence, 5, "Sequencial lote"), "Sequencial lote")
        _put(b, 14, 14, "Q", "Segmento")
        _put(b, 15, 15, " ", "CNAB")
        _put(b, 16, 17, "01", "Movimento")
        _put(b, 18, 18, tax_type, "Tipo inscrição pagador")
        _put(b, 19, 33, _num(tax, 15, "CPF/CNPJ pagador"), "CPF/CNPJ pagador")
        _put(b, 34, 73, _alpha(title.payer_name, 40, "Nome pagador", truncate=True), "Nome pagador")
        _put(b, 74, 113, _alpha(title.payer_address, 40, "Endereço", truncate=True), "Endereço")
        _put(b, 114, 128, " " * 15, "Bairro")
        _put(b, 129, 133, zip_code[:5], "CEP")
        _put(b, 134, 136, zip_code[5:], "Sufixo CEP")
        _put(b, 137, 151, _alpha(title.payer_city, 15, "Cidade", truncate=True), "Cidade")
        _put(b, 152, 153, state, "UF")
        _put(b, 154, 154, "0", "Tipo avalista")
        _put(b, 155, 169, "0" * 15, "Inscrição avalista")
        _put(b, 170, 209, " " * 40, "Nome avalista")
        _put(b, 210, 212, "000", "Banco correspondente")
        _put(b, 213, 232, "0" * 20, "Nosso Número banco correspondente")
        _put(b, 233, 240, " " * 8, "CNAB")
        return "".join(b)

    def lot_trailer(self, title_count: int, total: Decimal) -> str:
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "0001", "Lote")
        _put(b, 8, 8, "5", "Tipo registro")
        _put(b, 9, 17, " " * 9, "CNAB")
        _put(b, 18, 23, _num(2 + title_count * 2, 6, "Registros lote"), "Registros lote")
        _put(b, 24, 29, _num(title_count, 6, "Qtd simples"), "Qtd simples")
        _put(b, 30, 46, _money(total, 17, "Total simples"), "Total simples")
        _put(b, 47, 115, "0" * 69, "Demais totalizações")
        _put(b, 116, 123, " " * 8, "Aviso")
        _put(b, 124, 240, " " * 117, "CNAB")
        return "".join(b)

    def file_trailer(self, total_records: int) -> str:
        b = _record()
        _put(b, 1, 3, self.BANK_CODE, "Banco")
        _put(b, 4, 7, "9999", "Lote")
        _put(b, 8, 8, "9", "Tipo registro")
        _put(b, 9, 17, " " * 9, "CNAB")
        _put(b, 18, 23, "000001", "Quantidade lotes")
        _put(b, 24, 29, _num(total_records, 6, "Quantidade registros"), "Quantidade registros")
        _put(b, 30, 35, " " * 6, "Quantidade contas")
        _put(b, 36, 240, " " * 205, "CNAB")
        return "".join(b)

    def generate(self, titles: list[CNABTitle]) -> bytes:
        if not titles:
            raise ValueError("Remessa Mercantil precisa conter ao menos um título.")
        lines = [self.file_header(), self.lot_header()]
        seq = 1
        for title in titles:
            lines.append(self.segment_p(title, seq)); seq += 1
            lines.append(self.segment_q(title, seq)); seq += 1
        total = sum((item.amount for item in titles), Decimal("0"))
        lines.append(self.lot_trailer(len(titles), total))
        lines.append(self.file_trailer(len(lines) + 1))
        if any(len(line) != 240 for line in lines):
            raise ValueError("CNAB240 Mercantil inválido: todos os registros devem possuir 240 posições.")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")


class MercantilCNAB240ReturnParser:
    BANK_CODE = "389"
    OCCURRENCES = {
        "02": "Entrada confirmada",
        "03": "Entrada rejeitada",
        "04": "Transferência de contrato",
        "06": "Liquidado",
        "09": "Baixa automática",
        "10": "Baixa a pedido do beneficiário",
        "12": "Abatimento/desconto concedido",
        "13": "Abatimento/desconto cancelado",
        "14": "Alteração de vencimento",
        "15": "Liquidado em cartório",
        "16": "Liquidado com cheque a compensar",
        "19": "Alteração de instrução de protesto",
        "22": "Alteração de Seu Número",
        "23": "Liquidado por débito em conta",
        "24": "Liquidado pelo banco correspondente",
        "31": "Baixa franco de pagamento",
        "55": "Instrução codificada",
        "56": "Sustar protesto e manter em carteira",
        "65": "Emissão de segunda via de aviso",
        "67": "Não conceder juros fora do prazo",
        "83": "Cobrança automática de tarifas",
        "84": "Protestar sem mais consultas",
        "85": "Baixa de título protestado",
    }

    def parse(self, content: bytes) -> list[dict[str, object]]:
        lines = [line.rstrip("\r\n") for line in content.decode("latin-1").splitlines() if line.strip()]
        if not lines:
            raise ValueError("Arquivo retorno CNAB240 Mercantil vazio.")
        invalid = [index + 1 for index, line in enumerate(lines) if len(line) != 240]
        if invalid:
            raise ValueError(f"Retorno Mercantil possui registro fora de 240 posições: {invalid[:20]}.")
        if lines[0][0:3] != self.BANK_CODE or lines[0][7:8] != "0":
            raise ValueError("Arquivo informado não é retorno CNAB240 Banco Mercantil (389).")

        events: list[dict[str, object]] = []
        pending: dict[str, object] | None = None
        for line in lines:
            if line[7:8] != "3":
                continue
            segment = line[13:14]
            if segment == "T":
                occurrence = line[15:17]
                our_number = line[37:47].strip()
                control = line[105:130].strip()
                your_number = line[59:69].strip()
                pending = {
                    "sequence": line[8:13],
                    "provider": "MERCANTIL",
                    "bank_code": self.BANK_CODE,
                    "occurrence_code": occurrence,
                    "occurrence_description": self.OCCURRENCES.get(occurrence, f"Ocorrência {occurrence}"),
                    "our_number": our_number,
                    "our_number_normalized": _normalize_identifier(our_number),
                    "document_number": control or your_number,
                    "document_number_normalized": _normalize_identifier(control or your_number),
                    "your_number": your_number,
                    "due_date": _parse_date8(line[73:81]),
                    "title_amount": _decimal(line[81:96]),
                    "payer_tax_id": line[133:148].strip(),
                    "payer_name": line[148:188].strip(),
                    "rejection_codes": line[213:223].strip(),
                    "agreement": line[227:236].strip(),
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
                pending["payer_occurrence_code"] = line[153:157].strip()
                pending["payer_occurrence_date"] = _parse_date8(line[157:165])
                segments = dict(pending.get("segments") or {})
                segments["U"] = line
                pending["segments"] = segments
                pending = None
        return events
