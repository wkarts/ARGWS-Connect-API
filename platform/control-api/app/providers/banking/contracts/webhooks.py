from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol


@dataclass(frozen=True, slots=True)
class BankWebhookRequest:
    raw_body: bytes
    headers: Mapping[str, str]
    query: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BankWebhookEvent:
    provider_event_id: str
    event_type: str
    signature_valid: bool
    payload_hash: str
    payload: dict[str, Any]
    normalized_payload: dict[str, Any] = field(default_factory=dict)
    headers_sanitized: dict[str, str] = field(default_factory=dict)


class WebhookVerifier(Protocol):
    async def verify_webhook(self, request: BankWebhookRequest) -> bool: ...


class WebhookParser(Protocol):
    async def parse_webhook(self, request: BankWebhookRequest) -> BankWebhookEvent: ...


class WebhookNormalizer(Protocol):
    async def normalize_webhook(self, event: BankWebhookEvent) -> BankWebhookEvent: ...
