from __future__ import annotations

import pytest

from app.providers.evolution import EvolutionConfig, EvolutionWhatsAppProvider


@pytest.mark.asyncio
async def test_connected_state_is_sufficient_session_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    """Um OPEN remoto deve ser suficiente para o tenant considerar a sessão ativa.

    Regressão do incidente real em que o Control Plane enviava com HTTP 201,
    enquanto o tenant abortava antes do sendText porque fetchInstances não
    retornava ownerJid/number e `session_exists` ficava falso.
    """
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://internal.example", api_key="secret", instance="tenant-1")
    )

    async def fake_request(method: str, path: str, payload=None, *, params=None, allow_not_found=False):  # noqa: ANN001
        del method, payload, params, allow_not_found
        if "connectionState" in path:
            return {"instance": {"state": "open"}}
        if "fetchInstances" in path:
            return {"data": [{"name": "tenant-1", "connectionStatus": "open"}]}
        raise AssertionError(path)

    monkeypatch.setattr(provider, "_request", fake_request)
    snapshot = await provider.connection_snapshot()

    assert snapshot["state"] == "CONNECTED"
    assert snapshot["session_exists"] is True
    assert snapshot["instance_exists"] is True
