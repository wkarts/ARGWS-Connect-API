from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.errors import APIError


_CANONICAL_SEND_TEXT_PATH = "/message/sendText/{instance}"


@dataclass(frozen=True, slots=True)
class EvolutionConfig:
    base_url: str
    api_key: str
    instance: str
    send_text_path: str = _CANONICAL_SEND_TEXT_PATH
    send_media_path: str = "/message/sendMedia/{instance}"
    create_path: str = "/instance/create"
    connect_path: str = "/instance/connect/{instance}"
    logout_path: str = "/instance/logout/{instance}"
    restart_path: str = "/instance/restart/{instance}"
    delete_path: str = "/instance/delete/{instance}"
    state_path: str = "/instance/connectionState/{instance}"
    fetch_instances_path: str = "/instance/fetchInstances"
    timeout: int = 30


@dataclass(frozen=True, slots=True)
class EvolutionMessageResult:
    external_id: str | None
    status: str
    raw: dict[str, Any]


class EvolutionWhatsAppProvider:
    """Adapter interno do serviço de WhatsApp com preservação da sessão vinculada."""

    def __init__(self, config: EvolutionConfig) -> None:
        self.config = config

    def _url(self, path: str) -> str:
        resolved = path.format(instance=self.config.instance)
        return f"{self.config.base_url.rstrip('/')}/{resolved.lstrip('/')}"

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.config.api_key,
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

    @classmethod
    def _provider_message(cls, value: object) -> str | None:
        """Extrai uma mensagem segura do corpo remoto sem expor headers/credenciais."""
        if isinstance(value, str):
            text = value.strip()
            return text[:800] if text else None
        if isinstance(value, list):
            parts = [cls._provider_message(item) for item in value]
            joined = " · ".join(part for part in parts if part)
            return joined[:800] or None
        if isinstance(value, dict):
            for key in ("message", "error", "detail", "details"):
                if key in value:
                    message = cls._provider_message(value[key])
                    if message:
                        return message
            if "response" in value:
                message = cls._provider_message(value["response"])
                if message:
                    return message
        return None

    async def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        params: dict[str, str] | None = None,
        allow_not_found: bool = False,
    ) -> dict[str, Any]:
        if not self.config.base_url or not self.config.api_key:
            raise APIError("WHATSAPP_NOT_CONFIGURED", "Serviço de WhatsApp não configurado pela plataforma.", 424)
        async with httpx.AsyncClient(timeout=self.config.timeout) as client:
            response = await client.request(method, self._url(path), headers=self._headers(), json=payload, params=params)
        if allow_not_found and response.status_code == 404:
            return {"not_found": True, "status_code": 404}
        try:
            data = response.json() if response.content else {"ok": True}
        except ValueError:
            data = {"raw": response.text[:800]}
        if response.status_code >= 400:
            provider_message = self._provider_message(data)
            details: dict[str, Any] = {
                "status_code": response.status_code,
                "operation": path.split("/")[1] if "/" in path else path,
                "path": path,
            }
            if provider_message:
                details["provider_message"] = provider_message
            raise APIError(
                "WHATSAPP_SERVICE_ERROR",
                "O serviço de WhatsApp recusou a operação solicitada.",
                424,
                details,
            )
        return dict(data) if isinstance(data, dict) else {"data": data}

    async def connection_status(self, *, allow_not_found: bool = False) -> dict[str, Any]:
        return await self._request("GET", self.config.state_path, allow_not_found=allow_not_found)

    def _matching_instance_payload(self, raw: dict[str, Any]) -> dict[str, Any]:
        expected = self.config.instance.casefold()
        top = raw.get("data", raw)
        candidates: list[dict[str, Any]] = []
        if isinstance(top, list):
            candidates = [item for item in top if isinstance(item, dict)]
        elif isinstance(top, dict):
            candidates = [top]
        for item in candidates:
            names: list[object] = [item.get("instanceName"), item.get("instance_name"), item.get("name")]
            nested = item.get("instance")
            if isinstance(nested, dict):
                names.extend([nested.get("instanceName"), nested.get("instance_name"), nested.get("name")])
            if any(isinstance(name, str) and name.casefold() == expected for name in names):
                return item
        if len(candidates) == 1:
            return candidates[0]
        return {}

    async def instance_information(self, *, allow_not_found: bool = True) -> dict[str, Any]:
        raw = await self._request(
            "GET",
            self.config.fetch_instances_path,
            params={"instanceName": self.config.instance},
            allow_not_found=allow_not_found,
        )
        if raw.get("not_found"):
            return raw
        return self._matching_instance_payload(raw)

    @staticmethod
    def _walk_strings(value: object) -> list[tuple[str, str]]:
        result: list[tuple[str, str]] = []

        def walk(item: object) -> None:
            if isinstance(item, dict):
                for key, nested in item.items():
                    if isinstance(nested, str) and nested.strip():
                        result.append((str(key).lower(), nested.strip()))
                    walk(nested)
            elif isinstance(item, list):
                for nested in item:
                    walk(nested)

        walk(value)
        return result

    @classmethod
    def _state_from(cls, value: object) -> str | None:
        state_keys = {"state", "status", "connectionstatus", "connection_status"}
        mapping = {
            "OPEN": "CONNECTED",
            "CONNECTED": "CONNECTED",
            "ONLINE": "CONNECTED",
            "CONNECTING": "CONNECTING",
            "PAIRING": "CONNECTING",
            "QR": "PAIRING",
            "CLOSE": "DISCONNECTED",
            "CLOSED": "DISCONNECTED",
            "DISCONNECTED": "DISCONNECTED",
        }
        for key, text in cls._walk_strings(value):
            if key in state_keys:
                normalized = text.upper()
                if normalized in mapping:
                    return mapping[normalized]
        return None

    @classmethod
    def _has_linked_identity(cls, value: object) -> bool:
        identity_keys = {"ownerjid", "owner_jid", "number", "wid", "jid"}
        for key, text in cls._walk_strings(value):
            if key in identity_keys and text and text not in {"null", "undefined"}:
                return True
        return False

    async def connection_snapshot(self) -> dict[str, Any]:
        status = await self.connection_status(allow_not_found=True)
        try:
            information = await self.instance_information(allow_not_found=True)
        except APIError:
            information = {}
        status_missing = bool(status.get("not_found"))
        info_missing = bool(information.get("not_found")) or not information
        state_status = None if status_missing else self._state_from(status)
        state_info = None if info_missing else self._state_from(information)
        connected = "CONNECTED" in {state_status, state_info}

        # Algumas versões da Evolution confirmam a sessão somente pelo
        # connectionState e omitem ownerJid/number no fetchInstances filtrado.
        # Um estado remoto OPEN/CONNECTED é evidência mais forte de sessão ativa
        # do que a ausência desses campos de inventário. Sem isso, o Control
        # Plane envia normalmente, mas o tenant produz um falso
        # WHATSAPP_NOT_CONNECTED antes de sequer chamar sendText.
        session_exists = self._has_linked_identity(information) or connected

        if connected:
            state = "CONNECTED"
        elif state_status == "CONNECTING" or state_info == "CONNECTING":
            state = "RECONNECTING" if session_exists else "CONNECTING"
        elif session_exists:
            state = "RECONNECTING"
        elif status_missing and info_missing:
            state = "NOT_CREATED"
        else:
            state = state_status or state_info or "DISCONNECTED"
        return {
            "state": state,
            "session_exists": session_exists,
            "instance_exists": not (status_missing and info_missing),
            "status": status,
            "information": information,
        }

    async def create_instance(self) -> dict[str, Any]:
        snapshot = await self.connection_snapshot()
        if snapshot["instance_exists"]:
            return {"created": False, "snapshot": snapshot}
        created = await self._request(
            "POST",
            self.config.create_path,
            {"instanceName": self.config.instance, "qrcode": True, "integration": "WHATSAPP-BAILEYS"},
        )
        return {"created": True, "create": created}

    async def ensure_instance(self) -> dict[str, Any]:
        return await self.create_instance()

    async def connect_instance(self, phone: str | None = None) -> dict[str, Any]:
        snapshot = await self.connection_snapshot()
        if snapshot["state"] == "CONNECTED":
            return {"already_connected": True, "snapshot": snapshot}
        if snapshot["session_exists"]:
            restarted = await self._request("PUT", self.config.restart_path)
            return {"session_preserved": True, "restart": restarted, "snapshot": await self.connection_snapshot()}
        if not snapshot["instance_exists"]:
            await self.create_instance()
        normalized_phone = "".join(char for char in str(phone or "") if char.isdigit()) or None
        connection = await self._request(
            "GET",
            self.config.connect_path,
            params={"number": normalized_phone} if normalized_phone else None,
        )
        return {"connection": connection, "snapshot": await self.connection_snapshot()}

    async def restart_instance(self) -> dict[str, Any]:
        snapshot = await self.connection_snapshot()
        if not snapshot["instance_exists"]:
            await self.create_instance()
        result = await self._request("PUT", self.config.restart_path)
        return {"restart": result, "snapshot": await self.connection_snapshot()}

    async def logout_instance(self) -> dict[str, Any]:
        snapshot = await self.connection_snapshot()
        if not snapshot["instance_exists"]:
            return {"not_found": True}
        result = await self._request("DELETE", self.config.logout_path)
        return {"logout": result, "snapshot": await self.connection_snapshot()}

    async def disconnect_instance(self) -> dict[str, Any]:
        return await self.logout_instance()

    async def delete_instance(self) -> dict[str, Any]:
        snapshot = await self.connection_snapshot()
        if not snapshot["instance_exists"]:
            return {"deleted": True, "not_found": True}
        result = await self._request("DELETE", self.config.delete_path)
        return {"deleted": True, "result": result}

    @staticmethod
    def _schema_rejection(exc: APIError) -> bool:
        status_code = int(exc.details.get("status_code") or 0)
        if status_code not in {400, 422}:
            return False
        message = str(exc.details.get("provider_message") or "").casefold()
        return any(marker in message for marker in ("textmessage", "text message", "property text", "field text", "text is required"))

    async def _send_text_on_path(self, path: str, number: str, text: str) -> dict[str, Any]:
        # Este é o contrato comprovadamente utilizado pelo Scheduler Pro com a
        # mesma família de integração Evolution: number + textMessage.text.
        compatible = {"number": number, "textMessage": {"text": text}}
        try:
            return await self._request("POST", path, compatible)
        except APIError as exc:
            # Algumas versões mais novas aceitam o texto no topo. Só alternamos
            # schema quando a API rejeita explicitamente a validação antes do envio.
            # Não repetimos em timeout/5xx para evitar duplicidade de mensagem.
            if not self._schema_rejection(exc):
                raise
            modern = {"number": number, "text": text}
            return await self._request("POST", path, modern)

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=1, max=15),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
        reraise=True,
    )
    async def send_text(self, number: str, text: str) -> EvolutionMessageResult:
        configured = (self.config.send_text_path or _CANONICAL_SEND_TEXT_PATH).strip() or _CANONICAL_SEND_TEXT_PATH
        paths = list(dict.fromkeys([configured, _CANONICAL_SEND_TEXT_PATH]))
        data: dict[str, Any] | None = None
        last_error: APIError | None = None

        for index, path in enumerate(paths):
            try:
                data = await self._send_text_on_path(path, number, text)
                break
            except APIError as exc:
                last_error = exc
                # 404 é seguro para tentar a rota canônica alternativa: a chamada
                # não encontrou o endpoint configurado e portanto não aceitou envio.
                status_code = int(exc.details.get("status_code") or 0)
                if status_code == 404 and index + 1 < len(paths):
                    continue
                raise

        if data is None:
            if last_error is not None:
                raise last_error
            raise APIError("WHATSAPP_SEND_FAILED", "Não foi possível enviar a mensagem pelo WhatsApp.", 424)

        external_id = (
            data.get("key", {}).get("id")
            or data.get("message", {}).get("key", {}).get("id")
            or data.get("id")
        )
        return EvolutionMessageResult(external_id=external_id, status="SENT", raw=data)

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=1, max=15),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
        reraise=True,
    )
    async def send_media(
        self,
        number: str,
        media_url: str,
        *,
        caption: str = "",
        filename: str = "documento.pdf",
    ) -> EvolutionMessageResult:
        payload = {
            "number": number,
            "mediatype": "document",
            "mimetype": "application/pdf",
            "caption": caption,
            "media": media_url,
            "fileName": filename,
        }
        data = await self._request("POST", self.config.send_media_path, payload)
        external_id = data.get("key", {}).get("id") or data.get("id")
        return EvolutionMessageResult(external_id=external_id, status="SENT", raw=data)

    async def health(self) -> dict[str, Any]:
        return await self.connection_snapshot()
