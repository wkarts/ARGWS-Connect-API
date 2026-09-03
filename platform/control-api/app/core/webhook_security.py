from __future__ import annotations

from datetime import UTC, datetime


def parse_webhook_timestamp(value: str) -> datetime:
    """Aceita epoch em segundos/milisegundos ou ISO-8601 e normaliza em UTC."""

    raw = value.strip()
    if not raw:
        raise ValueError("timestamp ausente")
    try:
        number = float(raw)
    except ValueError:
        normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    if number > 10_000_000_000:  # epoch em milissegundos
        number /= 1000
    return datetime.fromtimestamp(number, tz=UTC)


def validate_webhook_timestamp(
    value: str,
    *,
    max_age_seconds: int,
    now: datetime | None = None,
) -> None:
    """Valida frescor quando o provedor envia ``X-Webhook-Timestamp``.

    O cabeçalho é opcional para manter compatibilidade com providers que não o
    suportam. Quando presente, payloads muito antigos ou excessivamente futuros
    são rejeitados antes de qualquer efeito financeiro.
    """

    if not value.strip():
        return
    instant = parse_webhook_timestamp(value)
    reference = (now or datetime.now(UTC)).astimezone(UTC)
    if abs((reference - instant).total_seconds()) > max_age_seconds:
        raise ValueError("timestamp fora da janela permitida")
