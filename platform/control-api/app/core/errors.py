from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import ORJSONResponse


class APIError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


async def api_error_handler(_: Request, exc: APIError) -> ORJSONResponse:
    return ORJSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {"code": exc.code, "message": exc.message, "details": exc.details},
        },
    )
