from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from typing import Any


_SENSITIVE_KEYS = {
    "authorization", "access_token", "refresh_token", "client_secret", "api_key",
    "private_key", "certificate", "certificate_password", "password", "secret",
}


def money(value: Decimal | str | int) -> Decimal:
    if isinstance(value, float):
        raise TypeError("Valores financeiros não podem ser construídos a partir de float.")
    return Decimal(value).quantize(Decimal("0.01"))


def decimal_json(value: Decimal) -> str:
    """Serializa valores monetários como string decimal, preservando precisão."""
    return format(value, "f")


def digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def masked_tax_id(value: str | None) -> str | None:
    raw = digits(value)
    if not raw:
        return None
    if len(raw) <= 4:
        return "*" * len(raw)
    return "*" * (len(raw) - 4) + raw[-4:]


def sanitize_mapping(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if any(marker in lowered for marker in _SENSITIVE_KEYS):
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = sanitize_mapping(item)
        return result
    if isinstance(value, list):
        return [sanitize_mapping(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_mapping(item) for item in value]
    if isinstance(value, Decimal):
        return decimal_json(value)
    return value


def request_hash(value: Any) -> str:
    payload = json.dumps(sanitize_mapping(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
