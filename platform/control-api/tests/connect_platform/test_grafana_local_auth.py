import asyncio
import base64
import json
import httpx
import pytest
import respx
from app.core.config import settings
from app.core.errors import APIError
from app.services.resource_admin import GrafanaAdminService


@pytest.fixture
def local(monkeypatch):
    monkeypatch.setattr(settings, 'grafana_base_url', 'http://connect-grafana:3000')
    monkeypatch.setattr(settings, 'grafana_service_account_token', '')
    monkeypatch.setattr(settings, 'grafana_local_admin_enabled', True)
    monkeypatch.setattr(settings, 'grafana_admin_user', 'local-admin')
    monkeypatch.setattr(settings, 'grafana_admin_password', 'test-only-not-live-secret')
    return GrafanaAdminService()


def test_local_existing_password_authenticates_without_service_account_manual_step(local):
    async def scenario():
        with respx.mock:
            respx.get(local.base_url + '/api/health').respond(200, json={'database': 'ok'})
            def auth(request):
                assert request.headers['authorization'] == 'Basic ' + base64.b64encode(b'local-admin:test-only-not-live-secret').decode()
                return httpx.Response(200, json=[{'uid': 'connect-platform-runtime'}])
            for path in ['/api/search', '/api/folders', '/api/datasources']:
                respx.get(local.base_url + path).mock(side_effect=auth)
            data = await local.overview()
            assert data['admin_configured'] and data['auth_mode'] == 'LOCAL_ADMIN'
            assert 'test-only' not in json.dumps(data)
    asyncio.run(scenario())


@pytest.mark.parametrize('endpoint', ['https://connect-grafana:3000', 'http://grafana.other:3000', 'http://connect-grafana:3000.evil'])
def test_local_admin_never_sent_to_external_or_lookalike_endpoint(local, endpoint):
    local.base_url = endpoint
    assert local._auth_mode() == 'NOT_CONFIGURED'
    with pytest.raises(APIError): local._headers()


def test_explicit_token_takes_precedence_without_password_fallback(local, monkeypatch):
    monkeypatch.setattr(settings, 'grafana_service_account_token', 'invalid-explicit-token')
    assert local._auth_mode() == 'SERVICE_ACCOUNT'
    async def scenario():
        with respx.mock:
            route = respx.get(local.base_url+'/api/search').respond(401, json={'secret': 'must-not-reflect'})
            with pytest.raises(APIError) as error: await local._json('GET', '/api/search')
            assert error.value.code == 'GRAFANA_CREDENTIAL_REJECTED'
            assert route.call_count == 1
            assert route.calls[0].request.headers['authorization'] == 'Bearer invalid-explicit-token'
            assert 'must-not-reflect' not in str(error.value.message)
    asyncio.run(scenario())


def test_missing_or_placeholder_password_does_not_authenticate(local, monkeypatch):
    for value in ['', 'CHANGE_ME_GRAFANA_ADMIN_PASSWORD']:
        monkeypatch.setattr(settings, 'grafana_admin_password', value)
        assert local._auth_mode() == 'NOT_CONFIGURED'
