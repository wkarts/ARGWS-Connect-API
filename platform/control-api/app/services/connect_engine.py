from __future__ import annotations

from typing import Any

import httpx

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

    def _headers(self) -> dict[str, str]:
        key = settings.connect_engine_api_key.strip()
        if not key:
            raise APIError("ENGINE_NOT_CONFIGURED", "Connect|API Engine não configurado.", 503)
        return {"apikey": key, "Accept": "application/json"}

    async def request(self, method: str, path: str, *, json: Any | None = None, params: dict[str, Any] | None = None) -> Any:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(),
                timeout=self.timeout,
                verify=self.verify,
                follow_redirects=False,
            ) as client:
                response = await client.request(method, path, json=json, params=params)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise APIError("ENGINE_UNAVAILABLE", "Connect|API Engine indisponível.", 503) from exc
        except httpx.HTTPError as exc:
            raise APIError("ENGINE_REQUEST_FAILED", "Falha de comunicação com Connect|API Engine.", 502) from exc

        if response.status_code >= 400:
            try:
                detail = response.json()
            except ValueError:
                detail = {"message": response.text[:500]}
            raise APIError(
                "ENGINE_ERROR",
                "Connect|API Engine rejeitou a operação.",
                response.status_code if response.status_code < 500 else 502,
                {"engine_status": response.status_code, "engine_response": detail},
            )
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return {"raw": response.text}

    async def health(self) -> dict[str, Any]:
        data = await self.request("GET", "/health")
        return data if isinstance(data, dict) else {"data": data}

    async def fetch_instances(self) -> Any:
        return await self.request("GET", "/instance/fetchInstances")

    async def create_instance(self, payload: dict[str, Any]) -> Any:
        return await self.request("POST", "/instance/create", json=payload)

    async def connection_state(self, instance_name: str) -> Any:
        return await self.request("GET", f"/instance/connectionState/{instance_name}")

    async def connect_instance(self, instance_name: str) -> Any:
        return await self.request("GET", f"/instance/connect/{instance_name}")

    async def restart_instance(self, instance_name: str) -> Any:
        return await self.request("POST", f"/instance/restart/{instance_name}", json={})

    async def logout_instance(self, instance_name: str) -> Any:
        return await self.request("DELETE", f"/instance/logout/{instance_name}")

    async def delete_instance(self, instance_name: str) -> Any:
        return await self.request("DELETE", f"/instance/delete/{instance_name}")

    async def templates(self, instance_name: str) -> Any:
        return await self.request("GET", f"/template/find/{instance_name}")

    async def create_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/template/create/{instance_name}", json=payload)

    async def edit_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/template/edit/{instance_name}", json=payload)

    async def delete_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("DELETE", f"/template/delete/{instance_name}", json=payload)

    async def template_capabilities(self, instance_name: str) -> Any:
        return await self.request("GET", f"/template/capabilities/{instance_name}")

    async def template_preview(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/template/preview/{instance_name}", json=payload)

    async def send_template(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/message/sendTemplate/{instance_name}", json=payload)

    async def send_text(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/message/sendText/{instance_name}", json=payload)

    async def actions(self, instance_name: str) -> Any:
        return await self.request("GET", f"/action/find/{instance_name}")

    async def create_action(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/action/create/{instance_name}", json=payload)

    async def execute_action(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/action/execute/{instance_name}", json=payload)

    async def delete_action(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("DELETE", f"/action/delete/{instance_name}", json=payload)

    async def recipes(self, instance_name: str) -> Any:
        return await self.request("GET", f"/recipe/find/{instance_name}")

    async def recipe_library(self) -> Any:
        return await self.request("GET", "/recipe/library")

    async def create_recipe(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/recipe/create/{instance_name}", json=payload)

    async def execute_recipe(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("POST", f"/recipe/execute/{instance_name}", json=payload)

    async def delete_recipe(self, instance_name: str, payload: dict[str, Any]) -> Any:
        return await self.request("DELETE", f"/recipe/delete/{instance_name}", json=payload)


connect_engine = ConnectEngineClient()
