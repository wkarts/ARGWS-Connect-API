from __future__ import annotations

import asyncio
import hashlib
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator
from urllib.parse import urlparse

from app.providers.banking.core.auth import BankAuthMaterial, OAuth2ClientCredentials
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.banking.core.mtls import temporary_client_certificate
from app.providers.banking.providers.inter.constants import (
    INTER_ALLOWED_HOSTS,
    INTER_BASE_URLS,
    INTER_TOKEN_PATH,
)


class InterHTTPClient(BankHTTPClient):
    """Cliente HTTP do Inter sem headers privados da plataforma.

    A SDK oficial não publica ``Idempotency-Key`` nem ``X-Correlation-ID`` no
    contrato HTTP do Inter. Portanto esses metadados internos da Connect|API Platform não são
    transmitidos ao banco. Como consequência, escrita sem idempotência oficial
    também não recebe retry automático do ``BankHTTPClient``.
    """

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
        correlation_id: str | None = None,
    ):
        del idempotency_key, correlation_id
        return await super().request(
            method,
            path,
            params=params,
            json=json,
            headers=headers,
            idempotency_key=None,
            correlation_id=None,
        )


@dataclass(frozen=True, slots=True)
class InterCredentials:
    client_id: str
    client_secret: str
    certificate: str
    private_key: str
    current_account: str | None
    pix_key: str | None


_TOKEN_CACHE: dict[str, BankAuthMaterial] = {}
_TOKEN_LOCKS: dict[str, asyncio.Lock] = {}
_TOKEN_CACHE_GUARD = asyncio.Lock()


def parse_inter_credentials(credentials: dict[str, Any]) -> InterCredentials:
    values = {
        key: str(credentials.get(key) or "").strip()
        for key in (
            "client_id",
            "client_secret",
            "certificate",
            "private_key",
            "current_account",
            "pix_key",
        )
    }
    required = ("client_id", "client_secret", "certificate", "private_key")
    missing = [key for key in required if not values[key]]
    if missing:
        raise BankProviderError(
            "BANK_INVALID_CREDENTIALS",
            "Credenciais Banco Inter incompletas.",
            details={"missing_fields": missing},
        )
    return InterCredentials(
        client_id=values["client_id"],
        client_secret=values["client_secret"],
        certificate=values["certificate"],
        private_key=values["private_key"],
        current_account=values["current_account"] or None,
        pix_key=values["pix_key"] or None,
    )


def inter_base_url(environment: str) -> str:
    normalized = environment.strip().upper()
    base_url = INTER_BASE_URLS.get(normalized)
    if base_url is None:
        raise BankProviderError(
            "BANK_INVALID_REQUEST",
            "O provider Banco Inter aceita SANDBOX, HOMOLOGATION ou PRODUCTION.",
            details={"environment": normalized},
        )
    return base_url


def _cache_key(environment: str, parsed: InterCredentials, scopes: tuple[str, ...]) -> str:
    # Segredos não são persistidos no cache key em claro; o hash também faz a
    # rotação de client_secret invalidar material antigo do mesmo client_id.
    payload = "\x1f".join(
        (
            environment.upper(),
            parsed.client_id,
            parsed.client_secret,
            " ".join(sorted(scopes)),
        )
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _usable(material: BankAuthMaterial | None) -> bool:
    if material is None:
        return False
    expires_at = material.access_token_expires_at
    return expires_at is None or expires_at - time.time() > 60


async def _material(
    *,
    environment: str,
    parsed: InterCredentials,
    scopes: tuple[str, ...],
    token_url: str,
    host: str,
    cert: Any,
) -> BankAuthMaterial:
    key = _cache_key(environment, parsed, scopes)
    cached = _TOKEN_CACHE.get(key)
    if _usable(cached):
        return cached  # type: ignore[return-value]

    async with _TOKEN_CACHE_GUARD:
        lock = _TOKEN_LOCKS.setdefault(key, asyncio.Lock())
    async with lock:
        cached = _TOKEN_CACHE.get(key)
        if _usable(cached):
            return cached  # type: ignore[return-value]
        auth = OAuth2ClientCredentials(
            provider="INTER",
            environment=environment.strip().upper(),
            token_url=token_url,
            allowed_hosts={host},
            client_id=parsed.client_id,
            client_secret=parsed.client_secret,
            redis=None,
            scopes=scopes,
            client_auth="BODY",
            body_mode="FORM",
            cert=cert,
        )
        material = await auth.material()
        _TOKEN_CACHE[key] = material
        return material


@asynccontextmanager
async def inter_http_client(
    *,
    environment: str,
    credentials: dict[str, Any],
    scopes: tuple[str, ...],
    correlation_id: str | None = None,
) -> AsyncIterator[tuple[InterHTTPClient, InterCredentials]]:
    del correlation_id
    parsed = parse_inter_credentials(credentials)
    base_url = inter_base_url(environment)
    host = (urlparse(base_url).hostname or "").casefold()
    if host not in INTER_ALLOWED_HOSTS:
        raise BankProviderError(
            "BANK_INVALID_CONFIGURATION",
            "Host de ambiente Banco Inter fora da allowlist oficial.",
            details={"host": host},
        )

    token_url = f"{base_url}{INTER_TOKEN_PATH}"
    async with temporary_client_certificate(
        parsed.certificate,
        parsed.private_key,
        prefix="connect-api-inter",
    ) as cert:
        # Contrato oficial inter-co/pj-sdk-python/TokenUtils.py:
        # client_id/client_secret no corpo FORM + grant_type + scope + mTLS.
        material = await _material(
            environment=environment,
            parsed=parsed,
            scopes=scopes,
            token_url=token_url,
            host=host,
            cert=cert,
        )
        headers = {
            **material.headers,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Connect-API-Platform/1.0",
        }
        if parsed.current_account:
            headers["x-conta-corrente"] = parsed.current_account

        async with InterHTTPClient(
            provider="INTER",
            base_url=base_url,
            allowed_hosts=INTER_ALLOWED_HOSTS,
            headers=headers,
            cert=cert,
        ) as client:
            yield client, parsed
