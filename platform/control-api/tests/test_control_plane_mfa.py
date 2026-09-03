from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.core.security import decode_token
from app.services.auth import AuthService
from app.services.mfa import PlatformMFAService


def test_control_tokens_carry_mfa_verification_state() -> None:
    pending = AuthService._token_pair(
        user_id=str(uuid4()),
        audience="control",
        role="PLATFORM_ADMIN",
        mfa_verified=False,
    )
    pending_access = decode_token(pending.access_token, "control", "access")
    pending_refresh = decode_token(pending.refresh_token, "control", "refresh")
    assert pending_access["mfa_verified"] is False
    assert pending_refresh["mfa_verified"] is False

    verified = AuthService._token_pair(
        user_id=str(uuid4()),
        audience="control",
        role="PLATFORM_SUPERADMIN",
        mfa_verified=True,
    )
    verified_access = decode_token(verified.access_token, "control", "access")
    verified_refresh = decode_token(verified.refresh_token, "control", "refresh")
    assert verified_access["mfa_verified"] is True
    assert verified_refresh["mfa_verified"] is True


@pytest.mark.asyncio
async def test_control_mfa_is_always_required_and_starts_in_setup(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid4(), email="admin@example.com")
    monkeypatch.setattr(PlatformMFAService, "state", AsyncMock(return_value=None))
    status = await PlatformMFAService.status(None, user, token_verified=False)  # type: ignore[arg-type]
    assert status == {
        "required": True,
        "enabled": False,
        "verified": False,
        "mode": "SETUP",
    }


@pytest.mark.asyncio
async def test_control_mfa_requires_verification_on_every_new_login(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid4(), email="admin@example.com")
    monkeypatch.setattr(
        PlatformMFAService,
        "state",
        AsyncMock(return_value=SimpleNamespace(totp_enabled=True)),
    )
    pending = await PlatformMFAService.status(None, user, token_verified=False)  # type: ignore[arg-type]
    verified = await PlatformMFAService.status(None, user, token_verified=True)  # type: ignore[arg-type]
    assert pending["required"] is True
    assert pending["enabled"] is True
    assert pending["verified"] is False
    assert pending["mode"] == "VERIFY"
    assert verified["verified"] is True
