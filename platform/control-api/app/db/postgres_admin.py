from __future__ import annotations

from dataclasses import dataclass

import asyncpg

from app.core.config import settings


@dataclass(frozen=True, slots=True)
class AdminCredential:
    source: str
    user: str
    password: str


class PostgresAdminConnectionError(RuntimeError):
    pass


def credential_candidates() -> list[AdminCredential]:
    candidates = [
        AdminCredential("POSTGRES_*", settings.postgres_user.strip(), settings.postgres_password),
        AdminCredential(
            "POSTGRES_ADMIN_*", settings.postgres_admin_user.strip(), settings.postgres_admin_password
        ),
    ]
    result: list[AdminCredential] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        key = (candidate.user, candidate.password)
        if candidate.user and candidate.password and key not in seen:
            seen.add(key)
            result.append(candidate)
    return result


async def connect_postgres_admin(database: str | None = None) -> asyncpg.Connection:
    attempts: list[dict[str, str]] = []
    last_error: BaseException | None = None
    for candidate in credential_candidates():
        conn: asyncpg.Connection | None = None
        try:
            conn = await asyncpg.connect(
                host=settings.postgres_host,
                port=settings.postgres_port,
                user=candidate.user,
                password=candidate.password,
                database=database or settings.postgres_db,
            )
            row = await conn.fetchrow(
                "select rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname=current_user"
            )
            if row and (row["rolsuper"] or (row["rolcreaterole"] and row["rolcreatedb"])):
                return conn
            attempts.append({"source": candidate.source, "user": candidate.user, "error": "InsufficientPrivilege"})
            await conn.close()
        except (asyncpg.PostgresError, OSError) as exc:
            last_error = exc
            attempts.append({"source": candidate.source, "user": candidate.user, "error": type(exc).__name__})
            if conn is not None:
                await conn.close()
    error = PostgresAdminConnectionError(
        "Não foi possível abrir conexão administrativa PostgreSQL. "
        f"Tentativas: {attempts or [{'error': 'credenciais ausentes'}]}"
    )
    if last_error:
        raise error from last_error
    raise error
