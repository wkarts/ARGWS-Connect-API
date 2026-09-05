"""Run only against the disposable corrective_ci database created by the CI job."""
from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.engine import make_url

from app.core.errors import APIError
from app.db.base import PlatformBase
from app.models.platform import Tenant, EngineBinding
from app.schemas.connect_engine import EngineInstanceCreate
from app.services import instance_lifecycle as lifecycle


@pytest.mark.skipif(not os.environ.get('CORRECTIVE_TEST_DATABASE_URL'),reason='requires disposable PostgreSQL')
def test_real_transactions_enforce_quota_idempotency_and_ownership(monkeypatch):
    url=make_url(os.environ['CORRECTIVE_TEST_DATABASE_URL'])
    assert url.host in {'localhost','127.0.0.1'} and url.database=='corrective_ci'
    async def scenario():
        engine=create_async_engine(url)
        sessions=async_sessionmaker(engine,expire_on_commit=False)
        monkeypatch.setattr(lifecycle,'PlatformSessionLocal',sessions)
        class Engine:
            def __init__(self): self.instances={}; self.creates=0; self.fail_after_create=False
            async def create_instance(self,body):
                self.creates+=1
                assert body['qrcode'] is False
                name=body['instanceName']
                if name in self.instances: raise APIError('ENGINE_INSTANCE_CONFLICT','name conflict',409)
                self.instances[name]=body['token']
                await asyncio.sleep(0.05)
                if self.fail_after_create: raise APIError('ENGINE_UNAVAILABLE','timeout',503)
                return {'instance':{'instanceName':name,'instanceId':str(uuid4())}}
            async def owned_instance(self,name,key):
                if self.instances.get(name)!=key: raise APIError('ENGINE_CREDENTIAL_REJECTED','not owner',502)
                return {'instanceName':name,'instanceId':str(uuid4())}
        remote=Engine();monkeypatch.setattr(lifecycle,'connect_engine',remote)
        async with engine.begin() as conn:
            await conn.run_sync(PlatformBase.metadata.create_all)
        ids=[uuid4(),uuid4()]
        user=SimpleNamespace(id=str(uuid4()))
        async with sessions() as session:
            for i,tid in enumerate(ids): session.add(Tenant(id=tid,name='Customer '+str(i),slug='ci-'+tid.hex,status='ACTIVE',features={'instances':True},limits={'instances':2}))
            await session.commit()
        ctx=SimpleNamespace(tenant_id=str(ids[0])); other=SimpleNamespace(tenant_id=str(ids[1]))
        try:
            # Same alias is one durable reservation under concurrent requests.
            payload=EngineInstanceCreate(alias='sales')
            reservations=await asyncio.gather(*(lifecycle.reserve_instance(ctx,user,payload) for _ in range(6)))
            assert len(set(reservations))==1
            binding=reservations[0]
            # Concurrent create calls cannot issue two side-effecting POSTs.
            await asyncio.gather(*(lifecycle.ensure_instance(ctx,user,binding) for _ in range(4)))
            assert remote.creates==1
            async with sessions() as session:
                assert (await session.get(EngineBinding,binding)).status=='CREATED'
            with pytest.raises(APIError) as denied: await lifecycle.ensure_instance(other,user,binding)
            assert denied.value.status_code==404
            # Remaining slot may be used by only one of several different aliases.
            attempts=await asyncio.gather(*(lifecycle.reserve_instance(ctx,user,EngineInstanceCreate(alias='ops'+str(i))) for i in range(5)),return_exceptions=True)
            assert sum(isinstance(x,UUID) for x in attempts)==1
            assert all(x.code=='TENANT_LIMIT_EXCEEDED' for x in attempts if isinstance(x,APIError))
            # Ambiguous response after successful upstream POST is reconciled by secret proof, not replayed.
            remote.fail_after_create=True
            pending=await lifecycle.reserve_instance(other,user,EngineInstanceCreate(alias='support'))
            with pytest.raises(APIError): await lifecycle.ensure_instance(other,user,pending)
            before=remote.creates
            remote.fail_after_create=False
            result=await lifecycle.ensure_instance(other,user,pending)
            assert result['status']=='CREATED' and remote.creates==before
            # Public API response never returns ownership tokens or request secrets.
            assert 'ownership_token' not in repr(result) and 'create_body' not in repr(result)
            # A foreign object at a known name is NOT adoptable by its name alone.
            conflict=await lifecycle.reserve_instance(other,user,EngineInstanceCreate(alias='conflict'))
            async with sessions() as session:
                row=await session.get(EngineBinding,conflict)
                foreign_name=row.instance_name
                remote.instances[foreign_name]='foreign-secret'
            with pytest.raises(APIError): await lifecycle.ensure_instance(other,user,conflict)
            with pytest.raises(APIError): await lifecycle.ensure_instance(other,user,conflict)
            assert remote.instances[foreign_name]=='foreign-secret'
            async with sessions() as session:
                assert (await session.get(EngineBinding,conflict)).status=='CREATE_PENDING'
        finally:
            async with sessions() as session:
                for tid in ids:
                    row=await session.get(Tenant,tid)
                    if row: await session.delete(row)
                await session.commit()
            await engine.dispose()
    asyncio.run(scenario())
