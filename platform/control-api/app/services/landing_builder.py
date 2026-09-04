from __future__ import annotations

import copy
import json
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.landing import PlatformLandingPage, PlatformLandingRevision
from app.models.platform import PlatformSetting

ALLOWED_BLOCK_TYPES = {
    "hero", "text", "features", "plans", "image", "gallery", "cta", "divider", "spacer", "html"
}
MAX_BLOCKS = 80
MAX_DOCUMENT_BYTES = 300_000
MAX_CUSTOM_CSS_BYTES = 120_000

_SCRIPT_BLOCK = re.compile(r"<(script|iframe|object|embed|link|meta)(?:\s[^>]*)?>.*?</\1\s*>", re.I | re.S)
_SELF_CLOSING_DANGEROUS = re.compile(r"<(script|iframe|object|embed|link|meta)(?:\s[^>]*)?/?>", re.I | re.S)
_EVENT_HANDLER = re.compile(r"\s+on[a-z0-9_-]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_JS_PROTOCOL = re.compile(r"(?:javascript|vbscript)\s*:", re.I)
_DATA_HTML = re.compile(r"data\s*:\s*text/html", re.I)


def default_document(legacy: dict[str, Any] | None = None) -> dict[str, Any]:
    legacy = legacy or {}
    brand = str(legacy.get("brand_name") or "Connect|API Platform")
    headline = str(legacy.get("headline") or "Comunicação e integrações para conectar canais, sistemas e operações em uma única plataforma.")
    subheadline = str(
        legacy.get("subheadline")
        or "Centralize canais, APIs, webhooks, eventos e automações com governança multitenant."
    )
    cta_label = str(legacy.get("cta_label") or "Falar sobre a plataforma")
    cta_url = str(legacy.get("cta_url") or "")
    blocks: list[dict[str, Any]] = [
        {
            "id": "hero-main",
            "type": "hero",
            "name": "Apresentação",
            "props": {
                "eyebrow": "GESTÃO FINANCEIRA",
                "title": headline,
                "text": subheadline,
                "button_label": cta_label,
                "button_url": cta_url,
                "secondary_label": "",
                "secondary_url": "",
            },
            "style": {"background": "#081722", "color": "#f8fafc", "accent": "#06B6D4", "padding": "96px 24px"},
        },
        {
            "id": "features-main",
            "type": "features",
            "name": "Benefícios",
            "props": {
                "title": "Uma operação conectada e governada",
                "text": "Apresente benefícios comerciais sem expor a arquitetura interna da plataforma.",
                "items": [
                    "Canais e integrações centralizados",
                    "Comunicação multicanal com seus clientes",
                    "Histórico e rastreabilidade operacional",
                ],
            },
            "style": {"background": "#ffffff", "color": "#0f172a", "accent": "#2563EB", "padding": "72px 24px"},
        },
    ]
    if legacy.get("show_plans", True):
        blocks.append(
            {
                "id": "plans-main",
                "type": "plans",
                "name": "Planos",
                "props": {"title": "Planos", "text": "Escolha a configuração que melhor atende sua operação."},
                "style": {"background": "#f8fafc", "color": "#0f172a", "accent": "#2563EB", "padding": "72px 24px"},
            }
        )
    if legacy.get("show_gallery") and legacy.get("gallery"):
        blocks.append(
            {
                "id": "gallery-main",
                "type": "gallery",
                "name": "Galeria",
                "props": {"title": "Conheça a experiência", "items": legacy.get("gallery") or []},
                "style": {"background": "#ffffff", "color": "#0f172a", "accent": "#2563EB", "padding": "72px 24px"},
            }
        )
    blocks.append(
        {
            "id": "cta-main",
            "type": "cta",
            "name": "Chamada final",
            "props": {
                "title": "Quer conversar sobre a plataforma?",
                "text": "Entre em contato para conhecer possibilidades comerciais e de implantação.",
                "button_label": cta_label,
                "button_url": cta_url,
            },
            "style": {"background": "#2563EB", "color": "#ffffff", "accent": "#06B6D4", "padding": "64px 24px"},
        }
    )
    return {
        "schema_version": 1,
        "meta": {
            "brand_name": brand,
            "seo_title": brand,
            "seo_description": subheadline[:240],
            "language": "pt-BR",
        },
        "theme": {
            "font_family": "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "page_background": "#f8fafc",
            "text_color": "#0f172a",
            "primary_color": "#2563EB",
            "accent_color": "#06B6D4",
            "radius": "18px",
            "content_width": "1120px",
        },
        "blocks": blocks,
    }


def _sanitize_html(value: str) -> str:
    value = value[:80_000]
    value = _SCRIPT_BLOCK.sub("", value)
    value = _SELF_CLOSING_DANGEROUS.sub("", value)
    value = _EVENT_HANDLER.sub("", value)
    value = _JS_PROTOCOL.sub("", value)
    value = _DATA_HTML.sub("", value)
    return value


def _sanitize_string(value: str, *, limit: int = 20_000) -> str:
    return value.replace("\x00", "")[:limit]


def _sanitize_value(value: Any, *, key: str = "", depth: int = 0) -> Any:
    if depth > 8:
        return None
    if isinstance(value, str):
        if key.lower() == "html":
            return _sanitize_html(value)
        return _sanitize_string(value)
    if isinstance(value, bool) or value is None or isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        return [_sanitize_value(item, depth=depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        return {
            _sanitize_string(str(item_key), limit=80): _sanitize_value(item_value, key=str(item_key), depth=depth + 1)
            for item_key, item_value in list(value.items())[:100]
        }
    return _sanitize_string(str(value))


def sanitize_document(document: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise APIError("LANDING_DOCUMENT_INVALID", "Documento da landing page inválido.", 422)
    raw_size = len(json.dumps(document, ensure_ascii=False, default=str).encode("utf-8"))
    if raw_size > MAX_DOCUMENT_BYTES:
        raise APIError("LANDING_DOCUMENT_TOO_LARGE", "A landing page excede o limite de conteúdo permitido.", 422)
    blocks = document.get("blocks")
    if not isinstance(blocks, list):
        raise APIError("LANDING_BLOCKS_REQUIRED", "A landing page precisa possuir uma lista de blocos.", 422)
    if len(blocks) > MAX_BLOCKS:
        raise APIError("LANDING_BLOCK_LIMIT", f"A landing page aceita no máximo {MAX_BLOCKS} blocos.", 422)
    cleaned: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "").lower()
        if block_type not in ALLOWED_BLOCK_TYPES:
            raise APIError("LANDING_BLOCK_UNSUPPORTED", f"Bloco não suportado: {block_type or 'sem tipo'}.", 422)
        block_id = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(block.get("id") or f"block-{index + 1}"))[:80]
        if not block_id or block_id in used_ids:
            block_id = f"block-{index + 1}"
        used_ids.add(block_id)
        cleaned.append(
            {
                "id": block_id,
                "type": block_type,
                "name": _sanitize_string(str(block.get("name") or block_type.title()), limit=120),
                "props": _sanitize_value(block.get("props") if isinstance(block.get("props"), dict) else {}),
                "style": _sanitize_value(block.get("style") if isinstance(block.get("style"), dict) else {}),
            }
        )
    result = {
        "schema_version": 1,
        "meta": _sanitize_value(document.get("meta") if isinstance(document.get("meta"), dict) else {}),
        "theme": _sanitize_value(document.get("theme") if isinstance(document.get("theme"), dict) else {}),
        "blocks": cleaned,
    }
    return result


def sanitize_css(css: str) -> str:
    raw = str(css or "")
    if len(raw.encode("utf-8")) > MAX_CUSTOM_CSS_BYTES:
        raise APIError("LANDING_CSS_TOO_LARGE", "O CSS personalizado excede o limite permitido.", 422)
    raw = raw.replace("</style", "<\\/style")
    raw = re.sub(r"expression\s*\(", "", raw, flags=re.I)
    raw = _JS_PROTOCOL.sub("", raw)
    raw = _DATA_HTML.sub("", raw)
    return raw


async def get_or_create_landing(session: AsyncSession) -> PlatformLandingPage:
    item = await session.scalar(select(PlatformLandingPage).where(PlatformLandingPage.key == "PUBLIC"))
    if item is not None:
        return item
    legacy_item = await session.scalar(select(PlatformSetting).where(PlatformSetting.key == "PUBLIC.LANDING"))
    legacy = dict(legacy_item.value or {}) if legacy_item else {}
    document = default_document(legacy)
    item = PlatformLandingPage(
        key="PUBLIC",
        name="Landing principal",
        enabled=bool(legacy.get("enabled", True)),
        draft_document=document,
        draft_css="",
        published_document=document,
        published_css="",
        current_revision=1,
        published_revision=1,
        published_at=datetime.now(UTC),
    )
    session.add(item)
    await session.flush()
    session.add(
        PlatformLandingRevision(
            landing_id=item.id,
            revision=1,
            document=copy.deepcopy(document),
            custom_css="",
            note="Importação da configuração pública anterior",
            is_published=True,
            actor_id=None,
            created_at=datetime.now(UTC),
        )
    )
    return item


async def create_revision(
    session: AsyncSession,
    page: PlatformLandingPage,
    *,
    actor_id: UUID | None,
    note: str | None,
    published: bool,
) -> PlatformLandingRevision:
    page.current_revision = int(page.current_revision or 0) + 1
    revision = PlatformLandingRevision(
        landing_id=page.id,
        revision=page.current_revision,
        document=copy.deepcopy(page.draft_document or {}),
        custom_css=page.draft_css or "",
        note=(note or None),
        is_published=published,
        actor_id=actor_id,
        created_at=datetime.now(UTC),
    )
    session.add(revision)
    await session.flush()
    return revision
