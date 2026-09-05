"""CI-only integration test with disposable PostgreSQL and the actual pooler image.

Not an operational deployment script. Never connects to a user's database.
Requires Docker and the project's Python dependencies on the CI runner.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import time
from uuid import uuid4

import asyncpg
import psycopg
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.db.pooling import engine_options

PASSWORD = "disposable-ci-password-only"


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True).strip()


def port(name: str, internal: str) -> int:
    data = json.loads(docker("inspect", name))[0]
    return int(data["NetworkSettings"]["Ports"][internal][0]["HostPort"])


def connect(db_port: int, database="control_test", user="pool_admin", password=PASSWORD):
    return psycopg.connect(host="127.0.0.1", port=db_port, dbname=database, user=user,
                           password=password, autocommit=True, connect_timeout=3, prepare_threshold=None)


def wait_postgres(db_port: int) -> None:
    for _ in range(60):
        try:
            with connect(db_port) as connection:
                assert connection.execute("SELECT 1").fetchone()[0] == 1
                return
        except psycopg.Error:
            time.sleep(1)
    raise RuntimeError("Disposable database/pooler did not become ready")


async def async_tests(pooled_port: int, direct_port: int) -> None:
    cfg = Settings(_env_file=None, postgres_pgbouncer_enabled=True)
    url = URL.create("postgresql+asyncpg", username="customer_a", password=PASSWORD,
                     host="127.0.0.1", port=pooled_port, database="customer_a")
    engine = create_async_engine(url, **engine_options(config=cfg))
    try:
        # Repeated SQLAlchemy/asyncpg prepared statements across transaction reuse.
        async def work(value: int) -> int:
            async with engine.begin() as connection:
                assert (await connection.scalar(text("SELECT current_user"))) == "customer_a"
                await connection.execute(text("SELECT pg_sleep(0.01)"))
                return await connection.scalar(text("SELECT CAST(:value AS integer)"), {"value": value})
        values = await asyncio.gather(*(work(i) for i in range(20)))
        assert values == list(range(20))
        with connect(direct_port) as connection:
            count = connection.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = 'customer_a'").fetchone()[0]
            assert count <= 2, f"Per-database pool exceeded: {count}"
        # A saturated pool must time out and subsequently recover, not crash.
        async def slow():
            connection = await asyncpg.connect(host="127.0.0.1", port=pooled_port,
                database="customer_a", user="customer_a", password=PASSWORD, statement_cache_size=0)
            try:
                await connection.execute("SELECT pg_sleep(3)")
            finally:
                await connection.close()
        results = await asyncio.gather(*(slow() for _ in range(4)), return_exceptions=True)
        assert any(isinstance(result, Exception) for result in results), "Expected a bounded queue timeout"
        async with engine.begin() as connection:
            assert await connection.scalar(text("SELECT 1")) == 1
    finally:
        await engine.dispose()


def main() -> None:
    prefix = "connect-pool-ci-" + uuid4().hex[:8]
    pg, pool, net = prefix + "-pg", prefix + "-pool", prefix + "-net"
    try:
        docker("network", "create", net)
        docker("run", "-d", "--name", pg, "--network", net,
               "-e", "POSTGRES_USER=pool_admin", "-e", "POSTGRES_PASSWORD=" + PASSWORD,
               "-e", "POSTGRES_DB=control_test", "-p", "127.0.0.1::5432", "postgres:17")
        direct_port = port(pg, "5432/tcp")
        wait_postgres(direct_port)
        docker("run", "-d", "--name", pool, "--network", net,
               "-e", "POOL_NAME=platform", "-e", "POOL_POSTGRES_HOST=" + pg,
               "-e", "POOL_POSTGRES_USER=pool_admin", "-e", "POOL_POSTGRES_PASSWORD=" + PASSWORD,
               "-e", "POOL_POSTGRES_DB=control_test", "-e", "POOL_TENANT_USER_PREFIX=customer",
               "-e", "POOL_MAIN_SIZE=4", "-e", "POOL_TENANT_SIZE=2",
               "-e", "POOL_WAIT_SECONDS=1", "-e", "POOL_SERVER_IDLE_SECONDS=2",
               "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
               "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
               "-p", "127.0.0.1::6432", "connect-pgbouncer-ci:local")
        pooled_port = port(pool, "6432/tcp")
        wait_postgres(pooled_port)
        with connect(direct_port) as connection:
            for name in ("customer_a", "customer_b"):
                connection.execute(psycopg.sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(psycopg.sql.Identifier(name), psycopg.sql.Literal(PASSWORD)))
                connection.execute(psycopg.sql.SQL("CREATE DATABASE {} OWNER {}").format(psycopg.sql.Identifier(name), psycopg.sql.Identifier(name)))
                connection.execute(psycopg.sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(psycopg.sql.Identifier(name)))
                connection.execute(psycopg.sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(psycopg.sql.Identifier(name), psycopg.sql.Identifier(name)))
        # New accounts/databases work without restarting/reloading the pooler.
        with connect(pooled_port, "customer_b", "customer_b") as connection:
            assert connection.execute("SELECT current_user, current_database()").fetchone() == ("customer_b", "customer_b")
        try:
            connect(pooled_port, "customer_b", "customer_a").close()
        except psycopg.Error:
            pass
        else:
            raise AssertionError("Cross-customer database access must be denied")
        asyncio.run(async_tests(pooled_port, direct_port))
        with connect(direct_port) as connection:
            connection.execute("ALTER ROLE customer_b VALID UNTIL '2000-01-01'")
        try:
            connect(pooled_port, "customer_b", "customer_b").close()
        except psycopg.Error:
            pass
        else:
            raise AssertionError("Expired credential accepted")
        with connect(direct_port) as connection:
            connection.execute("ALTER ROLE customer_b VALID UNTIL 'infinity'")
            connection.execute("ALTER ROLE customer_b PASSWORD 'rotated-ci-password-only'")
        with connect(pooled_port, "customer_b", "customer_b", "rotated-ci-password-only") as connection:
            assert connection.execute("SELECT 1").fetchone()[0] == 1
        print("PASS: live pooling, new tenants, isolation, expiry/rotation, asyncpg and overload recovery")
    except Exception:
        # Diagnostics only from disposable CI containers, never production.
        for name in (pool, pg):
            subprocess.run(["docker", "logs", "--tail", "80", name], check=False)
        raise
    finally:
        for name in (pool, pg):
            subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        subprocess.run(["docker", "network", "rm", net], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main()
