from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError, TimeoutError as SQLTimeout
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.core.database_pressure import DatabaseAdmissionMiddleware, is_database_unavailable
from app.core.tenant_context import TenantContext
from app.db.pooling import engine_options

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("pool_service_tests", ROOT / "infrastructure/pgbouncer/service.py")
service = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = service
SPEC.loader.exec_module(service)


def config(**extra):
    env = {"POOL_POSTGRES_HOST": "db-internal", "POOL_POSTGRES_DB": "control", "POOL_POSTGRES_USER": "admin",
           "POOL_POSTGRES_PASSWORD": "a-test-only-credential", "POOL_NAME": "platform", "POOL_TENANT_USER_PREFIX": "customer"}
    env.update(extra)
    return service.PoolConfig.from_env(env)


def test_pool_config_is_self_contained_without_tenant_forced_user():
    cfg = config()
    ini, users = service.render(cfg)
    assert "pool_mode = transaction" in ini
    assert "auth_type = scram-sha-256" in ini
    assert "auth_dbname = postgres" in ini
    assert "* = host=db-internal" in ini
    assert "user=admin" not in ini
    assert cfg.password not in ini + users + repr(cfg)
    assert "trust" not in ini
    assert "server_reset_query_always = 1" in ini
    assert "max_prepared_statements = 200" in ini
    assert "min_pool_size = 0" in ini
    assert "reserve_pool_size = 0" in ini


def test_engine_has_no_wildcard_route():
    ini, _ = service.render(config(POOL_NAME="engine", POOL_TENANT_USER_PREFIX=""))
    assert "* =" not in ini


@pytest.mark.parametrize("key,value", [
    ("POOL_POSTGRES_HOST", "db\nauth_type=trust"), ("POOL_POSTGRES_DB", "db'bad"),
    ("POOL_POSTGRES_USER", "admin user"), ("POOL_TENANT_USER_PREFIX", "customer%"),
    ("POOL_POSTGRES_PASSWORD", "bad\nvalue"), ("POOL_MAX_CLIENTS", "0"),
    ("POOL_MAIN_SIZE", "0"), ("POOL_TENANT_SIZE", "1000"),
    ("POOL_QUERY_SECONDS", "0"), ("POOL_WAIT_SECONDS", "0"), ("POOL_POSTGRES_PORT", "65536"),
])
def test_invalid_configuration_fails_closed(key, value):
    with pytest.raises((ValueError, KeyError)):
        config(**{key: value})


def test_service_passwords_are_stable_separated_and_change_with_secret():
    a = config()
    assert a.service_password("auth") == config().service_password("auth")
    assert a.service_password("auth") != a.service_password("stats")
    assert a.service_password("auth") != config(POOL_POSTGRES_PASSWORD="rotated-test-key").service_password("auth")


def test_runtime_dsn_never_replaces_direct_migration_dsn():
    cfg = Settings(_env_file=None, postgres_pgbouncer_enabled=True, postgres_host="direct-pg",
                   postgres_port=5432, postgres_runtime_host="pooler", postgres_runtime_port=6432,
                   postgres_password="a@b:/special")
    assert "direct-pg:5432" in cfg.platform_database_url
    assert "direct-pg:5432" in cfg.platform_database_url_sync
    assert "pooler:6432" in cfg.platform_runtime_database_url
    assert "a%40b" in cfg.platform_runtime_database_url


def test_runtime_pool_uses_nullpool_and_prepared_statement_controls():
    opts = engine_options(config=Settings(_env_file=None, postgres_pgbouncer_enabled=True))
    assert opts["poolclass"] is NullPool
    assert "pool_size" not in opts
    args = opts["connect_args"]
    assert args["prepared_statement_cache_size"] == 0
    assert args["statement_cache_size"] == 0
    assert args["prepared_statement_name_func"]() != args["prepared_statement_name_func"]()


def test_direct_mode_remains_bounded():
    cfg = Settings(_env_file=None, postgres_pgbouncer_enabled=False)
    assert engine_options(config=cfg)["max_overflow"] == 0
    assert engine_options(tenant=True, config=cfg)["pool_size"] == 1
    assert cfg.platform_runtime_database_url == cfg.platform_database_url


@pytest.mark.parametrize("state", ["53300", "53400", "57P01", "57P02", "57P03", "57014", "08006"])
def test_transient_sqlstates_are_classified(state):
    original = Exception("not exposed")
    original.sqlstate = state
    assert is_database_unavailable(OperationalError("sql", {}, original))


def test_integrity_errors_are_not_hidden_as_overload():
    assert not is_database_unavailable(IntegrityError("sql", {}, ValueError("constraint")))
    assert not is_database_unavailable(ValueError("business rule"))
    assert is_database_unavailable(SQLTimeout("pool timeout"))


def test_admission_rejects_excess_but_health_and_recovery_work():
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        async def app(scope, receive, send):
            if scope["path"] == "/api/hold":
                started.set()
                await release.wait()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"OK"})
        middleware = DatabaseAdmissionMiddleware(app, limit=1)
        async def request(path):
            messages = []
            async def receive(): return {"type": "http.request", "body": b""}
            async def send(message): messages.append(message)
            await middleware({"type": "http", "path": path, "method": "GET", "headers": []}, receive, send)
            return messages
        first = asyncio.create_task(request("/api/hold"))
        await started.wait()
        rejected = await request("/api/another")
        assert rejected[0]["status"] == 503
        assert (b"retry-after", b"2") in rejected[0]["headers"]
        assert json.loads(rejected[1]["body"])["error"]["code"] == "API_CAPACITY_REACHED"
        assert (await request("/health/live"))[0]["status"] == 200
        release.set()
        await first
        assert middleware.active == 0
        assert (await request("/api/another"))[0]["status"] == 200
    asyncio.run(scenario())


def test_admission_releases_slot_after_cancellation():
    async def scenario():
        started = asyncio.Event()
        async def app(scope, receive, send):
            started.set()
            await asyncio.Event().wait()
        middleware = DatabaseAdmissionMiddleware(app, limit=1)
        task = asyncio.create_task(middleware({"type": "http", "path": "/api/hold"}, None, None))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert middleware.active == 0
    asyncio.run(scenario())


def test_registry_cache_is_bounded_and_rotates_credentials(monkeypatch):
    from app.db import tenant
    created = []
    class Engine:
        disposed = False
        async def dispose(self): self.disposed = True
    def engine_factory(url, **kwargs):
        engine = Engine()
        created.append(engine)
        assert url.host == "pooler"
        assert kwargs["poolclass"] is NullPool
        return engine
    monkeypatch.setattr(tenant, "create_async_engine", engine_factory)
    monkeypatch.setattr(tenant, "install_login_retry", lambda engine: None)
    monkeypatch.setattr(tenant, "async_sessionmaker", lambda *args, **kwargs: SimpleNamespace())
    monkeypatch.setattr(tenant.settings, "postgres_pgbouncer_enabled", True)
    monkeypatch.setattr(tenant.settings, "postgres_runtime_host", "pooler")
    monkeypatch.setattr(tenant.settings, "tenant_engine_cache_size", 2)
    def context(key, version=1):
        return TenantContext(key, key, "db_"+key, "role_"+key, "pw", "bucket", key+".example.com", credential_version=version)
    async def scenario():
        registry = tenant.TenantEngineRegistry()
        one = await registry.get(context("one"))
        await registry.get(context("two"))
        assert await registry.get(context("one")) is one
        await registry.get(context("three"))
        assert len(registry._engines) == 2
        assert created[1].disposed
        await registry.get(context("one", 2))
        assert one.engine.disposed
        await registry.dispose_all()
        assert not registry._engines
    asyncio.run(scenario())
