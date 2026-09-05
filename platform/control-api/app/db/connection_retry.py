"""Retry only a failed PostgreSQL login, before the driver returns a connection.

The diagnostic bundle contains intermittent PgBouncer 08P01 errors during auth.
No SQL query, transaction, API operation or business write is replayed here.
"""
from __future__ import annotations

import asyncio
from sqlalchemy import event
from sqlalchemy.util import await_only


def retryable_login(error: BaseException) -> bool:
    return (getattr(error, 'sqlstate', None) == '08P01'
            and 'bouncer config error' in str(error).lower())


def connect_with_retry(connect, args, kwargs, sleep) -> object:
    for attempt in range(3):
        try:
            return connect(*args, **kwargs)
        except Exception as exc:
            if attempt == 2 or not retryable_login(exc): raise
            sleep(0.1 * (attempt + 1))
    raise AssertionError('unreachable')


def install_login_retry(engine) -> None:
    @event.listens_for(engine.sync_engine, 'do_connect')
    def open_connection(dialect, connection_record, args, kwargs):
        return connect_with_retry(dialect.loaded_dbapi.connect, args, kwargs,
                                  lambda delay: await_only(asyncio.sleep(delay)))
