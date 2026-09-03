from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import app.services.notifications as notifications_module
from app.models.tenant import Notification
from app.services.landing_builder import sanitize_css, sanitize_document
from app.services.notifications import NotificationService


def test_landing_builder_sanitizes_html_and_css() -> None:
    document = {
        "schema_version": 1,
        "meta": {"brand_name": "Financeiro"},
        "theme": {},
        "blocks": [
            {
                "id": "html-1",
                "type": "html",
                "name": "HTML",
                "props": {
                    "html": (
                        '<div onclick="alert(1)">Seguro</div>'
                        '<script>alert(2)</script>'
                        '<a href="javascript:alert(3)">link</a>'
                    )
                },
                "style": {},
            }
        ],
    }

    cleaned = sanitize_document(document)
    html = str(cleaned["blocks"][0]["props"]["html"])
    assert "<script" not in html.lower()
    assert "onclick=" not in html.lower()
    assert "javascript:" not in html.lower()

    css = sanitize_css(".a{color:red} .b{width:expression(alert(1));background:url(javascript:x)}")
    assert "expression(" not in css.lower()
    assert "javascript:" not in css.lower()


def test_whatsapp_external_override_requires_explicit_delivery_mode() -> None:
    assert NotificationService._uses_external_whatsapp(None) is False
    assert NotificationService._uses_external_whatsapp(SimpleNamespace(public_config={})) is False
    assert NotificationService._uses_external_whatsapp(
        SimpleNamespace(public_config={"base_url": "https://legacy.example"})
    ) is False
    assert NotificationService._uses_external_whatsapp(
        SimpleNamespace(public_config={"delivery_mode": "EXTERNAL"})
    ) is True


@pytest.mark.asyncio
async def test_tenant_whatsapp_defaults_to_platform_managed_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regressão do incidente em que o tenant enviava para `connect-api-platform`.

    A configuração EVOLUTION legada do tenant não pode substituir implicitamente
    a instância exclusiva criada pelo Control Plane. Somente `delivery_mode=EXTERNAL`
    pode desviar o envio do serviço gerenciado.
    """
    session = SimpleNamespace(commit=AsyncMock())
    service = NotificationService(session)  # type: ignore[arg-type]

    monkeypatch.setattr(
        service,
        "_integration",
        AsyncMock(return_value=SimpleNamespace(public_config={}, encrypted_secrets="")),
    )
    monkeypatch.setattr(service, "_emitting_company", AsyncMock(return_value=None))

    send_text = AsyncMock(return_value=SimpleNamespace(external_id="msg-managed-1"))
    provider = SimpleNamespace(
        connection_snapshot=AsyncMock(return_value={"state": "CONNECTED", "session_exists": True}),
        send_text=send_text,
    )
    managed = SimpleNamespace(provider=provider, instance="connect-api-demo-tenant123")

    monkeypatch.setattr(
        notifications_module,
        "get_tenant_context",
        lambda: SimpleNamespace(
            tenant_id=uuid4(),
            slug="demo",
            storage_bucket="connect-api-tenant-demo",
        ),
    )
    managed_whatsapp = AsyncMock(return_value=managed)
    monkeypatch.setattr(notifications_module, "managed_whatsapp", managed_whatsapp)

    destination = "5575988449231"
    notification = Notification(
        channel="WHATSAPP",
        provider="WHATSAPP",
        destination=destination,
        body="Mensagem de teste",
        status="PENDING",
        attempts=0,
        scheduled_at=datetime.now(UTC),
        idempotency_key="rc24-managed-whatsapp-test",
    )

    await service.dispatch(notification)

    managed_whatsapp.assert_awaited_once()
    send_text.assert_awaited_once_with(destination, "Mensagem de teste")
    assert notification.provider == "EVOLUTION_MANAGED"
    assert notification.external_id == "msg-managed-1"
    assert notification.status == "SENT"
