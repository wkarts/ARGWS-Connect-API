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
        raise ValueError(f"{field} excede {length} posições numéricas no CBR641 BB.")
    return raw.rjust(length, "0")


def _money(value: Decimal, length: int, field: str) -> str:
    if value < 0:
        raise ValueError(f"{field} não pode ser negativo no CBR641 BB.")
    raw = str(int(value * Decimal("100")))
    if len(raw) > length:
        raise ValueError(f"{field} excede {length} posições no CBR641 BB.")
    return raw.rjust(length, "0")


def _alpha(value: object, length: int, field: str, *, truncate: bool = False) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    normalized = " ".join(normalized.upper().split())
    if len(normalized) > length:
        if not truncate:
            raise ValueError(f"{field} excede {length} posições no CBR641 BB.")
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
        raise ValueError(f"{field} deve ocupar exatamente {length} posições no CBR641 BB.")
    buffer[start - 1 : end] = list(value)


@dataclass(frozen=True, slots=True)
class BancoDoBrasilCBR641Settings:
    agreement: str
    leader_agreement: str
    wallet: str
    wallet_variation: str
    species_code: str
    acceptance: str

    @classmethod
    def from_agreement(
        cls,
        agreement_number: str | None,
        wallet: str | None,
        settings: dict[str, Any] | None,
    ) -> "BancoDoBrasilCBR641Settings":
        data = dict(settings or {})
        agreement = _digits(agreement_number)
        leader_agreement = _digits(data.get("leader_agreement") or agreement)
        wallet_value = _digits(wallet)
        wallet_variation = _digits(data.get("wallet_variation"))
        species_code = _digits(data.get("species_code"))
        acceptance = str(data.get("acceptance") or "").strip().upper()
        missing = []
        if not agreement:
            missing.append("agreement_number")
        if not leader_agreement:
            missing.append("leader_agreement")
        if not wallet_value:
            missing.append("wallet")
        if not wallet_variation:
            missing.append("wallet_variation")
        if not species_code:
            missing.append("species_code")
        if not acceptance:
            missing.append("acceptance")
        if missing:
            raise ValueError(
                "Configuração CBR641 Banco do Brasil incompleta. Informe no convênio: " + ", ".join(missing)
            )
        item = cls(
            agreement=agreement,
            leader_agreement=leader_agreement,
            wallet=wallet_value.zfill(2),
            wallet_variation=wallet_variation.zfill(3),
            species_code=species_code.zfill(2),
            acceptance=acceptance,
        )
        item.validate()
        return item

    def validate(self) -> None:
        if len(self.agreement) != 7 or len(self.leader_agreement) != 7:
            raise ValueError("A rc.29 implementa CBR641/CBR643 para convênios BB de 7 posições.")
        if self.wallet not in {"11", "17", "31", "51"}:
            raise ValueError("Carteira BB fora do escopo CBR641 rc.29: use 11, 17, 31 ou 51.")
        if len(self.wallet_variation) != 3:
            raise ValueError("Variação da carteira BB deve possuir 3 dígitos e ser a fornecida pelo banco.")
        if self.species_code not in {
            "01", "02", "03", "05", "08", "09", "10", "12", "13", "15",
            "25", "26", "27", "31", "32", "33",
        }:
            raise ValueError("Espécie de título não consta na Nota 07 do manual CBR641 vigente.")
        if self.acceptance not in {"A", "N"}:
            raise ValueError("Aceite BB deve ser A ou N.")


class BancoDoBrasilCBR641Generator:
    """Banco do Brasil CBR641 — CNAB400, convênio de 7 posições.

    Escopo rc.29: comando 01 (registro), modalidade simples, Nosso Número a
    cargo do Banco, sem juros/desconto/IOF/abatimento/protesto/negativação,
    sem registros opcionais tipo 5 e sem recebimento parcial forçado.
    """

    BANK_CODE = "001"
    BANK_IDENTIFICATION = "001BANCO DO BRASIL"

    def __init__(
        self,
        company: CNABCompany,
        sequence: int,
        generation_date: date,
        *,
        settings: BancoDoBrasilCBR641Settings,
    ) -> None:
        if _num(company.bank_code, 3, "Código do banco") != self.BANK_CODE:
            raise ValueError("BancoDoBrasilCBR641Generator exige código bancário 001.")
        tax_id = _digits(company.tax_id)
        if len(tax_id) not in {11, 14}:
            raise ValueError("CPF/CNPJ do beneficiário BB deve possuir 11 ou 14 dígitos.")
        if sequence < 1 or sequence > 9_999_999:
            raise ValueError("Sequencial de remessa BB deve estar entre 1 e 9999999.")
        self.company = company
        self.sequence = sequence
        self.generation_date = generation_date
        self.settings = settings

    @staticmethod
    def _tax_type(value: object) -> str:
        digits = _digits(value)
        if len(digits) == 11:
            return "01"
        if len(digits) == 14:
            return "02"
        raise ValueError("CPF/CNPJ deve possuir 11 ou 14 dígitos no CBR641 BB.")

    def header(self) -> str:
        b = _record()
        _put(b, 1, 1, "0", "Tipo de registro")
        _put(b, 2, 2, "1", "Tipo de operação")
        _put(b, 3, 9, "REMESSA", "Identificação da operação")
        _put(b, 10, 11, "01", "Tipo de serviço")
        _put(b, 12, 19, "COBRANCA", "Serviço")
        _put(b, 20, 26, " " * 7, "Complemento")
        _put(b, 27, 30, _num(self.company.branch, 4, "Agência"), "Agência")
        _put(b, 31, 31, _alpha(self.company.branch_digit, 1, "DV agência"), "DV agência")
        _put(b, 32, 39, _num(self.company.account, 8, "Conta corrente"), "Conta corrente")
        _put(b, 40, 40, _alpha(self.company.account_digit, 1, "DV conta"), "DV conta")
        _put(b, 41, 46, "000000", "Complemento")
        _put(b, 47, 76, _alpha(self.company.name, 30, "Nome do Beneficiário", truncate=True), "Nome do Beneficiário")
        _put(b, 77, 94, self.BANK_IDENTIFICATION, "Identificação do banco")
        _put(b, 95, 100, _ddmmyy(self.generation_date), "Data de gravação")
        _put(b, 101, 107, _num(self.sequence, 7, "Sequencial da remessa"), "Sequencial da remessa")
        _put(b, 108, 129, " " * 22, "Complemento")
        _put(b, 130, 136, self.settings.leader_agreement, "Convênio líder")
        _put(b, 137, 394, " " * 258, "Complemento")
        _put(b, 395, 400, "000001", "Sequencial do registro")
        return "".join(b)

    def detail(self, title: CNABTitle, record_sequence: int) -> str:
        payer_digits = _digits(title.payer_tax_id)
        payer_type = self._tax_type(payer_digits)
        zip_code = _digits(title.payer_zip_code)
        if len(zip_code) != 8:
            raise ValueError("CEP do pagador BB é obrigatório e deve possuir 8 dígitos.")
        state = str(title.payer_state or "").strip().upper()
        if len(state) != 2:
            raise ValueError("UF do pagador BB é obrigatória e deve possuir 2 caracteres.")
        if not str(title.payer_name or "").strip() or not str(title.payer_address or "").strip():
            raise ValueError("Nome e endereço do pagador são obrigatórios no CBR641 BB.")
        if not str(title.payer_city or "").strip():
            raise ValueError("Cidade do pagador é obrigatória no CBR641 BB.")
        control = _alpha(title.document_number, 25, "Código de Controle da Empresa")
        your_number = _alpha(str(title.document_number)[-10:], 10, "Seu Número")
        issue_date = title.issue_date or self.generation_date
        if issue_date > title.due_date:
            raise ValueError("Data de emissão BB não pode ser posterior ao vencimento.")

        b = _record()
        _put(b, 1, 1, "7", "Tipo de registro")
        _put(b, 2, 3, self._tax_type(self.company.tax_id), "Tipo de inscrição do beneficiário")
        _put(b, 4, 17, _num(self.company.tax_id, 14, "CPF/CNPJ do beneficiário"), "CPF/CNPJ do beneficiário")
        _put(b, 18, 21, _num(self.company.branch, 4, "Agência"), "Agência")
        _put(b, 22, 22, _alpha(self.company.branch_digit, 1, "DV agência"), "DV agência")
        _put(b, 23, 30, _num(self.company.account, 8, "Conta corrente"), "Conta corrente")
        _put(b, 31, 31, _alpha(self.company.account_digit, 1, "DV conta"), "DV conta")
        _put(b, 32, 38, self.settings.agreement, "Convênio")
        _put(b, 39, 63, control, "Código de Controle da Empresa")
        _put(b, 64, 80, "0" * 17, "Nosso Número")
        _put(b, 81, 82, "00", "Número da prestação")
        _put(b, 83, 84, "00", "Grupo de valor")
        _put(b, 85, 86, "  ", "Tipo de moeda")
        _put(b, 87, 87, " ", "Complemento")
        _put(b, 88, 88, " ", "Indicativo de mensagem")
        _put(b, 89, 91, " " * 3, "Prefixo do título")
        _put(b, 92, 94, self.settings.wallet_variation, "Variação da carteira")
        _put(b, 95, 95, "0", "Conta caução")
        _put(b, 96, 101, "000000", "Borderô")
        _put(b, 102, 106, " " * 5, "Tipo de cobrança")
        _put(b, 107, 108, self.settings.wallet, "Carteira")
        _put(b, 109, 110, "01", "Comando")
        _put(b, 111, 120, your_number, "Seu Número")
        _put(b, 121, 126, _ddmmyy(title.due_date), "Vencimento")
        _put(b, 127, 139, _money(title.amount, 13, "Valor do título"), "Valor do título")
        _put(b, 140, 142, self.BANK_CODE, "Número do banco")
        _put(b, 143, 146, "0000", "Agência cobradora")
        _put(b, 147, 147, " ", "DV agência cobradora")
        _put(b, 148, 149, self.settings.species_code, "Espécie")
        _put(b, 150, 150, self.settings.acceptance, "Aceite")
        _put(b, 151, 156, _ddmmyy(issue_date), "Data de emissão")
        _put(b, 157, 158, "00", "Instrução 1")
        _put(b, 159, 160, "00", "Instrução 2")
        _put(b, 161, 173, "0" * 13, "Juros de mora")
        _put(b, 174, 179, "0" * 6, "Data de desconto")
        _put(b, 180, 192, "0" * 13, "Desconto")
        _put(b, 193, 205, "0" * 13, "IOF")
        _put(b, 206, 218, "0" * 13, "Abatimento")
        _put(b, 219, 220, payer_type, "Tipo de inscrição do pagador")
        _put(b, 221, 234, _num(payer_digits, 14, "CPF/CNPJ do pagador"), "CPF/CNPJ do pagador")
        _put(b, 235, 271, _alpha(title.payer_name, 37, "Nome do pagador", truncate=True), "Nome do pagador")
        _put(b, 272, 274, " " * 3, "Complemento")
        _put(b, 275, 314, _alpha(title.payer_address, 40, "Endereço do pagador", truncate=True), "Endereço do pagador")
        _put(b, 315, 326, " " * 12, "Bairro")
        _put(b, 327, 334, zip_code, "CEP")
        _put(b, 335, 349, _alpha(title.payer_city, 15, "Cidade", truncate=True), "Cidade")
        _put(b, 350, 351, state, "UF")
        _put(b, 352, 391, " " * 40, "Mensagem")
        _put(b, 392, 393, "  ", "Dias protesto/negativação")
        _put(b, 394, 394, " ", "Recebimento parcial")
        _put(b, 395, 400, _num(record_sequence, 6, "Sequencial do registro"), "Sequencial do registro")
        return "".join(b)

    @staticmethod
    def trailer(record_sequence: int) -> str:
        b = _record()
        _put(b, 1, 1, "9", "Trailer")
        _put(b, 2, 394, " " * 393, "Complemento")
        _put(b, 395, 400, _num(record_sequence, 6, "Sequencial do registro"), "Sequencial do registro")
        return "".join(b)

    def generate(self, titles: list[CNABTitle]) -> bytes:
        if not titles:
            raise ValueError("Remessa CBR641 BB precisa conter ao menos um título.")
        lines = [self.header()]
        sequence = 2
        for title in titles:
            lines.append(self.detail(title, sequence))
            sequence += 1
        lines.append(self.trailer(sequence))
        if any(len(line) != 400 for line in lines):
            raise ValueError("CBR641 BB inválido: todos os registros devem possuir 400 posições.")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")


class BancoDoBrasilCBR643ReturnParser:
    BANK_CODE = "001"
    BANK_IDENTIFICATION = "001BANCO DO BRASIL"
    OCCURRENCES: dict[str, str] = {
        "02": "Confirmação de Entrada de Boleto",
        "03": "Comando recusado",
        "05": "Liquidado sem registro",
        "06": "Liquidação Normal",
        "07": "Liquidação por Conta/Parcial",
        "08": "Liquidação por Saldo",
        "09": "Baixa de Título",
        "10": "Baixa Solicitada",
        "11": "Boletos em Ser",
        "12": "Abatimento Concedido",
        "13": "Abatimento Cancelado",
        "14": "Alteração de Vencimento",
        "15": "Liquidação em Cartório",
        "16": "Confirmação de alteração de juros de mora",
        "19": "Confirmação de instrução para protesto",
        "20": "Débito em Conta",
        "23": "Encaminhamento a cartório",
        "24": "Sustação de Protesto",
        "44": "Boleto pago com cheque devolvido",
        "46": "Boleto pago com cheque aguardando compensação",
        "47": "Alteração de valor nominal",
        "61": "Registrado QR Code Pix",
        "72": "Alteração de tipo de cobrança",
        "73": "Confirmação de parâmetro de pagamento parcial",
        "85": "Inclusão de negativação",
        "86": "Exclusão de negativação",
        "93": "Baixa Operacional",
        "96": "Despesas de Protesto",
        "97": "Despesas de Sustação de Protesto",
        "98": "Débito de Custas Antecipadas",
    }

    def parse(self, content: bytes) -> list[dict[str, object]]:
        lines = [line.rstrip("\r\n") for line in content.decode("latin-1").splitlines() if line.strip()]
        if not lines:
            raise ValueError("Arquivo retorno CBR643 BB vazio.")
        invalid = [index + 1 for index, line in enumerate(lines) if len(line) != 400]
        if invalid:
            raise ValueError(f"CBR643 BB possui registro fora de 400 posições: {invalid[:20]}.")
        header = lines[0]
        if header[0:1] != "0" or header[76:94] != self.BANK_IDENTIFICATION:
            raise ValueError("Arquivo informado não é retorno CBR643 Banco do Brasil.")

        events: list[dict[str, object]] = []
        for line in lines:
            if line[0:1] != "7":
                continue
            occurrence = line[108:110]
            control = line[38:63].strip()
            our_number = line[63:80].strip()
            your_number = line[116:126].strip()
            received = _decimal(line[253:266])
            title_amount = _decimal(line[152:165])
            if received in {None, Decimal("0")} and occurrence in {"05", "06", "07", "08", "15"}:
                received = title_amount
            events.append(
                {
                    "sequence": line[394:400],
                    "provider": "BANCO_DO_BRASIL",
                    "bank_code": self.BANK_CODE,
                    "agreement": line[31:38].strip(),
                    "wallet": line[106:108].strip(),
                    "wallet_variation": line[91:94].strip(),
                    "occurrence_code": occurrence,
                    "occurrence_description": self.OCCURRENCES.get(occurrence, f"Ocorrência {occurrence}"),
                    "our_number": our_number,
                    "our_number_normalized": _normalize_identifier(our_number),
                    "document_number": control or your_number,
                    "document_number_normalized": _normalize_identifier(control or your_number),
                    "your_number": your_number,
                    "occurrence_date": _date6(line[110:116]),
                    "due_date": _date6(line[146:152]),
                    "title_amount": title_amount,
                    "amount": received,
                    "net_amount": received,
                    "credit_date": _date6(line[175:181]),
                    "receiving_bank": line[165:168].strip(),
                    "receiving_branch": line[168:172].strip(),
                    "channel": line[392:394].strip(),
                    "raw": line,
                }
            )
        return events
