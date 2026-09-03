from __future__ import annotations

from typing import Any

import httpx

from app.core.errors import APIError
from app.providers.fiscal.base import FiscalIssueResult, FiscalProvider


class ManagedFiscalHTTPProvider(FiscalProvider):
    """Adaptador para conectores NFS-e administrados pela plataforma.

    O núcleo financeiro trabalha com um contrato fiscal normalizado. O conector
    configurado no Control Plane é responsável pelo protocolo específico do
    emissor (Portal Nacional ou WebISS), inclusive certificado, assinatura XML,
    SOAP/REST e particularidades municipais. Isso evita levar segredos e regras
    de transporte para o ambiente do cliente.
    """

    def __init__(self, code: str) -> None:
        self.code = code.upper()

    @staticmethod
    def _endpoint(config: dict[str, Any], action: str) -> str:
        base_url = str(config.get("connector_url") or config.get("base_url") or "").strip().rstrip("/")
        if not base_url:
            raise APIError(
                "NFSE_CONNECTOR_NOT_CONFIGURED",
                "O conector fiscal selecionado ainda não foi configurado pela plataforma.",
                424,
            )
        path = str(config.get(f"{action}_path") or f"/{action}").strip()
        return f"{base_url}/{path.lstrip('/')}"

    @staticmethod
    def _headers(config: dict[str, Any]) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        token = str(config.get("api_token") or config.get("token") or "").strip()
        if token:
            header_name = str(config.get("token_header") or "Authorization").strip()
            prefix = str(config.get("token_prefix") or "Bearer").strip()
            headers[header_name] = f"{prefix} {token}".strip()
        tenant_token = str(config.get("internal_token") or "").strip()
        if tenant_token:
            headers["X-Connect-API-Internal-Token"] = tenant_token
        return headers

    async def _request(self, action: str, payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        timeout = float(config.get("timeout_seconds") or 45)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                response = await client.post(
                    self._endpoint(config, action),
                    headers=self._headers(config),
                    json={"provider": self.code, **payload},
                )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise APIError(
                "NFSE_CONNECTOR_UNAVAILABLE",
                "O serviço de emissão fiscal está temporariamente indisponível.",
                503,
            ) from exc

        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code >= 400:
            message = "Não foi possível concluir a operação fiscal."
            if isinstance(data, dict):
                message = str(data.get("message") or data.get("error") or message)[:500]
            raise APIError(
                "NFSE_CONNECTOR_ERROR",
                message,
                422 if response.status_code < 500 else 503,
                {"status_code": response.status_code, "provider": self.code},
            )
        if not isinstance(data, dict):
            raise APIError("NFSE_CONNECTOR_INVALID_RESPONSE", "Resposta inválida do serviço fiscal.", 502)
        return data

    async def issue(self, data: dict[str, Any], config: dict[str, Any]) -> FiscalIssueResult:
        result = await self._request("issue", {"document": data}, config)
        status = str(result.get("status") or "PROCESSING").upper()
        external_id = str(result.get("external_id") or result.get("id") or "").strip()
        if not external_id:
            raise APIError("NFSE_CONNECTOR_INVALID_RESPONSE", "O serviço fiscal não retornou o identificador da emissão.", 502)
        return FiscalIssueResult(
            external_id=external_id,
            status=status,
            number=str(result.get("number") or "").strip() or None,
            series=str(result.get("series") or "").strip() or None,
            verification_code=str(result.get("verification_code") or "").strip() or None,
            pdf_url=str(result.get("pdf_url") or "").strip() or None,
            xml_url=str(result.get("xml_url") or "").strip() or None,
            raw={key: value for key, value in result.items() if key not in {"api_token", "token", "secret"}},
        )

    async def cancel(self, external_id: str, reason: str, config: dict[str, Any]) -> dict[str, Any]:
        return await self._request("cancel", {"external_id": external_id, "reason": reason}, config)
