from __future__ import annotations

from uuid import uuid4

import pytest

from app.core.authorization import accessible_company_ids, ensure_company_access
from app.core.errors import APIError
from app.schemas.auth import AuthUser


def user(*companies: str, role: str = "FINANCE_OPERATOR", permissions: list[str] | None = None) -> AuthUser:
    return AuthUser(
        id=str(uuid4()),
        name="Operador",
        email="operador@example.com",
        role=role,
        permissions=permissions or ["receivables.read"],
        companies=list(companies),
    )


def test_tenant_admin_has_unrestricted_company_scope() -> None:
    assert accessible_company_ids(user(role="TENANT_ADMIN")) is None


def test_explicit_company_scope_is_enforced() -> None:
    allowed = uuid4()
    denied = uuid4()
    current = user(str(allowed))
    ensure_company_access(current, allowed)
    with pytest.raises(APIError) as error:
        ensure_company_access(current, denied)
    assert error.value.code == "COMPANY_ACCESS_DENIED"


def test_wildcard_permission_is_unrestricted() -> None:
    assert accessible_company_ids(user(permissions=["*"])) is None
