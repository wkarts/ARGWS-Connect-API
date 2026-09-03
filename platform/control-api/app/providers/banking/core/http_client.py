from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx

from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.core.normalization import sanitize_mapping


@dataclass(frozen=True, slots=True)
class BankHTTPTimeouts:
    connect: float = 10.0
    read: float = 30.0
    write: float = 30.0
    pool: float = 10.0


class BankCircuitBreaker:
    def __init__(self, *, failure_threshold: int = 5, recovery_seconds: int = 30) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_seconds = recovery_seconds
        self.failures = 0
        self.opened_at: float | None = None

    def allow(self) -> bool:
        if self.opened_at is None:
            return True
        if time.monotonic() - self.opened_at >= self.recovery_seconds:
            self.failures = 0
            self.opened_at = None
            return True
        return False

    def success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.failure_threshold:
            self.opened_at = time.monotonic()


class BankHTTPClient:
    """Cliente HTTP financeiro com retry apenas quando semanticamente seguro."""

    def __init__(
        self,
        *,
        provider: str,
        base_url: str,
        allowed_hosts: Iterable[str],
        headers: dict[str, str] | None = None,
        cert: Any = None,
        verify: bool | str = True,
        timeouts: BankHTTPTimeouts | None = None,
        max_safe_attempts: int = 3,
    ) -> None:
        self.provider = provider
        self.base_url = base_url.rstrip("/")
        self.allowed_hosts = {item.lower() for item in allowed_hosts}
        self.max_safe_attempts = max(1, max_safe_attempts)
        self.breaker = BankCircuitBreaker()
        self._validate_url(self.base_url)
        timeout = timeouts or BankHTTPTimeouts()
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers or {},
            cert=cert,
            verify=verify,
            timeout=httpx.Timeout(
                connect=timeout.connect,
                read=timeout.read,
                write=timeout.write,
                pool=timeout.pool,
            ),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20, keepalive_expiry=30),
            follow_redirects=False,
        )

    def _validate_url(self, value: str) -> None:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or host not in self.allowed_hosts:
            raise BankProviderError(
                "BANK_INVALID_REQUEST",
                "Endpoint bancário fora da lista oficial permitida para o provider.",
                details={"host": host or "ausente"},
            )

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        value = response.headers.get("Retry-After")
        if not value:
            return None
        try:
            return max(0.0, float(value))
        except ValueError:
            try:
                return max(0.0, (parsedate_to_datetime(value) - __import__("datetime").datetime.now(__import__("datetime").UTC)).total_seconds())
            except Exception:
                return None

    @staticmethod
    def _safe(method: str, idempotency_key: str | None) -> bool:
        return method.upper() in {"GET", "HEAD", "OPTIONS"} or bool(idempotency_key)

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
    ) -> httpx.Response:
        if not self.breaker.allow():
            raise BankProviderError(
                "BANK_PROVIDER_UNAVAILABLE",
                "Circuit breaker do provider bancário está aberto.",
                correlation_id=correlation_id,
                retryable=True,
            )
        request_headers = dict(headers or {})
        if idempotency_key:
            request_headers.setdefault("Idempotency-Key", idempotency_key)
        if correlation_id:
            request_headers.setdefault("X-Correlation-ID", correlation_id)

        attempts = self.max_safe_attempts if self._safe(method, idempotency_key) else 1
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                response = await self.client.request(method, path, params=params, json=json, headers=request_headers)
            except httpx.TimeoutException as exc:
                self.breaker.failure()
                last_exc = exc
                if attempt >= attempts:
                    raise BankProviderError(
                        "BANK_REQUEST_TIMEOUT",
                        "Tempo limite excedido ao consultar o provider bancário.",
                        correlation_id=correlation_id,
                        retryable=True,
                    ) from exc
                await asyncio.sleep(min(10.0, (2 ** (attempt - 1)) + random.random()))
                continue
            except httpx.NetworkError as exc:
                self.breaker.failure()
                last_exc = exc
                if attempt >= attempts:
                    raise BankProviderError(
                        "BANK_PROVIDER_UNAVAILABLE",
                        "Provider bancário temporariamente indisponível.",
                        correlation_id=correlation_id,
                        retryable=True,
                    ) from exc
                await asyncio.sleep(min(10.0, (2 ** (attempt - 1)) + random.random()))
                continue

            if response.status_code < 400:
                self.breaker.success()
                return response

            retryable_status = response.status_code in {429, 502, 503, 504}
            if retryable_status and attempt < attempts:
                wait = self._retry_after(response)
                if wait is None:
                    wait = min(15.0, (2 ** (attempt - 1)) + random.random())
                await asyncio.sleep(wait)
                continue

            self.breaker.failure() if response.status_code >= 500 else None
            try:
                body = response.json()
            except ValueError:
                body = {"message": response.text[:1000]}
            provider_code = None
            if isinstance(body, dict):
                provider_code = str(body.get("code") or body.get("errorCode") or body.get("error") or "") or None
            code = (
                "BANK_RATE_LIMITED" if response.status_code == 429 else
                "BANK_AUTHENTICATION_FAILED" if response.status_code == 401 else
                "BANK_AUTHORIZATION_FAILED" if response.status_code == 403 else
                "BANK_RESOURCE_NOT_FOUND" if response.status_code == 404 else
                "BANK_INVALID_REQUEST" if response.status_code in {400, 409, 422} else
                "BANK_PROVIDER_UNAVAILABLE" if response.status_code >= 500 else
                "BANK_REJECTED_OPERATION"
            )
            raise BankProviderError(
                code,
                "O provider bancário recusou a operação.",
                provider_error_code=provider_code,
                provider_http_status=response.status_code,
                correlation_id=correlation_id,
                retryable=retryable_status,
                details={"response": sanitize_mapping(body)},
            )

        raise BankProviderError(
            "BANK_PROVIDER_UNAVAILABLE",
            "Provider bancário indisponível.",
            correlation_id=correlation_id,
            retryable=True,
            details={"exception": type(last_exc).__name__ if last_exc else None},
        )

    async def aclose(self) -> None:
        await self.client.aclose()

    async def __aenter__(self) -> BankHTTPClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()
