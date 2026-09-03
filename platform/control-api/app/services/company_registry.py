from __future__ import annotations

from typing import Any

import httpx

from app.core.errors import APIError


class CompanyRegistryService:
    """Consulta cadastral pública com fallback entre fontes abertas.

    O front recebe um contrato único e não depende do formato nem do nome do
    provedor consultado. Nenhuma credencial de fornecedor é exposta ao cliente.
    """

    timeout = 12.0

    @staticmethod
    def normalize_cnpj(value: str) -> str:
        digits = "".join(character for character in value if character.isdigit())
        if len(digits) != 14:
            raise APIError("CNPJ_INVALID", "Informe um CNPJ válido com 14 dígitos.", 422)
        return digits

    @staticmethod
    def _phone(*values: object) -> str | None:
        for value in values:
            text = "".join(character for character in str(value or "") if character.isdigit())
            if len(text) >= 10:
                return text
        return None

    @staticmethod
    def _response(cnpj: str, data: dict[str, Any]) -> dict[str, Any]:
        return {
            "tax_id": cnpj,
            "legal_name": str(data.get("legal_name") or "").strip(),
            "trade_name": str(data.get("trade_name") or "").strip() or None,
            "state_registration": str(data.get("state_registration") or "").strip() or None,
            "email": str(data.get("email") or "").strip().lower() or None,
            "phone": data.get("phone"),
            "address": {
                "street": str(data.get("street") or "").strip(),
                "number": str(data.get("number") or "").strip(),
                "complement": str(data.get("complement") or "").strip(),
                "district": str(data.get("district") or "").strip(),
                "city": str(data.get("city") or "").strip(),
                "state": str(data.get("state") or "").strip().upper(),
                "zip_code": "".join(character for character in str(data.get("zip_code") or "") if character.isdigit()),
            },
        }

    async def lookup(self, value: str) -> dict[str, Any]:
        cnpj = self.normalize_cnpj(value)
        errors: list[str] = []
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            try:
                response = await client.get(f"https://publica.cnpj.ws/cnpj/{cnpj}")
                if response.status_code == 200:
                    raw = response.json()
                    establishment = raw.get("estabelecimento") or {}
                    city = establishment.get("cidade") or {}
                    state = establishment.get("estado") or {}
                    registrations = establishment.get("inscricoes_estaduais") or raw.get("estabelecimento", {}).get("inscricoes_estaduais") or []
                    first_registration = next((item for item in registrations if item.get("ativo", True)), registrations[0] if registrations else {})
                    return self._response(cnpj, {
                        "legal_name": raw.get("razao_social"),
                        "trade_name": establishment.get("nome_fantasia"),
                        "state_registration": first_registration.get("inscricao_estadual"),
                        "email": establishment.get("email"),
                        "phone": self._phone(
                            f"{establishment.get('ddd1') or ''}{establishment.get('telefone1') or ''}",
                            f"{establishment.get('ddd2') or ''}{establishment.get('telefone2') or ''}",
                        ),
                        "street": " ".join(filter(None, [establishment.get("tipo_logradouro"), establishment.get("logradouro")])),
                        "number": establishment.get("numero"),
                        "complement": establishment.get("complemento"),
                        "district": establishment.get("bairro"),
                        "city": city.get("nome") if isinstance(city, dict) else city,
                        "state": state.get("sigla") if isinstance(state, dict) else state,
                        "zip_code": establishment.get("cep"),
                    })
                errors.append(f"fonte_a:{response.status_code}")
            except Exception as exc:
                errors.append(f"fonte_a:{type(exc).__name__}")

            try:
                response = await client.get(f"https://www.receitaws.com.br/v1/cnpj/{cnpj}")
                if response.status_code == 200:
                    raw = response.json()
                    if str(raw.get("status", "OK")).upper() != "ERROR":
                        return self._response(cnpj, {
                            "legal_name": raw.get("nome"),
                            "trade_name": raw.get("fantasia"),
                            "state_registration": raw.get("ie"),
                            "email": raw.get("email"),
                            "phone": self._phone(raw.get("telefone")),
                            "street": raw.get("logradouro"),
                            "number": raw.get("numero"),
                            "complement": raw.get("complemento"),
                            "district": raw.get("bairro"),
                            "city": raw.get("municipio"),
                            "state": raw.get("uf"),
                            "zip_code": raw.get("cep"),
                        })
                errors.append(f"fonte_b:{response.status_code}")
            except Exception as exc:
                errors.append(f"fonte_b:{type(exc).__name__}")

        raise APIError(
            "CNPJ_LOOKUP_UNAVAILABLE",
            "Não foi possível consultar este CNPJ agora. Você pode preencher os dados manualmente e tentar novamente depois.",
            503,
            {"attempts": len(errors)},
        )
