from __future__ import annotations


def test_control_api_application_imports_all_routes() -> None:
    from app.main import app

    assert app is not None


def test_tenant_connect_route_imports() -> None:
    from app.api.routes import tenant_connect

    assert tenant_connect.router is not None
