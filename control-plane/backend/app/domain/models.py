from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class InstallationStatus(StrEnum):
    PENDING = "PENDING"
    PROVISIONING = "PROVISIONING"
    ACTIVE = "ACTIVE"
    DEGRADED = "DEGRADED"
    SUSPENDED = "SUSPENDED"
    ERROR = "ERROR"


class Partner(BaseModel):
    id: UUID
    slug: str
    name: str
    active: bool = True


class Tenant(BaseModel):
    id: UUID
    slug: str
    name: str
    partner_id: UUID | None = None
    active: bool = True


class Installation(BaseModel):
    id: UUID
    tenant_id: UUID
    node_id: UUID | None = None
    product: str = "ARGWS_CONNECT_API"
    channel: str = "stable"
    status: InstallationStatus = InstallationStatus.PENDING
    hostname: str
    database_name: str
    redis_namespace: str
    storage_namespace: str
    metadata: dict = Field(default_factory=dict)
