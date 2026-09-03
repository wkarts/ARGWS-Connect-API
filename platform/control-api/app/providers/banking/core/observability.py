from __future__ import annotations

from contextlib import contextmanager
from time import perf_counter
from typing import Iterator

import structlog
from prometheus_client import Counter, Histogram

logger = structlog.get_logger("banking")

BANK_REQUEST_TOTAL = Counter(
    "bank_request_total",
    "Total de operações bancárias normalizadas.",
    ("provider", "operation", "status", "environment"),
)
BANK_REQUEST_DURATION = Histogram(
    "bank_request_duration_seconds",
    "Duração das operações bancárias.",
    ("provider", "operation", "environment"),
)
BANK_REQUEST_ERROR_TOTAL = Counter(
    "bank_request_error_total",
    "Erros de operações bancárias.",
    ("provider", "operation", "status", "environment"),
)
BANK_AUTH_REFRESH_TOTAL = Counter(
    "bank_auth_refresh_total",
    "Renovações de autenticação bancária.",
    ("provider", "status", "environment"),
)
BANK_WEBHOOK_TOTAL = Counter(
    "bank_webhook_total",
    "Eventos bancários recebidos por webhook.",
    ("provider", "status", "environment"),
)
BANK_WEBHOOK_INVALID_TOTAL = Counter(
    "bank_webhook_invalid_total",
    "Webhooks bancários rejeitados.",
    ("provider", "environment"),
)
BANK_RECONCILIATION_TOTAL = Counter(
    "bank_reconciliation_total",
    "Resultados do motor de conciliação.",
    ("provider", "status", "environment"),
)
BANK_SYNC_TOTAL = Counter(
    "bank_sync_total",
    "Sincronizações bancárias.",
    ("provider", "operation", "status", "environment"),
)
BANK_CIRCUIT_BREAKER_OPEN = Counter(
    "bank_circuit_breaker_open",
    "Aberturas de circuit breaker bancário.",
    ("provider", "environment"),
)


@contextmanager
def bank_operation_metrics(provider: str, operation: str, environment: str) -> Iterator[None]:
    started = perf_counter()
    try:
        yield
    except Exception:
        BANK_REQUEST_TOTAL.labels(provider, operation, "ERROR", environment).inc()
        BANK_REQUEST_ERROR_TOTAL.labels(provider, operation, "ERROR", environment).inc()
        raise
    else:
        BANK_REQUEST_TOTAL.labels(provider, operation, "SUCCESS", environment).inc()
    finally:
        BANK_REQUEST_DURATION.labels(provider, operation, environment).observe(perf_counter() - started)
