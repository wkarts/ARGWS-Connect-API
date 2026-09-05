"""Bounded direct pools and transaction-pool compatible runtime options."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy.pool import NullPool

from app.core.config import Settings, settings


def engine_options(*, tenant: bool = False, config: Settings = settings) -> dict:
    options: dict = {
        "pool_pre_ping": True,
        "echo": config.app_debug,
        "connect_args": {
            "timeout": config.postgres_connect_timeout,
            "command_timeout": config.postgres_command_timeout,
        },
    }
    if config.postgres_pgbouncer_enabled:
        # PgBouncer is the pool. Do not leave one SQLAlchemy pool per customer/process.
        options["poolclass"] = NullPool
        options["connect_args"].update({
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__connect_{uuid4().hex}__",
        })
    else:
        options.update({
            "pool_size": config.tenant_pool_size if tenant else config.postgres_pool_size,
            "max_overflow": 0 if tenant else config.postgres_max_overflow,
            "pool_timeout": config.postgres_pool_timeout,
            "pool_recycle": 300,
        })
    return options
