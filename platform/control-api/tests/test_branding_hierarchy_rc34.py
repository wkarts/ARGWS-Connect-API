from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.errors import APIError
from app.services.branding import (
    PLATFORM_BRAND,
    resolve_partner_branding,
    resolve_tenant_branding,
    validate_asset_url,
    validate_color,
)


class FakeSession:
    def __init__(self, objects=None):
        self.objects = objects or {}

    async def get(self, model, object_id):
        return self.objects.get(object_id)


def profile(owner_type="PARTNER", status="PUBLISHED", version=1):
    return SimpleNamespace(
        id=uuid4(), owner_type=owner_type, owner_id=uuid4(), version=version, status=status,
        name="Marca Cliente", short_name="Cliente", logo_light_url="/brand/custom/logo.png",
        logo_dark_url="/brand/custom/logo-dark.png", favicon_url="/brand/custom/favicon.ico",
        apple_touch_icon_url="/brand/custom/apple.png", pwa_icon_192_url="/brand/custom/192.png",
        pwa_icon_512_url="/brand/custom/512.png", primary_color="#112233", accent_color="#445566",
        background_color="#F8FAFC", surface_color="#FFFFFF", text_color="#0F172A",
        manifest_name="Marca Cliente", manifest_short_name="Cliente",
    )


@pytest.mark.asyncio
async def test_partner_platform_uses_connect_api():
    partner = SimpleNamespace(branding_mode="PLATFORM", branding_profile_id=None)
    result = await resolve_partner_branding(FakeSession(), partner)
    assert result["name"] == PLATFORM_BRAND["name"]


@pytest.mark.asyncio
async def test_partner_custom_published_uses_custom_brand():
    p = profile(); partner = SimpleNamespace(branding_mode="CUSTOM", branding_profile_id=p.id)
    result = await resolve_partner_branding(FakeSession({p.id: p}), partner)
    assert result["scope"] == "PARTNER" and result["name"] == "Marca Cliente"


@pytest.mark.asyncio
async def test_partner_custom_draft_falls_back_to_platform():
    p = profile(status="DRAFT"); partner = SimpleNamespace(branding_mode="CUSTOM", branding_profile_id=p.id)
    result = await resolve_partner_branding(FakeSession({p.id: p}), partner)
    assert result["scope"] == "PLATFORM"


@pytest.mark.asyncio
async def test_direct_tenant_inherit_uses_platform():
    tenant = SimpleNamespace(partner_id=None, partner=None, branding_mode="INHERIT", branding_profile_id=None)
    result = await resolve_tenant_branding(FakeSession(), tenant)
    assert result["scope"] == "PLATFORM"


@pytest.mark.asyncio
async def test_direct_tenant_custom_uses_custom_brand():
    p = profile(owner_type="TENANT", version=3)
    tenant = SimpleNamespace(partner_id=None, partner=None, branding_mode="CUSTOM", branding_profile_id=p.id)
    result = await resolve_tenant_branding(FakeSession({p.id: p}), tenant)
    assert result["scope"] == "TENANT" and "brand_v=3" in result["logo_light_url"]


@pytest.mark.asyncio
async def test_partner_tenant_always_inherits_partner_platform():
    partner_id=uuid4(); partner=SimpleNamespace(branding_mode="PLATFORM", branding_profile_id=None)
    tenant=SimpleNamespace(partner_id=partner_id, partner=partner, branding_mode="CUSTOM", branding_profile_id=uuid4())
    result=await resolve_tenant_branding(FakeSession(), tenant)
    assert result["scope"] == "PLATFORM"


@pytest.mark.asyncio
async def test_partner_tenant_inherits_partner_custom():
    p=profile(); partner_id=uuid4(); partner=SimpleNamespace(branding_mode="CUSTOM", branding_profile_id=p.id)
    tenant=SimpleNamespace(partner_id=partner_id, partner=partner, branding_mode="INHERIT", branding_profile_id=None)
    result=await resolve_tenant_branding(FakeSession({p.id:p}), tenant)
    assert result["scope"] == "PARTNER" and result["name"] == "Marca Cliente"


def test_https_asset_allowed():
    assert validate_asset_url("https://cdn.example.com/logo.png") == "https://cdn.example.com/logo.png"


def test_same_origin_asset_allowed():
    assert validate_asset_url("/branding/logo.png") == "/branding/logo.png"


def test_http_asset_rejected_and_color_validated():
    with pytest.raises(APIError): validate_asset_url("http://example.com/logo.png")
    assert validate_color("#aabbcc") == "#AABBCC"
