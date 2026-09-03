from __future__ import annotations

from hashlib import sha256


def compact_idempotency_key(value: str, max_length: int = 160) -> str:
    """Preserva chaves curtas e compacta chaves longas sem perder unicidade prática."""

    normalized = value.strip()
    if not normalized:
        raise ValueError("A chave de idempotência não pode ser vazia.")
    if len(normalized) <= max_length:
        return normalized
    digest = sha256(normalized.encode("utf-8")).hexdigest()
    prefix_length = max(0, max_length - len(digest) - 1)
    return f"{normalized[:prefix_length]}:{digest}"
