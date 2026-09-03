from __future__ import annotations

import importlib.util
from pathlib import Path


def load_domain_agent():
    path = Path(__file__).resolve().parents[2] / "scripts" / "domain_agent.py"
    spec = importlib.util.spec_from_file_location("connect_api_domain_agent", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_domain_agent_manages_waiting_ssl_and_active_domains() -> None:
    module = load_domain_agent()
    assert module.MANAGED_DOMAIN_STATUSES == {"WAITING_SSL", "ACTIVE"}


def test_domain_agent_generates_safe_vhost_for_valid_hostname(tmp_path: Path) -> None:
    module = load_domain_agent()
    hostname = "cobranca.cliente.com.br"
    assert module.HOSTNAME_RE.fullmatch(hostname)
    assert not module.HOSTNAME_RE.fullmatch("../etc/passwd")
    config = module.https_config(hostname, "http://127.0.0.1:8800", tmp_path)
    assert f"server_name {hostname};" in config
    assert "proxy_set_header Host $host;" in config
    assert "proxy_pass http://127.0.0.1:8800;" in config
