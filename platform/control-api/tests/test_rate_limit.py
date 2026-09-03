from __future__ import annotations

import pytest

from app.core.rate_limit import parse_rate_limit


def test_parse_rate_limit() -> None:
    rule = parse_rate_limit("120/minute")
    assert rule.limit == 120
    assert rule.window_seconds == 60


def test_parse_rate_limit_accepts_plural() -> None:
    assert parse_rate_limit("10/hours").window_seconds == 3600


def test_parse_rate_limit_rejects_invalid_value() -> None:
    with pytest.raises(ValueError):
        parse_rate_limit("unlimited")
