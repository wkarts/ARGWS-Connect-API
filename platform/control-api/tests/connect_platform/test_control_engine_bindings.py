import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from app.core.errors import APIError
from app.services import control_engine_instances as control


def objects(status='CREATED'):
    tenant = SimpleNamespace(id=uuid4(), name='Cliente', slug='demo', status='ACTIVE')
    binding = SimpleNamespace(id=uuid4(), tenant_id=tenant.id, alias='sales', instance_name='private-tenant-name',
                              status=status, provider='WHATSAPP-BAILEYS', metadata_json={'ownership_token': 'DO_NOT_EXPOSE'}, last_error=None)
    return tenant, binding


def test_no_binding_does_not_discover_or_reuse_global_connection(monkeypatch):
    tenant, _ = objects()
    engine = AsyncMock()
    monkeypatch.setattr(control, 'connect_engine', engine)
    result = asyncio.run(control.snapshot(tenant, None))
    assert result['instance'] is None and result['connection']['state'] == 'NOT_CREATED'
    assert result['instance_mode'] == 'TENANT'
    engine.connection_state.assert_not_called()
    engine.fetch_instances.assert_not_called()


def test_only_selected_instance_state_is_read_and_secrets_are_not_returned(monkeypatch):
    tenant, binding = objects()
    engine = AsyncMock()
    engine.connection_state.return_value = {'instance': {'state': 'open', 'token': 'DO_NOT_EXPOSE'}}
    monkeypatch.setattr(control, 'connect_engine', engine)
    result = asyncio.run(control.snapshot(tenant, binding))
    engine.connection_state.assert_awaited_once_with(binding.instance_name)
    assert result['binding_id'] == str(binding.id) and result['connection']['state'] == 'CONNECTED'
    assert 'DO_NOT_EXPOSE' not in str(result)


def test_pending_creation_does_not_trigger_another_upstream_operation(monkeypatch):
    tenant, binding = objects('CREATE_PENDING'); engine = AsyncMock(); monkeypatch.setattr(control, 'connect_engine', engine)
    result = asyncio.run(control.snapshot(tenant, binding))
    assert result['connection']['state'] == 'CREATE_PENDING' and not result['pairing_available']
    engine.connection_state.assert_not_called()


def test_unavailable_is_not_a_shared_instance(monkeypatch):
    tenant, binding = objects(); engine = AsyncMock()
    engine.connection_state.side_effect = APIError('ENGINE_UNAVAILABLE', 'Motor temporariamente indisponível.', 503)
    monkeypatch.setattr(control, 'connect_engine', engine)
    result = asyncio.run(control.snapshot(tenant, binding))
    assert result['connection']['state'] == 'UNAVAILABLE' and result['instance_mode'] == 'TENANT'
    assert result['instance'] == binding.instance_name


def test_resolver_requires_tenant_and_binding_in_query():
    async def scenario():
        tenant, binding = objects(); session = AsyncMock()
        session.scalars.return_value = SimpleNamespace(all=lambda: [binding])
        assert await control.resolve_binding(session, tenant.id, binding.id) is binding
        statement = session.scalars.call_args.args[0].compile()
        assert tenant.id in statement.params.values() and binding.id in statement.params.values()
        session.scalars.return_value = SimpleNamespace(all=lambda: [])
        with pytest.raises(APIError) as error: await control.resolve_binding(session, tenant.id, uuid4())
        assert error.value.status_code == 404
        session.scalars.return_value = SimpleNamespace(all=lambda: [binding, binding])
        with pytest.raises(APIError) as error: await control.resolve_binding(session, tenant.id, None)
        assert error.value.code == 'ENGINE_BINDING_REQUIRED'
    asyncio.run(scenario())


def test_suspended_customer_is_not_operable(monkeypatch):
    tenant, _ = objects(); tenant.status = 'SUSPENDED'
    result = asyncio.run(control.snapshot(tenant, None))
    assert not result['operations_available']
