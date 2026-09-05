from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import respx
from pydantic import ValidationError

from app.core.errors import APIError
from app.db.connection_retry import connect_with_retry
from app.schemas.connect_engine import EngineInstanceCreate, EnginePairingRequest
from app.services.connect_engine import ConnectEngineClient
from app.services.instance_lifecycle import creation_body, pairing_response


@pytest.mark.parametrize('key', ['token','instanceName','instanceId','qrcode','ownerJid','integration'])
def test_browser_cannot_override_instance_authority(key):
    with pytest.raises(ValidationError): EngineInstanceCreate(alias='sales',extra={key:'override'})


def test_creation_body_does_not_couple_pairing_to_creation():
    payload=EngineInstanceCreate(alias='sales',qrcode=True)
    assert 'qrcode' not in creation_body(payload)
    assert 'instanceName' not in creation_body(payload)


def test_pairing_output_excludes_engine_tokens_and_session_material():
    raw={'qrcode':{'base64':'data:image/png;base64,YWJj','pairingCode':'12345678', 'token':'secret', 'privKey':'private'},'hash':'secret'}
    assert pairing_response(raw)=={'base64':'data:image/png;base64,YWJj','pairing_code':'12345678','state':None,'pending':False}
    assert pairing_response({'instance':{'state':'open'}})['pending'] is False
    assert pairing_response({})['pending'] is True
    assert pairing_response({'base64':'javascript:alert(1)'})['base64'] is None


def test_pairing_phone_is_normalized_and_validated():
    assert EnginePairingRequest(number='+55 (75) 99999-9999').number=='5575999999999'
    with pytest.raises(ValidationError): EnginePairingRequest(number='123')


def test_only_failed_login_is_retried_before_returning_a_connection():
    calls=[]; waits=[]
    class LoginError(Exception): sqlstate='08P01'
    def connect():
        calls.append(1)
        if len(calls)<3: raise LoginError('bouncer config error')
        return 'new-connection'
    assert connect_with_retry(connect,[],{},waits.append)=='new-connection'
    assert waits==[0.1,0.2]
    def bad_password(): raise ValueError('invalid password')
    with pytest.raises(ValueError): connect_with_retry(bad_password,[],{},lambda t:pytest.fail('must not retry'))
    def exhausted(): raise LoginError('bouncer config error')
    with pytest.raises(LoginError): connect_with_retry(exhausted,[],{},lambda t:None)


@pytest.mark.parametrize('status,code,public', [(401,'ENGINE_CREDENTIAL_REJECTED',502),(403,'ENGINE_CREDENTIAL_REJECTED',502),
    (409,'ENGINE_INSTANCE_CONFLICT',409),(429,'ENGINE_CAPACITY_REACHED',503),(422,'ENGINE_OPERATION_REJECTED',422)])
def test_upstream_auth_error_does_not_log_out_browser(status,code,public,monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,'connect_engine_api_key','test-key')
    client=ConnectEngineClient()
    async def scenario():
        with respx.mock:
            respx.post(client.base_url+'/instance/create').mock(return_value=httpx.Response(status,json={'secret':'do-not-reflect'}))
            with pytest.raises(APIError) as error: await client.create_instance({'instanceName':'x'})
            assert error.value.code==code and error.value.status_code==public
            assert 'do-not-reflect' not in str(error.value.details)
    asyncio.run(scenario())


def test_bridge_retries_read_but_never_replays_create(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,'connect_engine_api_key','test-key')
    client=ConnectEngineClient()
    async def scenario():
        with respx.mock:
            read=respx.get(client.base_url+'/instance/fetchInstances').mock(side_effect=[httpx.Response(500),httpx.Response(200,json=[])])
            assert await client.fetch_instances()==[] and read.call_count==2
            create=respx.post(client.base_url+'/instance/create').mock(return_value=httpx.Response(500))
            with pytest.raises(APIError): await client.create_instance({'instanceName':'x'})
            assert create.call_count==1
    asyncio.run(scenario())


def test_access_routes_are_available_without_financial_modules():
    from app.main import app
    routes={r.path for r in app.routes if hasattr(r,'path')}
    # Newer FastAPI lazily includes routers; OpenAPI resolves both forms.
    routes.update(app.openapi()['paths'])
    assert {'/api/v1/roles','/api/v1/api-keys','/api/v1/outbound-webhooks','/api/v1/companies'} <= routes
    assert '/api/v1/transactions' not in routes


def test_lower_privilege_operator_cannot_grant_admin_permissions():
    from app.api.routes.tenant_access import _grant_permissions
    user=SimpleNamespace(permissions=['users.read','users.manage'])
    with pytest.raises(APIError) as e: _grant_permissions(user,['*'])
    assert e.value.status_code==403
    _grant_permissions(user,['users.read'])
