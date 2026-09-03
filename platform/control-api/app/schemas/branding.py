from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from slugify import slugify

from app.schemas.common import ORMModel


class PartnerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    slug: str | None = Field(default=None, min_length=2, max_length=80)
    hostname: str | None = Field(default=None, max_length=253)

    @field_validator("slug", mode="before")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        return slugify(value) if value else value

    @field_validator("hostname")
    @classmethod
    def normalize_hostname(cls, value: str | None) -> str | None:
        return value.strip().lower().rstrip(".") if value else None


class PartnerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    hostname: str | None = Field(default=None, max_length=253)
    status: Literal["ACTIVE", "SUSPENDED", "ARCHIVED"] | None = None

    @field_validator("hostname")
    @classmethod
    def normalize_hostname(cls, value: str | None) -> str | None:
        return value.strip().lower().rstrip(".") if value else None


class PartnerRead(ORMModel):
    id: UUID
    name: str
    slug: str
    status: str
    hostname: str | None
    branding_mode: str
    branding_profile_id: UUID | None
    created_at: datetime


class BrandingDraftInput(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    short_name: str | None = Field(default=None, max_length=80)
    logo_light_url: str | None = None
    logo_dark_url: str | None = None
    favicon_url: str | None = None
    apple_touch_icon_url: str | None = None
    pwa_icon_192_url: str | None = None
    pwa_icon_512_url: str | None = None
    primary_color: str = "#2563EB"
    accent_color: str = "#06B6D4"
    background_color: str = "#F8FAFC"
    surface_color: str = "#FFFFFF"
    text_color: str = "#0F172A"
    manifest_name: str | None = None
    manifest_short_name: str | None = None


class BrandingProfileRead(ORMModel):
    id: UUID
    owner_type: str
    owner_id: UUID
    version: int
    status: str
    name: str
    short_name: str | None
    logo_light_url: str | None
    logo_dark_url: str | None
    favicon_url: str | None
    apple_touch_icon_url: str | None
    pwa_icon_192_url: str | None
    pwa_icon_512_url: str | None
    primary_color: str
    accent_color: str
    background_color: str
    surface_color: str
    text_color: str
    manifest_name: str | None
    manifest_short_name: str | None
    published_at: datetime | None
    created_at: datetime
