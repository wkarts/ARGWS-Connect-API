from __future__ import annotations

from typing import Any

import httpx
import asyncio
from urllib.parse import quote

from app.core.config import settings
from app.core.errors import APIError


class ConnectEngineClient:
    """Internal bridge to the canonical Node/TypeScript Connect|API Engine.

    The global engine key never crosses the Platform API boundary. Tenant-facing
    routes resolve EngineBinding first and only then call instance-scoped Engine
    endpoints.
    """

    def __init__(self) -> None:
        self.base_url = settings.connect_engine_base_url.rstrip("/")
        self.timeout = float(settings.connect_engine_timeout_seconds)
        self.verify = settings.connect_engine_verify_tls

    def _headers(self, api_key: str | None = None) -> dict[str, str]:
        key = (api_key if api_key is not None else settings.connect_engine_api_key).strip()
        if not key:
            raise APIError("ENGINE_NOT_CONFIGURED", "Connect|API Engine não configurado.", 503)
        return {"apikey": key, "Accept": "application/json"}

    async def request(self, method: str, path: str, *, json: Any | None = None, params: dict[str, Any] | None = None, api_key: str | None = None) -> Any:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(api_key),
                trust_env=False,
                timeout=self.timeout,
                verify=self.verify,
                follow_redirects=False,
            ) as client:
                safe_read = method == "GET" and (path in {"/instance/fetchInstances", "/health"} or path.startswith("/instance/connectionState/"))
                for attempt in range(2 if safe_read else 1):
                    try:
                        response = await client.request(method, path, json=json, params=params)
                    except (httpx.TimeoutException, httpx.NetworkError):
                        if not safe_read or attempt: raise
                        await asyncio.sleep(0.2)
                        continue
                    if not safe_read or attempt or response.status_code not in {500, 502, 503, 504}: break
                    await asyncio.sleep(0.2)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise APIError("ENGINE_UNAVAILABLE", "Connect|API Engine indisponível.", 503) from exc
        except httpx.HTTPError as exc:
            raise APIError("ENGINE_REQUEST_FAILED", "Falha de comunicação com Connect|API Engine.", 502) from exc

        if response.status_code >= 400:
            status = response.status_code
            code, message, public_status = "ENGINE_ERROR", "O motor de comunicação não concluiu a operação.", 502
            if status in {401, 403}:
                code, message = "ENGINE_CREDENTIAL_REJECTED", "A credencial de comunicação com o Engine foi recusada. Contate o administrador."
            elif status == 404:
                code, message, public_status = "ENGINE_INSTANCE_NOT_FOUND", "Instância não encontrada no Engine.", 404
            elif status == 409:
                code, message, public_status = "ENGINE_INSTANCE_CONFLICT", "O identificador da instância já está em uso.", 409
            elif status == 429:
                code, message, public_status = "ENGINE_CAPACITY_REACHED", "O Engine atingiu a capacidade temporária. Tente novamente.", 503
            elif status in {400, 422}:
                code, message, public_status = "ENGINE_OPERATION_REJECTED", "O Engine não pôde executar a operação. Verifique o número, o provedor e o estado da instância.", 422
            # Never reflect upstream bodies: they may contain keys, provider secrets or SQL.
            # Upstream 401/403 is NOT a browser authentication failure.
            raise APIError(code, message, public_status, {"engine_status": status})
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise APIError("ENGINE_RESPONSE_INVALID", "O Engine retornou uma resposta inválida.", 502) from exc

    async def health(self) -> dict[str, Any]:
        data = await self.request("GET", "/health")
        return data if isinstance(data, dict) else {"data": data}

    async def fetch_instances(self) -> Any:
        return await self.request("GET", "/instance/fetchInstances")

    async def create_instance(self, payload: dict[str, Any]) -> Any:
        return await self.request("POST", "/instance/create", json=payload)

    async def connection_state(self, instance_name: str) -> Any:
        return await self.request("GET", f"/instance/connectionState/{quote(instance_name, safe='')}")

    async def connect_instance(self, instance_name: str, number: str | None = None) -> Any:
        return await self.request("GET", f"/instance/connect/{quote(instance_name, safe='')}", params={"number": number} if number else None)

    async def owned_instance(self, instance_name: str, api_key: str) -> dict | None:
        data = await self.request("GET", "/instance/fetchInstances", params={"instanceName": instance_name}, api_key=api_key)
        rows = data if isinstance(data, list) else data.get("instances", data.get("data", [])) if isinstance(data, dict) else []
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict) and (row.get("name") or row.get("instanceName")) == instance_name:
                return {"instanceName": instance_name, "instanceId": row.get("id") or row.get("instanceId"), "status": row.get("connectionStatus")}
        return None

    async def restart_instance(self, instance_name: str) -> Any:
        return await self.request("POST", f"/instance/restart/{quote(instance_name, safe='')}", json={})

    async def logout_instance(self, instance_name: str) -> Any:
        return await self.request("DELETE", f"/instance/logout/{quote(instance_name, safe='')}")

    async def delete_instance(self, instance_name: str) -> Any:
        return await self.request("DELETE", f"/instance/delete/{quote(instance_name, safe='')}")

    async def templates(self, instance_name: str) -> Any:
        return await self.request("GET", f"/template/find/{quote(instance_name, safe='')}")

    async def create_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/template/create/{quote(instance_name, safe='')}", json=payload)

    async def edit_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/template/edit/{quote(instance_name, safe='')}", json=payload)

    async def delete_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("DELETE", f"/template/delete/{quote(instance_name, safe='')}", json=payload)

    async def template_capabilities(self, instance_name: str) -> Any:
        return await self.request("GET", f"/template/capabilities/{quote(instance_name, safe='')}")

    async def template_preview(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/template/preview/{quote(instance_name, safe='')}", json=payload)

    async def send_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/message/sendTemplate/{quote(instance_name, safe='')}", json=payload)

    async def send_text(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/message/sendText/{quote(instance_name, safe='')}", json=payload)

    async def actions(self, instance_name: str) -> Any:
        return await self.request("GET", f"/action/find/{quote(instance_name, safe='')}")

    async def create_action(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/action/create/{quote(instance_name, safe='')}", json=payload)

    async def execute_action(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/action/execute/{quote(instance_name, safe='')}", json=payload)

    async def delete_action(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("DELETE", f"/action/delete/{quote(instance_name, safe='')}", json=payload)

    async def recipes(self, instance_name: str) -> Any:
        return await self.request("GET", f"/recipe/find/{quote(instance_name, safe='')}")

    async def recipe_library(self) -> Any:
        return await self.request("GET", "/recipe/library")

    async def create_recipe(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/recipe/create/{quote(instance_name, safe='')}", json=payload)

    async def execute_recipe(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/recipe/execute/{quote(instance_name, safe='')}", json=payload)

    async def delete_recipe(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("DELETE", f"/recipe/delete/{quote(instance_name, safe='')}", json=payload)


connect_engine = ConnectEngineClient()
