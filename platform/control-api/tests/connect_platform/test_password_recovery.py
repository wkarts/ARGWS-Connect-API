from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.schemas.auth import ResetPasswordRequest
from app.services.mail import InternalMailService
from app.services.password_recovery import generate_password_reset_token, hash_password_reset_token


def test_develop_environment_is_normalized() -> None:
    config = Settings(_env_file=None, app_env="develop")
    assert config.app_env == "development"


def test_password_reset_url_is_derived_from_control_plane() -> None:
    config = Settings(
        _env_file=None,
        public_scheme="https",
        control_plane_host="d.control.connect.argws.com.br",
    )
    service = InternalMailService(config)
    token = generate_password_reset_token()
    url = urlsplit(service.password_reset_link(token))
    assert f"{url.scheme}://{url.netloc}{url.path}" == (
        "https://d.control.connect.argws.com.br/reset-password"
    )
    assert parse_qs(url.query)["token"] == [token]


def test_only_sha256_of_reset_token_is_storable() -> None:
    first = generate_password_reset_token()
    second = generate_password_reset_token()
    assert first != second
    assert len(first) >= 32
    digest = hash_password_reset_token(first)
    assert len(digest) == 64
    assert first not in digest


def test_reset_password_confirmation_must_match() -> None:
    with pytest.raises(ValidationError):
        ResetPasswordRequest(
            token="x" * 64,
            password="SenhaForte-123!",
            password_confirmation="OutraSenha-123!",
        )


def test_enabled_smtp_requires_transport_and_sender() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, smtp_enabled=True)
