from __future__ import annotations

from app.models.platform import EngineBinding
from app.services.engine_binding import canonical_engine_instance_name


def test_engine_instance_name_is_tenant_scoped() -> None:
    assert canonical_engine_instance_name("acme", "atendimento") == "t-acme-atendimento"
    assert canonical_engine_instance_name("grupo-a", "atendimento") == "t-grupo-a-atendimento"
    assert canonical_engine_instance_name("Minha Empresa", "Comercial 01") == "t-minha-empresa-comercial-01"


def test_engine_binding_has_isolation_columns() -> None:
    columns = EngineBinding.__table__.columns
    assert "tenant_id" in columns
    assert "instance_name" in columns
    assert "provider" in columns
    assert "capabilities" in columns
