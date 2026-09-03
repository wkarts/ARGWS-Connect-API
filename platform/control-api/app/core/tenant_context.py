from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TenantContext:
    tenant_id: str
    slug: str
    database: str
    database_user: str
    database_password: str
    storage_bucket: str
    hostname: str
    timezone: str = "America/Bahia"
    credential_version: int = 1


_current_tenant: ContextVar[TenantContext | None] = ContextVar("current_tenant", default=None)


def set_tenant_context(context: TenantContext) -> Token[TenantContext | None]:
    return _current_tenant.set(context)


def reset_tenant_context(token: Token[TenantContext | None]) -> None:
    _current_tenant.reset(token)


def get_tenant_context() -> TenantContext:
    context = _current_tenant.get()
    if context is None:
        raise RuntimeError("TenantContext não definido para esta execução.")
    return context
