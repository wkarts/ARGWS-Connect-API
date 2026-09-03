from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator


INSTANCE_ALIAS_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,48}$")


class EngineInstanceCreate(BaseModel):
    alias: str = Field(min_length=2, max_length=49)
    integration: str = Field(default="WHATSAPP-BAILEYS", min_length=2, max_length=64)
    qrcode: bool = True
    number: str | None = None
    reject_call: bool = False
    msg_call: str = ""
    groups_ignore: bool = False
    always_online: bool = False
    read_messages: bool = False
    read_status: bool = False
    sync_full_history: bool = False
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("alias")
    @classmethod
    def valid_alias(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not INSTANCE_ALIAS_RE.fullmatch(normalized):
            raise ValueError("Use apenas letras minúsculas, números, '_' ou '-', começando por letra/número.")
        return normalized


class TemplatePreviewRequest(BaseModel):
    template: dict[str, Any]
    variables: dict[str, Any] = Field(default_factory=dict)
    provider: str | None = None


class TemplateSendRequest(BaseModel):
    number: str = Field(min_length=8, max_length=32)
    name: str = Field(min_length=1, max_length=512)
    language: str = Field(default="pt_BR", min_length=2, max_length=16)
    variables: dict[str, Any] = Field(default_factory=dict)
    components: list[dict[str, Any]] | None = None


class TextSendRequest(BaseModel):
    number: str = Field(min_length=8, max_length=32)
    text: str = Field(min_length=1, max_length=65535)
    delay: int | None = Field(default=None, ge=0, le=60000)


class EngineActionDefinition(BaseModel):
    actionKey: str = Field(min_length=2, max_length=128)
    name: str = Field(min_length=2, max_length=160)
    description: str | None = None
    method: str = Field(default="GET", pattern=r"^(GET|POST|PUT|PATCH|DELETE)$")
    baseUrl: str = Field(min_length=4, max_length=2048)
    path: str = Field(default="/", max_length=2048)
    credentialRef: str | None = Field(default=None, max_length=255)
    headers: dict[str, str] = Field(default_factory=dict)
    requestTemplate: dict[str, Any] = Field(default_factory=dict)
    inputSchema: dict[str, Any] = Field(default_factory=dict)
    outputMapping: dict[str, Any] = Field(default_factory=dict)
    timeoutMs: int = Field(default=10000, ge=100, le=120000)
    confirmation: str = Field(default="NONE", pattern=r"^(NONE|CONFIRM|STRONG)$")
    allowPrivateNetwork: bool = False
    enabled: bool = True


class EngineActionExecute(BaseModel):
    actionKey: str = Field(min_length=2, max_length=128)
    input: dict[str, Any] = Field(default_factory=dict)
    confirmed: bool = False
    dryRun: bool = True
    recipeKey: str | None = Field(default=None, max_length=128)


class EngineActionDelete(BaseModel):
    actionKey: str = Field(min_length=2, max_length=128)


class EngineRecipeStep(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    action: str = Field(min_length=2, max_length=128)
    input: Any | None = None
    continueOnError: bool = False


class EngineRecipeDefinition(BaseModel):
    recipeKey: str = Field(min_length=2, max_length=128)
    name: str = Field(min_length=2, max_length=160)
    description: str | None = None
    version: int = Field(default=1, ge=1)
    steps: list[EngineRecipeStep] = Field(min_length=1, max_length=100)
    inputSchema: dict[str, Any] = Field(default_factory=dict)
    outputTemplate: Any | None = None
    confirmation: str = Field(default="NONE", pattern=r"^(NONE|CONFIRM|STRONG)$")
    enabled: bool = True


class EngineRecipeExecute(BaseModel):
    recipeKey: str = Field(min_length=2, max_length=128)
    input: dict[str, Any] = Field(default_factory=dict)
    confirmed: bool = False
    dryRun: bool = True


class EngineRecipeDelete(BaseModel):
    recipeKey: str = Field(min_length=2, max_length=128)


class EngineTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=512)
    category: str = Field(default="UTILITY", pattern=r"^(AUTHENTICATION|MARKETING|UTILITY)$")
    allowCategoryChange: bool = False
    language: str = Field(default="pt_BR", min_length=2, max_length=16)
    components: list[dict[str, Any]] = Field(default_factory=list)
    actions: dict[str, Any] = Field(default_factory=dict)
    policy: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    webhookUrl: str | None = Field(default=None, max_length=2048)


class EngineTemplateEdit(BaseModel):
    templateId: str = Field(min_length=1, max_length=512)
    name: str | None = Field(default=None, max_length=512)
    language: str | None = Field(default=None, max_length=16)
    category: str | None = Field(default=None, pattern=r"^(AUTHENTICATION|MARKETING|UTILITY)$")
    allowCategoryChange: bool | None = None
    ttl: int | None = Field(default=None, ge=0)
    components: list[dict[str, Any]] | None = None
    actions: dict[str, Any] | None = None
    policy: dict[str, Any] | None = None
    enabled: bool | None = None
    webhookUrl: str | None = Field(default=None, max_length=2048)


class EngineTemplateDelete(BaseModel):
    name: str = Field(min_length=1, max_length=512)
    hsmId: str | None = Field(default=None, max_length=512)
