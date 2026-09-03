from __future__ import annotations

from uuid import UUID

from app.core.errors import APIError
from app.schemas.auth import AuthUser


def accessible_company_ids(user: AuthUser) -> list[UUID] | None:
    """Retorna ``None`` para acesso irrestrito ou as empresas explicitamente permitidas."""
    if user.role == "TENANT_ADMIN" or "*" in user.permissions:
        return None
    try:
        return [UUID(value) for value in user.companies]
    except (TypeError, ValueError) as exc:
        raise APIError("INVALID_COMPANY_SCOPE", "Escopo de empresas do usuário é inválido.", 403) from exc


def ensure_company_access(user: AuthUser, company_id: UUID | str) -> None:
    allowed = accessible_company_ids(user)
    if allowed is None:
        return
    if UUID(str(company_id)) not in allowed:
        raise APIError("COMPANY_ACCESS_DENIED", "Usuário não possui acesso a esta empresa.", 403)
