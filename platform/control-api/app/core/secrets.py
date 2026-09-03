from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.errors import APIError


def _derive_key() -> bytes:
    if settings.field_encryption_key:
        value = settings.field_encryption_key.encode("utf-8")
        try:
            Fernet(value)
            return value
        except (ValueError, TypeError):
            pass
    digest = hashlib.sha256(settings.app_secret_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


class SecretCipher:
    def __init__(self) -> None:
        self._fernet = Fernet(_derive_key())

    def encrypt(self, value: str) -> str:
        if not value:
            return ""
        return self._fernet.encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, value: str) -> str:
        if not value:
            return ""
        try:
            return self._fernet.decrypt(value.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise APIError("SECRET_DECRYPTION_FAILED", "Não foi possível descriptografar um segredo.", 500) from exc


secret_cipher = SecretCipher()
