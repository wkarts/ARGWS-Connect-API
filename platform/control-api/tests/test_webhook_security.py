from datetime import UTC, datetime, timedelta

import pytest

from app.core.webhook_security import parse_webhook_timestamp, validate_webhook_timestamp


def test_parse_epoch_milliseconds() -> None:
    parsed = parse_webhook_timestamp("1760000000000")
    assert parsed.tzinfo is not None
    assert int(parsed.timestamp()) == 1_760_000_000


def test_optional_timestamp_is_accepted() -> None:
    validate_webhook_timestamp("", max_age_seconds=300)


def test_stale_timestamp_is_rejected() -> None:
    now = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)
    with pytest.raises(ValueError):
        validate_webhook_timestamp(
            (now - timedelta(minutes=6)).isoformat(),
            max_age_seconds=300,
            now=now,
        )
