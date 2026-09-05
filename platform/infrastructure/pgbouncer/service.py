"""Self-contained PgBouncer service: configure, initialize auth, then exec the pooler.

No host-side scripts, external configuration files, trust authentication or
shared tenant login are needed. Credentials are never printed.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


def identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError("Invalid database/role identifier")
    return value


def integer(env: dict[str, str], name: str, default: int, low: int, high: int) -> int:
    value = int(env.get(name, str(default)))
    if not low <= value <= high:
        raise ValueError(f"{name} outside supported range [{low}, {high}]")
    return value


@dataclass(frozen=True)
class PoolConfig:
    name: str
    host: str
    port: int
    database: str
    username: str
    password: str = field(repr=False)
    tenant_prefix: str = ""
    listen_port: int = 6432
    clients: int = 256
    main_size: int = 20
    tenant_size: int = 4
    wait_seconds: int = 10
    query_seconds: int = 60
    idle_seconds: int = 15
    directory: Path = Path("/tmp/connect-pgbouncer")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "PoolConfig":
        env = dict(os.environ) if env is None else env
        name = env.get("POOL_NAME", "engine")
        if name not in {"engine", "platform"}:
            raise ValueError("POOL_NAME must be engine or platform")
        host = env.get("POOL_POSTGRES_HOST", "")
        if not host or not re.fullmatch(r"[A-Za-z0-9_.:-]+", host):
            raise ValueError("Invalid POOL_POSTGRES_HOST")
        password = env.get("POOL_POSTGRES_PASSWORD", "")
        if not password or any(c in password for c in "\r\n\x00"):
            raise ValueError("POOL_POSTGRES_PASSWORD is required")
        prefix = env.get("POOL_TENANT_USER_PREFIX", "")
        if prefix:
            identifier(prefix)
        return cls(
            name=name, host=host,
            port=integer(env, "POOL_POSTGRES_PORT", 5432, 1, 65535),
            database=identifier(env["POOL_POSTGRES_DB"]),
            username=identifier(env["POOL_POSTGRES_USER"]), password=password,
            tenant_prefix=prefix,
            listen_port=integer(env, "POOL_LISTEN_PORT", 6432, 1, 65535),
            clients=integer(env, "POOL_MAX_CLIENTS", 256, 16, 10000),
            main_size=integer(env, "POOL_MAIN_SIZE", 20, 1, 200),
            tenant_size=integer(env, "POOL_TENANT_SIZE", 4, 1, 32),
            wait_seconds=integer(env, "POOL_WAIT_SECONDS", 10, 1, 60),
            query_seconds=integer(env, "POOL_QUERY_SECONDS", 60, 5, 3600),
            idle_seconds=integer(env, "POOL_SERVER_IDLE_SECONDS", 15, 1, 300),
            directory=Path(env.get("POOL_CONFIG_DIR", "/tmp/connect-pgbouncer")),
        )

    @property
    def auth_user(self) -> str:
        return f"connect_pool_auth_{self.name}"

    @property
    def stats_user(self) -> str:
        return f"connect_pool_stats_{self.name}"

    def service_password(self, purpose: str) -> str:
        # Stable across restarts; no extra operator-side secret generator required.
        return hmac.new(self.password.encode(), f"connect-pool:{self.name}:{purpose}:v1".encode(), hashlib.sha256).hexdigest()


def render(config: PoolConfig) -> tuple[str, str]:
    cfg = config
    routes = [
        f"{cfg.database} = host={cfg.host} port={cfg.port} dbname={cfg.database} "
        f"pool_size={cfg.main_size} max_db_connections={cfg.main_size}",
    ]
    # Auth lookup happens centrally, not in every customer's database.
    if cfg.database != "postgres":
        routes.append(f"postgres = host={cfg.host} port={cfg.port} dbname=postgres pool_size=2 max_db_connections=2")
    if cfg.tenant_prefix:
        routes.append(f"* = host={cfg.host} port={cfg.port} pool_size={cfg.tenant_size} max_db_connections={cfg.tenant_size}")
    ini = "[databases]\n" + "\n".join(routes) + f"""

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = {cfg.listen_port}
unix_socket_dir = {cfg.directory}
pidfile = {cfg.directory}/pgbouncer.pid
auth_type = scram-sha-256
auth_file = {cfg.directory}/users.txt
auth_user = {cfg.auth_user}
auth_dbname = postgres
auth_query = SELECT username, password FROM connect_pooler.lookup_{cfg.name}($1)
stats_users = {cfg.stats_user}
pool_mode = transaction
max_client_conn = {cfg.clients}
default_pool_size = {cfg.tenant_size}
min_pool_size = 0
reserve_pool_size = 0
max_db_connections = {cfg.tenant_size}
max_user_connections = {cfg.tenant_size}
max_db_client_connections = {cfg.clients}
max_prepared_statements = 200
query_wait_timeout = {cfg.wait_seconds}
query_timeout = {cfg.query_seconds}
transaction_timeout = {cfg.query_seconds * 2}
idle_transaction_timeout = 30
server_connect_timeout = 5
server_login_retry = 2
server_idle_timeout = {cfg.idle_seconds}
server_lifetime = 600
server_reset_query = DISCARD ALL
server_reset_query_always = 1
ignore_startup_parameters = extra_float_digits
server_tls_sslmode = prefer
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1

[users]
{cfg.username} = max_user_connections={cfg.main_size}
{cfg.auth_user} = max_user_connections=2
"""
    users = (
        f'"{cfg.auth_user}" "{cfg.service_password("auth")}"\n'
        f'"{cfg.stats_user}" "{cfg.service_password("stats")}"\n'
    )
    return ini, users


def initialize_auth(config: PoolConfig) -> None:
    import psycopg
    from psycopg import sql

    cfg = config
    with psycopg.connect(host=cfg.host, port=cfg.port, dbname="postgres", user=cfg.username,
                         password=cfg.password, connect_timeout=5, autocommit=False) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SHOW max_connections")
            maximum = int(cursor.fetchone()[0])
            cursor.execute("SHOW superuser_reserved_connections")
            reserved = int(cursor.fetchone()[0])
            if cfg.main_size + 2 + reserved + 10 > maximum:
                raise ValueError("Pool main budget leaves insufficient administrative headroom")
            # Serialize initialization across restarts/replicas of this service.
            cursor.execute("SELECT pg_catalog.pg_advisory_xact_lock(763924, pg_catalog.hashtext(%s))", (cfg.name,))
            cursor.execute("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = %s", (cfg.auth_user,))
            if cursor.fetchone() is None:
                cursor.execute(sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 4").format(sql.Identifier(cfg.auth_user)))
            cursor.execute("SET LOCAL password_encryption = 'scram-sha-256'")
            cursor.execute(sql.SQL("ALTER ROLE {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT LOGIN CONNECTION LIMIT 4 PASSWORD {}").format(sql.Identifier(cfg.auth_user), sql.Literal(cfg.service_password("auth"))))
            cursor.execute("CREATE SCHEMA IF NOT EXISTS connect_pooler")
            cursor.execute("REVOKE ALL ON SCHEMA connect_pooler FROM PUBLIC")
            cursor.execute(sql.SQL("GRANT USAGE ON SCHEMA connect_pooler TO {}").format(sql.Identifier(cfg.auth_user)))
            # An exact literal prefix check avoids LIKE wildcard expansion for underscores.
            predicate = sql.SQL("a.rolname = {} ").format(sql.Literal(cfg.username))
            if cfg.tenant_prefix:
                predicate += sql.SQL("OR pg_catalog.left(a.rolname, {}) = {} ").format(
                    sql.Literal(len(cfg.tenant_prefix) + 1), sql.Literal(cfg.tenant_prefix + "_"))
            cursor.execute(sql.SQL("""
                CREATE OR REPLACE FUNCTION connect_pooler.{}(requested_user text)
                RETURNS TABLE(username text, password text)
                LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
                    SELECT a.rolname::text,
                           CASE WHEN a.rolvaliduntil IS NULL
                                  OR a.rolvaliduntil OPERATOR(pg_catalog.>) pg_catalog.now()
                                THEN a.rolpassword::text ELSE NULL::text END
                    FROM pg_catalog.pg_authid AS a
                    WHERE a.rolname OPERATOR(pg_catalog.=) requested_user
                      AND a.rolcanlogin AND ({})
                $fn$
            """).format(sql.Identifier(f"lookup_{cfg.name}"), predicate))
            cursor.execute(sql.SQL("REVOKE ALL ON FUNCTION connect_pooler.{}(text) FROM PUBLIC").format(sql.Identifier(f"lookup_{cfg.name}")))
            cursor.execute(sql.SQL("GRANT EXECUTE ON FUNCTION connect_pooler.{}(text) TO {}").format(
                sql.Identifier(f"lookup_{cfg.name}"), sql.Identifier(cfg.auth_user)))
            cursor.execute(sql.SQL("GRANT CONNECT ON DATABASE postgres TO {}").format(sql.Identifier(cfg.auth_user)))


def health(config: PoolConfig) -> None:
    import psycopg

    with psycopg.connect(host="127.0.0.1", port=config.listen_port, dbname="pgbouncer",
                         user=config.stats_user, password=config.service_password("stats"),
                         connect_timeout=3, autocommit=True, prepare_threshold=None) as connection:
        connection.execute("SHOW VERSION").fetchone()


def main() -> int:
    try:
        cfg = PoolConfig.from_env()
        if len(sys.argv) > 1 and sys.argv[1] == "health":
            health(cfg)
            return 0
        for attempt in range(1, 31):
            try:
                initialize_auth(cfg)
                break
            except Exception as exc:
                print(f"pool_auth_initialize_failed attempt={attempt} type={type(exc).__name__}", file=sys.stderr, flush=True)
                if attempt == 30:
                    raise
                time.sleep(2)
        cfg.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        ini, users = render(cfg)
        for name, content in (("pgbouncer.ini", ini), ("users.txt", users)):
            target = cfg.directory / name
            target.write_text(content, encoding="utf-8")
            target.chmod(0o600)
        environment = dict(os.environ)
        environment.pop("POOL_POSTGRES_PASSWORD", None)
        print(f"pool_ready name={cfg.name} mode=transaction per_database_limit={cfg.tenant_size}", flush=True)
        os.execvpe("pgbouncer", ["pgbouncer", str(cfg.directory / "pgbouncer.ini")], environment)
    except Exception as exc:
        print(f"pool_service_failed type={type(exc).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
