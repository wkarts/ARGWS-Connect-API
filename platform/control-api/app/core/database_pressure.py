"""Fail boundedly under overload; never replay writes automatically."""
from __future__ import annotations

from starlette.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, TimeoutError as SQLAlchemyTimeoutError


RETRY_SECONDS = 2
DATABASE_STATES = {"53300", "53400", "57P01", "57P02", "57P03", "57014"}


def is_database_unavailable(exc: BaseException) -> bool:
    if isinstance(exc, (SQLAlchemyTimeoutError, ConnectionError, TimeoutError)):
        return True
    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return True
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        state = str(getattr(current, "sqlstate", "") or getattr(current, "pgcode", ""))
        if state in DATABASE_STATES or state.startswith("08"):
            return True
        current = getattr(current, "orig", None) or current.__cause__
    return False


def unavailable_response(code: str = "DATABASE_BUSY") -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"success": False, "error": {
            "code": code,
            "message": "Serviço temporariamente ocupado. Tente novamente em instantes.",
            "details": {"retry_after": RETRY_SECONDS},
        }},
        headers={"Retry-After": str(RETRY_SECONDS), "Cache-Control": "no-store"},
    )


class DatabaseAdmissionMiddleware:
    """Per-process cap, not a cluster-wide PostgreSQL connection limit.

    Immediate backpressure avoids an unbounded in-memory waiter queue. Requests
    already admitted complete normally. Health/metrics remain reachable.
    """
    def __init__(self, app, limit: int = 16) -> None:
        if limit < 1:
            raise ValueError("Admission limit must be positive")
        self.app = app
        self.limit = limit
        self.active = 0

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return
        if self.active >= self.limit:
            await unavailable_response("API_CAPACITY_REACHED")(scope, receive, send)
            return
        self.active += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.active -= 1
