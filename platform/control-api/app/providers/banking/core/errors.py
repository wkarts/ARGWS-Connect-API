from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.errors import APIError


BANK_ERROR_CODES = {
    "BANK_AUTHENTICATION_FAILED",
    "BANK_AUTHORIZATION_FAILED",
    "BANK_INVALID_CREDENTIALS",
    "BANK_INVALID_CONFIGURATION",
    "BANK_CERTIFICATE_INVALID",
    "BANK_CERTIFICATE_EXPIRED",
    "BANK_CAPABILITY_NOT_SUPPORTED",
    "BANK_RATE_LIMITED",
    "BANK_REQUEST_TIMEOUT",
    "BANK_PROVIDER_UNAVAILABLE",
    "BANK_INVALID_REQUEST",
    "BANK_REJECTED_OPERATION",
    "BANK_DUPLICATE_OPERATION",
    "BANK_RESOURCE_NOT_FOUND",
    "BANK_WEBHOOK_INVALID",
    "BANK_RESPONSE_INVALID",
}


@dataclass(slots=True)
class BankProviderError(Exception):
    code: str
    message: str
    provider_error_code: str | None = None
    provider_http_status: int | None = None
    correlation_id: str | None = None
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.code not in BANK_ERROR_CODES:
            self.code = "BANK_PROVIDER_UNAVAILABLE"
        Exception.__init__(self, self.message)

    def as_api_error(self) -> APIError:
        status = {
            "BANK_INVALID_CREDENTIALS": 422,
            "BANK_INVALID_CONFIGURATION": 422,
            "BANK_CERTIFICATE_INVALID": 422,
            "BANK_CERTIFICATE_EXPIRED": 422,
            "BANK_CAPABILITY_NOT_SUPPORTED": 422,
            "BANK_DUPLICATE_OPERATION": 409,
            "BANK_RESOURCE_NOT_FOUND": 404,
            "BANK_RATE_LIMITED": 429,
            "BANK_REQUEST_TIMEOUT": 504,
            "BANK_PROVIDER_UNAVAILABLE": 503,
            "BANK_AUTHENTICATION_FAILED": 424,
            "BANK_AUTHORIZATION_FAILED": 424,
            "BANK_INVALID_REQUEST": 422,
            "BANK_REJECTED_OPERATION": 424,
            "BANK_WEBHOOK_INVALID": 401,
            "BANK_RESPONSE_INVALID": 502,
        }.get(self.code, 502)
        safe = dict(self.details)
        if self.provider_error_code:
            safe["provider_error_code"] = self.provider_error_code
        if self.provider_http_status is not None:
            safe["provider_http_status"] = self.provider_http_status
        if self.correlation_id:
            safe["correlation_id"] = self.correlation_id
        return APIError(self.code, self.message, status, safe)
