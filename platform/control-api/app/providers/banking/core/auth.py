from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
from redis.asyncio import Redis

from app.providers.banking.core.errors import BankProviderError


@dataclass(frozen=True, slots=True)
class BankAuthMaterial:
    headers: dict[str, str]
    access_token_expires_at: float | None = None


class APIKeyAuth:
    def __init__(self, *, header_name: str, value: str, prefix: str = "") -> None:
        self.header_name = header_name
        self.value = value
        self.prefix = prefix

    async def material(self) -> BankAuthMaterial:
        if not self.value:
            raise BankProviderError("BANK_INVALID_CREDENTIALS", "Chave de API bancária não informada.")
        return BankAuthMaterial({self.header_name: f"{self.prefix}{self.value}"})


class BearerTokenAuth:
    def __init__(self, token: str) -> None:
        self.token = token

    async def material(self) -> BankAuthMaterial:
        if not self.token:
            raise BankProviderError("BANK_INVALID_CREDENTIALS", "Bearer token bancário não informado.")
        return BankAuthMaterial({"Authorization": f"Bearer {self.token}"})


class OAuth2ClientCredentials:
    """OAuth2 Client Credentials parametrizável, sem presumir contrato de banco.

    O provider informa explicitamente token URL, campos, scopes, forma de
    autenticação e formato do corpo. ``FORM`` permanece o default para preservar
    os providers existentes; providers documentados com JSON podem optar por
    ``body_mode="JSON"`` sem duplicar o fluxo OAuth.

    ``client_id_field`` e ``client_secret_field`` só afetam o modo ``BODY`` e
    permitem respeitar nomenclaturas oficiais de um provider sem alterar os
    drivers já existentes, que continuam usando ``client_id``/``client_secret``.
    """

    def __init__(
        self,
        *,
        provider: str,
        environment: str,
        token_url: str,
        allowed_hosts: set[str],
        client_id: str,
        client_secret: str,
        redis: Redis | None,
        scopes: tuple[str, ...] = (),
        client_auth: str = "BASIC",
        extra_form: dict[str, str] | None = None,
        body_mode: str = "FORM",
        client_id_field: str = "client_id",
        client_secret_field: str = "client_secret",
        timeout: float = 15.0,
        cert: Any = None,
        verify: bool | str = True,
    ) -> None:
        self.provider = provider
        self.environment = environment
        self.token_url = token_url
        self.allowed_hosts = {item.casefold() for item in allowed_hosts}
        self.client_id = client_id
        self.client_secret = client_secret
        self.redis = redis
        self.scopes = scopes
        self.client_auth = client_auth.upper()
        self.extra_form = extra_form or {}
        self.body_mode = body_mode.upper()
        self.client_id_field = client_id_field.strip() or "client_id"
        self.client_secret_field = client_secret_field.strip() or "client_secret"
        self.timeout = timeout
        self.cert = cert
        self.verify = verify
        self.cache_key = f"bank-auth:{provider}:{environment}:{__import__('hashlib').sha256(client_id.encode()).hexdigest()[:20]}"
        self.lock_key = f"{self.cache_key}:lock"
        self._validate_token_url()

    def _validate_token_url(self) -> None:
        parsed = urlparse(self.token_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.hostname.casefold() not in self.allowed_hosts:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "Endpoint OAuth bancário fora da allowlist oficial do provider.",
            )

    async def _cached(self) -> BankAuthMaterial | None:
        if self.redis is None:
            return None
        raw = await self.redis.get(self.cache_key)
        if not raw:
            return None
        try:
            data = json.loads(raw)
            expires_at = float(data["expires_at"])
            if expires_at - time.time() <= 30:
                return None
            return BankAuthMaterial(
                headers={"Authorization": f"Bearer {data['access_token']}"},
                access_token_expires_at=expires_at,
            )
        except Exception:
            return None

    async def _acquire_lock(self) -> bool:
        if self.redis is None:
            return True
        return bool(await self.redis.set(self.lock_key, "1", nx=True, ex=20))

    async def _release_lock(self) -> None:
        if self.redis is not None:
            await self.redis.delete(self.lock_key)

    async def _request_token(self) -> BankAuthMaterial:
        payload = {"grant_type": "client_credentials", **self.extra_form}
        if self.scopes:
            payload["scope"] = " ".join(self.scopes)
        auth: httpx.BasicAuth | None = None
        if self.client_auth == "BASIC":
            auth = httpx.BasicAuth(self.client_id, self.client_secret)
        elif self.client_auth == "BODY":
            payload[self.client_id_field] = self.client_id
            payload[self.client_secret_field] = self.client_secret
        else:
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                "Modo de autenticação do client credentials não foi configurado pelo provider.",
            )
        if self.body_mode not in {"FORM", "JSON"}:
            raise BankProviderError(
                "BANK_INVALID_CONFIGURATION",
                "Formato do corpo OAuth não foi configurado pelo provider.",
            )
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                cert=self.cert,
                verify=self.verify,
                follow_redirects=False,
            ) as client:
                if self.body_mode == "JSON":
                    response = await client.post(self.token_url, json=payload, auth=auth)
                else:
                    response = await client.post(self.token_url, data=payload, auth=auth)
        except httpx.TimeoutException as exc:
            raise BankProviderError("BANK_REQUEST_TIMEOUT", "Timeout ao obter token bancário.", retryable=True) from exc
        except httpx.NetworkError as exc:
            raise BankProviderError("BANK_PROVIDER_UNAVAILABLE", "Servidor de autenticação bancária indisponível.", retryable=True) from exc
        if response.status_code >= 400:
            raise BankProviderError(
                "BANK_AUTHENTICATION_FAILED",
                "O provider bancário recusou a autenticação da aplicação.",
                provider_http_status=response.status_code,
            )
        try:
            data = response.json()
            token = str(data["access_token"])
            expires_in = max(60, int(data.get("expires_in") or 300))
        except (ValueError, KeyError, TypeError) as exc:
            raise BankProviderError("BANK_RESPONSE_INVALID", "Resposta OAuth bancária inválida.") from exc
        expires_at = time.time() + expires_in
        if self.redis is not None:
            await self.redis.setex(
                self.cache_key,
                max(30, expires_in - 15),
                json.dumps({"access_token": token, "expires_at": expires_at}),
            )
        return BankAuthMaterial(
            headers={"Authorization": f"Bearer {token}"},
            access_token_expires_at=expires_at,
        )

    async def material(self) -> BankAuthMaterial:
        cached = await self._cached()
        if cached:
            return cached
        acquired = await self._acquire_lock()
        if not acquired and self.redis is not None:
            for _ in range(20):
                await asyncio.sleep(0.25)
                cached = await self._cached()
                if cached:
                    return cached
            acquired = await self._acquire_lock()
        if not acquired:
            raise BankProviderError(
                "BANK_PROVIDER_UNAVAILABLE",
                "Não foi possível coordenar a renovação da autenticação bancária.",
                retryable=True,
            )
        try:
            cached = await self._cached()
            return cached or await self._request_token()
        finally:
            await self._release_lock()
