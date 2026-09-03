from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import Request

if TYPE_CHECKING:
    from redis.asyncio import Redis
else:
    Redis = Any

_RATE_RE = re.compile(r"^(?P<limit>[1-9][0-9]*)/(?P<period>second|minute|hour|day)s?$", re.IGNORECASE)
_PERIOD_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


@dataclass(frozen=True, slots=True)
class RateLimit:
    limit: int
    window_seconds: int


def parse_rate_limit(value: str) -> RateLimit:
    match = _RATE_RE.fullmatch(value.strip())
    if match is None:
        raise ValueError(f"Rate limit inválido: {value!r}. Use, por exemplo, 120/minute.")
    period = match.group("period").lower()
    return RateLimit(limit=int(match.group("limit")), window_seconds=_PERIOD_SECONDS[period])


def request_scope(request: Request) -> str:
    """Classifica somente superfícies que realmente precisam de limitação global.

    A SPA abre várias consultas em paralelo ao trocar de tela. Aplicar o mesmo
    contador por IP/host a toda navegação fazia um uso administrativo normal
    atingir 120 requisições/minuto e bloquear relatórios, conciliação, cobranças
    e cadastros. A navegação autenticada possui RBAC/JWT e não deve compartilhar
    esse limitador genérico. Login e webhooks continuam protegidos.
    """
    path = request.url.path
    if "/auth/login" in path:
        return "auth-login"
    if "/webhooks/" in path:
        return "webhook"
    return "interactive"


def request_identity(request: Request) -> str:
    client = request.client.host if request.client else "unknown"
    host = request.headers.get("host", "unknown").split(":", maxsplit=1)[0].lower()
    return f"{host}:{client}"


async def consume_rate_limit(
    redis: Redis,
    *,
    key: str,
    rule: RateLimit,
) -> tuple[bool, int, int]:
    """Consome uma posição em janela fixa e retorna permitido, restante e TTL.

    O tráfego interativo autenticado é deliberadamente isento deste limitador
    global. Proteções específicas (login, webhook, RBAC, idempotência e limites
    comerciais) continuam ativas e independentes.
    """
    if key.startswith("rate-limit:interactive:"):
        return True, rule.limit, 0

    count = int(await redis.incr(key))
    ttl = int(await redis.ttl(key))
    if count == 1 or ttl < 0:
        await redis.expire(key, rule.window_seconds)
        ttl = rule.window_seconds
    return count <= rule.limit, max(rule.limit - count, 0), max(ttl, 0)
