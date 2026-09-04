from __future__ import annotations


def test_tenant_connect_route_imports() -> None:
    from app.api.routes import tenant_connect

    assert tenant_connect.router is not None
