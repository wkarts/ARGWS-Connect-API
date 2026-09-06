import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4
import pytest
from app.services import tls_job_completion as completion


def job(status):
    return SimpleNamespace(id=uuid4(), tenant_id=uuid4(), status='WAITING_TLS', progress=95, current_step='WAITING_TLS',
        last_error='waiting', add_event=Mock(), tenant=SimpleNamespace(status=status, activated_at=None,
        domains=[SimpleNamespace(is_primary=True,status='ACTIVE',hostname='demo.example.test')]))


@pytest.mark.parametrize('status', ['ACTIVE','PROVISIONING'])
def test_waiting_job_completes_for_active_or_provisioning_customer_after_revalidation(status,monkeypatch):
    item=job(status); original=datetime(2026,1,1,tzinfo=UTC) if status=='ACTIVE' else None;item.tenant.activated_at=original
    validate=AsyncMock(return_value={'ready':True});audit=AsyncMock()
    monkeypatch.setattr(completion.provisioning_service,'validate_resources',validate)
    monkeypatch.setattr(completion,'platform_audit',audit)
    session=AsyncMock()
    assert asyncio.run(completion.complete_waiting_job(session,item))
    assert item.status=='SUCCEEDED' and item.progress==100
    if original: assert item.tenant.activated_at==original
    validate.assert_awaited_once_with(session,item.tenant,reconcile_domain=False)
    audit.assert_awaited_once();session.commit.assert_not_called()


@pytest.mark.parametrize('status', ['SUSPENDED','DISABLED','DELETED'])
def test_job_does_not_reactivate_disabled_customer(status,monkeypatch):
    item=job(status);validate=AsyncMock();monkeypatch.setattr(completion.provisioning_service,'validate_resources',validate)
    assert not asyncio.run(completion.complete_waiting_job(AsyncMock(),item))
    assert item.progress==95 and item.tenant.status==status
    validate.assert_not_called()


def test_failed_resource_revalidation_remains_pending(monkeypatch):
    item=job('ACTIVE');monkeypatch.setattr(completion.provisioning_service,'validate_resources',AsyncMock(return_value={'ready':False}))
    assert not asyncio.run(completion.complete_waiting_job(AsyncMock(),item))
    assert item.status=='WAITING_TLS' and item.progress==95
