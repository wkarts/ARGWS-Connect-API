from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from jinja2 import UndefinedError

from app.services.collection_rules import (
    default_notification_rule_events,
    default_notification_templates,
    format_brl,
    normalize_destination,
    offset_matches,
    render_notification_template,
    validate_rule_events,
)


def test_default_collection_rule_has_templates_for_every_channel() -> None:
    available = {(item["code"], item["channel"]) for item in default_notification_templates()}
    for event in default_notification_rule_events():
        for channel in event["channels"]:
            assert (event["template"], channel) in available


def test_offset_semantics_cover_before_due_and_overdue() -> None:
    today = date(2026, 8, 20)
    assert offset_matches(today, date(2026, 8, 27), -7)
    assert offset_matches(today, date(2026, 8, 20), 0)
    assert offset_matches(today, date(2026, 8, 19), 1)
    assert not offset_matches(today, date(2026, 8, 21), 1)


def test_rule_validation_normalizes_and_rejects_invalid_channels() -> None:
    assert validate_rule_events([
        {"offset_days": -1, "channels": ["email", "WHATSAPP", "email"], "template": "due_tomorrow"}
    ]) == [{"offset_days": -1, "channels": ["EMAIL", "WHATSAPP"], "template": "DUE_TOMORROW"}]
    with pytest.raises(ValueError, match="não suportado"):
        validate_rule_events([{"offset_days": 0, "channels": ["SMS"], "template": "DUE_TODAY"}])


def test_destination_normalization_is_deterministic() -> None:
    assert normalize_destination("EMAIL", " Financeiro@Example.COM ") == "financeiro@example.com"
    assert normalize_destination("WHATSAPP", "(75) 99999-9999") == "5575999999999"
    assert normalize_destination("WHATSAPP", "+55 75 99999-9999") == "5575999999999"
    assert normalize_destination("EMAIL", "invalido") is None


def test_template_rendering_and_currency_format() -> None:
    context = {"cliente": {"nome": "Empresa Teste"}, "cobranca": {"valor": "R$ 1.621,00"}}
    assert render_notification_template("Olá {{ cliente.nome }}: {{ cobranca.valor }}", context) == (
        "Olá Empresa Teste: R$ 1.621,00"
    )
    assert format_brl(Decimal("1621")) == "R$ 1.621,00"
    with pytest.raises(UndefinedError):
        render_notification_template("{{ campo.inexistente }}", context)


def test_long_idempotency_key_is_compacted_without_losing_determinism() -> None:
    from app.core.idempotency import compact_idempotency_key

    source = "collection:" + "x" * 400
    first = compact_idempotency_key(source)
    second = compact_idempotency_key(source)
    assert first == second
    assert len(first) == 160
    assert compact_idempotency_key("short-key") == "short-key"
