from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import APIError


@dataclass(frozen=True, slots=True)
class DNSRecordResult:
    record_id: str
    name: str
    content: str
    proxied: bool
    record_type: str = "CNAME"


@dataclass(frozen=True, slots=True)
class CloudflareZoneResult:
    zone_id: str
    name: str
    status: str
    nameservers: list[str]
    paused: bool = False
    development_mode: int = 0


class CloudflareDNSProvider:
    base_url = "https://api.cloudflare.com/client/v4"

    def __init__(self) -> None:
        self.enabled = settings.cloudflare_enabled
        self.zone_id = settings.cloudflare_zone_id
        self.account_id = settings.cloudflare_account_id
        self.token = settings.cloudflare_api_token

    @property
    def configured(self) -> bool:
        """Compatibilidade com o runtime da zona principal da plataforma."""
        return bool(self.enabled and self.zone_id and self.token)

    @property
    def account_configured(self) -> bool:
        return bool(self.enabled and self.account_id and self.token)

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def _require_enabled(self) -> None:
        if not self.enabled or not self.token:
            raise APIError("CLOUDFLARE_NOT_CONFIGURED", "Cloudflare não está configurado na plataforma.", 503)

    def _zone(self, zone_id: str | None = None) -> str:
        value = (zone_id or self.zone_id).strip()
        if not value:
            raise APIError("CLOUDFLARE_ZONE_REQUIRED", "A zona Cloudflare não está definida.", 409)
        return value

    @staticmethod
    def _safe_errors(payload: object) -> list[dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        output: list[dict[str, Any]] = []
        for item in payload.get("errors") or []:
            if isinstance(item, dict):
                output.append({"code": item.get("code"), "message": str(item.get("message") or "")[:500]})
        return output[:20]

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: int = 30,
    ) -> dict[str, Any]:
        self._require_enabled()
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method,
                f"{self.base_url}/{path.lstrip('/')}",
                headers=self.headers,
                params=params,
                json=payload,
            )
        try:
            data = response.json() if response.content else {"success": response.status_code < 400}
        except ValueError:
            data = {"success": False, "errors": [{"message": "Resposta inválida do Cloudflare."}]}
        if response.status_code >= 400 or not data.get("success", False):
            raise APIError(
                "CLOUDFLARE_ERROR",
                "Cloudflare rejeitou a operação solicitada.",
                502 if response.status_code >= 500 else 409,
                {"status_code": response.status_code, "errors": self._safe_errors(data)},
            )
        return data

    @staticmethod
    def _zone_result(item: dict[str, Any]) -> CloudflareZoneResult:
        return CloudflareZoneResult(
            zone_id=str(item.get("id") or ""),
            name=str(item.get("name") or ""),
            status=str(item.get("status") or "unknown").upper(),
            nameservers=[str(value) for value in item.get("name_servers") or []],
            paused=bool(item.get("paused", False)),
            development_mode=int(item.get("development_mode") or 0),
        )

    async def list_zones(self, name: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"per_page": 50}
        if name:
            params["name"] = name.lower().strip().rstrip(".")
        if self.account_id:
            params["account.id"] = self.account_id
        data = await self._request("GET", "/zones", params=params)
        return [item for item in data.get("result") or [] if isinstance(item, dict)]

    async def ensure_zone(self, zone_name: str) -> CloudflareZoneResult:
        clean = zone_name.lower().strip().rstrip(".")
        zones = await self.list_zones(clean)
        exact = next((item for item in zones if str(item.get("name") or "").lower() == clean), None)
        if exact:
            return self._zone_result(exact)
        if not self.account_configured:
            raise APIError(
                "CLOUDFLARE_ACCOUNT_REQUIRED",
                "A conta Cloudflare precisa estar configurada para criar e administrar novas zonas.",
                409,
                {"zone": clean},
            )
        data = await self._request(
            "POST",
            "/zones",
            payload={"name": clean, "account": {"id": self.account_id}, "type": "full", "jump_start": True},
        )
        item = data.get("result") or {}
        if not isinstance(item, dict):
            raise APIError("CLOUDFLARE_ZONE_CREATE_FAILED", "Cloudflare não retornou a zona criada.", 502)
        return self._zone_result(item)

    async def zone_details(self, zone_id: str) -> dict[str, Any]:
        data = await self._request("GET", f"/zones/{self._zone(zone_id)}")
        item = data.get("result") or {}
        if not isinstance(item, dict):
            return {}
        return {
            "id": str(item.get("id") or ""),
            "name": str(item.get("name") or ""),
            "status": str(item.get("status") or "unknown").upper(),
            "paused": bool(item.get("paused", False)),
            "type": str(item.get("type") or ""),
            "name_servers": [str(value) for value in item.get("name_servers") or []],
            "original_name_servers": [str(value) for value in item.get("original_name_servers") or []],
            "development_mode": int(item.get("development_mode") or 0),
        }

    async def dnssec(self, zone_id: str) -> dict[str, Any]:
        data = await self._request("GET", f"/zones/{self._zone(zone_id)}/dnssec")
        item = data.get("result") or {}
        if not isinstance(item, dict):
            return {"status": "UNKNOWN"}
        return {
            "status": str(item.get("status") or "unknown").upper(),
            "ds": item.get("ds"),
            "digest": item.get("digest"),
            "digest_algorithm": item.get("digest_algorithm"),
            "algorithm": item.get("algorithm"),
            "key_tag": item.get("key_tag"),
        }

    async def enable_dnssec(self, zone_id: str) -> dict[str, Any]:
        data = await self._request("POST", f"/zones/{self._zone(zone_id)}/dnssec")
        item = data.get("result") or {}
        return item if isinstance(item, dict) else {"status": "UNKNOWN"}

    async def disable_dnssec(self, zone_id: str) -> None:
        await self._request("DELETE", f"/zones/{self._zone(zone_id)}/dnssec")

    async def list_records(
        self,
        hostname: str,
        record_type: str | None = None,
        *,
        zone_id: str | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"name": hostname.lower().strip().rstrip(".")}
        if record_type:
            params["type"] = record_type.upper()
        data = await self._request("GET", f"/zones/{self._zone(zone_id)}/dns_records", params=params)
        records = data.get("result", [])
        return [item for item in records if isinstance(item, dict)]

    async def upsert_record(
        self,
        hostname: str,
        content: str,
        *,
        record_type: str = "CNAME",
        proxied: bool | None = None,
        zone_id: str | None = None,
    ) -> DNSRecordResult:
        clean_name = hostname.lower().strip().rstrip(".")
        clean_content = content.strip().rstrip(".")
        desired_type = record_type.upper()
        proxied_value = settings.cloudflare_proxied if proxied is None else proxied
        resolved_zone = self._zone(zone_id)
        existing = await self.list_records(clean_name, zone_id=resolved_zone)
        same_type = next((item for item in existing if str(item.get("type", "")).upper() == desired_type), None)
        payload = {
            "type": desired_type,
            "name": clean_name,
            "content": clean_content,
            "proxied": proxied_value,
            "ttl": 1,
        }
        if same_type:
            record_id = str(same_type["id"])
            data = await self._request(
                "PUT", f"/zones/{resolved_zone}/dns_records/{record_id}", payload=payload
            )
        else:
            blockers = [
                item for item in existing
                if str(item.get("type", "")).upper() in {"A", "AAAA", "CNAME"}
            ]
            for blocker in blockers:
                await self.delete_record(str(blocker.get("id") or ""), zone_id=resolved_zone)
            data = await self._request("POST", f"/zones/{resolved_zone}/dns_records", payload=payload)
        item = data.get("result") or {}
        if not isinstance(item, dict):
            raise APIError("CLOUDFLARE_RECORD_FAILED", "Cloudflare não retornou o registro DNS.", 502)
        return DNSRecordResult(
            record_id=str(item.get("id") or ""),
            name=str(item.get("name") or clean_name),
            content=str(item.get("content") or clean_content),
            proxied=bool(item.get("proxied", False)),
            record_type=str(item.get("type") or desired_type),
        )

    async def upsert_cname(
        self,
        hostname: str,
        target: str,
        proxied: bool | None = None,
        *,
        zone_id: str | None = None,
    ) -> DNSRecordResult:
        return await self.upsert_record(
            hostname,
            target,
            record_type="CNAME",
            proxied=proxied,
            zone_id=zone_id,
        )

    async def ensure_managed_wildcard(self) -> DNSRecordResult:
        wildcard = f"*.{settings.tenant_domain_root}".lower().strip(".")
        platform = settings.platform_domain.lower().strip().rstrip(".")
        target = (settings.cloudflare_tenant_record_target or platform).lower().strip().rstrip(".")
        try:
            if target != platform:
                platform_records = await self.list_records(platform)
                source = next(
                    (
                        item
                        for record_type in ("A", "AAAA", "CNAME")
                        for item in platform_records
                        if str(item.get("type", "")).upper() == record_type
                    ),
                    None,
                )
                if source is None:
                    raise APIError(
                        "CLOUDFLARE_ORIGIN_NOT_FOUND",
                        "Não foi possível derivar a origem DNS do domínio principal para criar o wildcard.",
                        409,
                        {"hostname": platform},
                    )
                await self.upsert_record(
                    target,
                    str(source.get("content", "")),
                    record_type=str(source.get("type", "A")),
                    proxied=False,
                )
            return await self.upsert_cname(wildcard, target, proxied=False)
        except APIError as exc:
            details = exc.details if isinstance(exc.details, dict) else {}
            status_code = details.get("status_code")
            if settings.cloudflare_provisioning_mode == "wildcard" and status_code in {401, 403}:
                return DNSRecordResult(
                    record_id="",
                    name=wildcard,
                    content=target,
                    proxied=False,
                    record_type="EXTERNAL_WILDCARD",
                )
            raise

    async def delete_record(self, record_id: str, *, zone_id: str | None = None) -> None:
        if not record_id:
            return
        await self._request("DELETE", f"/zones/{self._zone(zone_id)}/dns_records/{record_id}")
