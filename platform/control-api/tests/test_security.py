from __future__ import annotations

from uuid import uuid4

import pytest

from app.core.errors import APIError
from app.core.security import create_token, decode_token, generate_api_key, hash_api_key, hash_password, verify_password
from app.core.secrets import secret_cipher


def test_password_hash_and_verify() -> None:
    value = "Senha-Muito-Segura-2026!"
    encoded = hash_password(value)
    assert encoded != value
    assert verify_password(value, encoded)
    assert not verify_password("senha-incorreta", encoded)


def test_password_minimum_length_is_enforced() -> None:
    with pytest.raises(APIError) as error:
        hash_password("curta")
    assert error.value.code == "PASSWORD_TOO_SHORT"


def test_tokens_are_audience_scoped() -> None:
    subject = str(uuid4())
    tenant_id = str(uuid4())
    token = create_token(subject=subject, audience="tenant", token_type="access", tenant_id=tenant_id)
    decoded = decode_token(token, "tenant")
    assert decoded["sub"] == subject
    assert decoded["tenant_id"] == tenant_id
    with pytest.raises(APIError) as error:
        decode_token(token, "control")
    assert error.value.code == "INVALID_TOKEN"


def test_api_key_is_returned_only_once_and_stored_as_hash() -> None:
    raw, digest = generate_api_key()
    assert raw.startswith("fin_")
    assert digest == hash_api_key(raw)
    assert raw != digest


def test_secret_cipher_round_trip() -> None:
    secret = "segredo-bancario-que-nao-pode-ficar-em-texto-puro"
    encrypted = secret_cipher.encrypt(secret)
    assert encrypted != secret
    assert secret_cipher.decrypt(encrypted) == secret
