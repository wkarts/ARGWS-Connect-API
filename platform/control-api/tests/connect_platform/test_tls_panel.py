"""Integrated diagnostics never require a temporary service, secrets or host writes."""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest

from app.core.tls_diagnostics import error_details
from app.services import tls_panel, tls_status
from test_tls_automation import agent, VHOST


def receipt(**overrides):
    return {"status": "READY", "checked_at": datetime.now(UTC).isoformat(),
            "expires_at": (datetime.now(UTC) + timedelta(days=60)).isoformat(), **overrides}


def test_panel_requires_no_files_when_services_have_not_started(tmp_path, monkeypatch):
    path = tmp_path / "not-created"
    monkeypatch.setattr(tls_status.settings, "platform_tls_status_dir", path)
    report = tls_panel.diagnostic_report()
    assert not path.exists()
    assert report["operator_files"] == ["compose.yaml", ".env"]
    assert report["requires_manual_proof"] is False and report["read_only"] is True
    assert not report["services_confirmed"]
    assert len(report["services"]) == 3
    assert all(row["code"] == "TLS_STATUS_MISSING" for row in report["services"])


def test_panel_uses_same_sanitized_service_evidence(monkeypatch):
    data = {"dns.json": receipt(status="RECONCILIATION_FAILED", error="CLOUDFLARE_HTTP_403"),
            "acme.json": receipt(status="ISSUING"),
            "cloudpanel.json": receipt(status="WAITING_CERTIFICATE", error="CERTIFICATE_NOT_READY")}
    for item in data.values():
        item.update(token="private-never-display", message="private-never-display", private_key="private-never-display",
                    records=[{"password": "private-never-display"}])
    monkeypatch.setattr(tls_status, "receipt", lambda filename: data[filename])
    report = tls_panel.diagnostic_report()
    assert "private-never-display" not in json.dumps(report)
    dns, acme, cloudpanel = report["services"]
    assert dns["state"] == "ERROR" and dns["code"] == "CLOUDFLARE_HTTP_403"
    assert dns["env_fields"] == ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"]
    assert acme["state"] == "RUNNING"
    assert cloudpanel["state"] == "WAITING"


@pytest.mark.parametrize("status,code,state", [("DISABLED", "TLS_AUTOMATION_DISABLED", "DISABLED"),
    ("STAGING", None, "STAGING"), ("ISSUING", None, "RUNNING"),
    ("WAITING_CERTIFICATE", "CERTIFICATE_NOT_READY", "WAITING")])
def test_nonfinal_states_are_never_confirmed(status, code, state, monkeypatch):
    monkeypatch.setattr(tls_status, "receipt", lambda _: receipt(status=status))
    report = tls_panel.diagnostic_report()
    assert not report["services_confirmed"]
    assert all(row["state"] == state and row["code"] == code for row in report["services"])


def test_old_ready_is_not_green(monkeypatch):
    monkeypatch.setattr(tls_status, "receipt", lambda _: receipt(checked_at=(datetime.now(UTC) - timedelta(days=10)).isoformat()))
    report = tls_panel.diagnostic_report()
    assert not report["services_confirmed"]
    assert all(row["state"] == "STALE" and row["code"] == "TLS_STATUS_STALE" for row in report["services"])


@pytest.mark.parametrize("expires,code", [(None, "TLS_STATUS_INVALID"),
    ((datetime.now(UTC)-timedelta(days=1)).isoformat(), "CERTIFICATE_EXPIRED"), ("not-a-date", "TLS_STATUS_INVALID")])
def test_recent_ready_without_valid_certificate_is_not_confirmed(expires, code, monkeypatch):
    monkeypatch.setattr(tls_status, "receipt", lambda _: receipt(expires_at=expires))
    report = tls_panel.diagnostic_report()
    assert not report["services_confirmed"]
    assert all(row["code"] == code for row in report["services"][1:])


def test_only_current_valid_evidence_is_confirmed(monkeypatch):
    monkeypatch.setattr(tls_status, "receipt", lambda _: receipt())
    report = tls_panel.diagnostic_report()
    assert report["services_confirmed"]
    assert report["scope"] == "PLATFORM_SERVICES"
    assert all(row["state"] == "READY" for row in report["services"])


def test_legacy_missing_resource_does_not_claim_a_specific_missing_certificate(monkeypatch):
    monkeypatch.setattr(tls_status, "receipt", lambda _: receipt(status="RECONCILIATION_FAILED", error="FileNotFoundError"))
    report = tls_panel.diagnostic_report()
    assert all(row["code"] == "TLS_RESOURCE_MISSING" for row in report["services"])
    assert "CERTIFICATE_NOT_READY" not in json.dumps(report)
    assert error_details("FileNotFoundError: secret.path")['error'] == 'TLS_UNEXPECTED_ERROR'


def test_reader_does_not_expose_paths_outside_fixed_receipts(tmp_path, monkeypatch):
    secret = tmp_path / "secret.txt"; secret.write_text('{"secret":"not-for-panel"}')
    status = tmp_path / "state"; status.mkdir()
    monkeypatch.setattr(tls_status.settings, "platform_tls_status_dir", status)
    assert tls_status.receipt("../secret.txt") == {}
    for payload in (b'x' * 131073, b'not-json', b'[1,2]'):
        (status/'dns.json').write_bytes(payload)
        assert tls_status.receipt('dns.json') == {}


def test_absent_acme_bundle_is_a_wait_before_any_nginx_mutation(tmp_path, monkeypatch):
    site = tmp_path / "site.conf"; site.write_text(VHOST)
    monkeypatch.setattr(agent, "CERTS", tmp_path / "certs")
    monkeypatch.setattr(agent, "recover_pending", lambda: False)
    monkeypatch.setattr(agent, "ensure_base", lambda _: site)
    monkeypatch.setattr(agent, "check_alias_conflicts", lambda *args: None)
    monkeypatch.setattr(agent, "begin_transaction", lambda *args: pytest.fail('must not mutate host without certificate'))
    monkeypatch.setattr(agent, "host_run", lambda *args: pytest.fail('must not install without certificate'))
    monkeypatch.setenv('CLOUDPANEL_SITE_DOMAIN', 'connect.example.test')
    with pytest.raises(ValueError, match='^CERTIFICATE_NOT_READY$'):
        agent.reconcile_base(['connect.example.test', '*.connect.example.test'], 'test')
    assert site.read_text() == VHOST


class StopLoop(BaseException):
    pass


def test_cloudpanel_loop_logs_code_and_phase_not_private_exception(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(agent, "STATE", tmp_path/'state')
    monkeypatch.setattr(agent, "STATUS", tmp_path/'status')
    monkeypatch.setattr(agent, "HOST", tmp_path/'host')
    (tmp_path/'host/run').mkdir(parents=True)
    monkeypatch.setattr(agent.sys, 'argv', ['service.py'])
    monkeypatch.setattr(agent, 'enabled', lambda: True)
    monkeypatch.setattr(agent, 'configured_names', lambda: ['connect.example.test'])
    monkeypatch.setattr(agent, 'recover_pending', lambda: False)
    monkeypatch.setattr(agent, 'host_run', lambda *args: None)
    def fail(*args): raise FileNotFoundError('never-log-private-key-or-path')
    def stop(*args): raise StopLoop()
    monkeypatch.setattr(agent, 'reconcile_base', fail)
    monkeypatch.setattr(agent.time, 'sleep', stop)
    with pytest.raises(StopLoop): agent.main()
    data = json.loads((tmp_path/'status/cloudpanel.json').read_text())
    assert data['stage'] == 'installation' and data['error'] == 'TLS_RESOURCE_MISSING'
    assert 'never-log' not in capsys.readouterr().out
    assert 'never-log' not in str(data)


@pytest.mark.parametrize('role,expected', [('PLATFORM_SUPERADMIN', 200), ('PLATFORM_ADMIN', 200),
    ('PLATFORM_SUPPORT', 200), ('PLATFORM_AUDITOR', 200), ('TENANT_ADMIN', 403), ('PARTNER_ADMIN', 403)])
def test_endpoint_control_rbac_read_only_and_no_store(role, expected, monkeypatch):
    # Full dependencies are installed by Platform Integrity CI. No DB/network is used here.
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.deps import current_control_user
    from app.api.routes import control_operations
    from app.core.errors import APIError, api_error_handler
    from app.schemas.auth import AuthUser
    app = FastAPI(); app.include_router(control_operations.router)
    app.add_exception_handler(APIError, api_error_handler)
    async def user():
        return AuthUser(id=str(uuid4()), name='Test', email='test@example.com', role=role)
    app.dependency_overrides[current_control_user] = user
    monkeypatch.setattr(tls_status, 'receipt', lambda _: receipt())
    with TestClient(app) as client:
        response = client.get('/api/control/v1/tls/diagnostics')
        assert response.status_code == expected
        if expected == 200:
            assert response.headers['cache-control'] == 'private, no-store'
            assert response.headers['pragma'] == 'no-cache'
            assert response.json()['data']['read_only'] is True
            assert client.post('/api/control/v1/tls/diagnostics').status_code == 405
        else:
            assert 'services' not in response.text


def test_endpoint_rejects_unauthenticated_before_reading_tls(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.deps import current_control_user
    from app.api.routes import control_operations
    from app.core.errors import APIError, api_error_handler
    app = FastAPI(); app.include_router(control_operations.router)
    app.add_exception_handler(APIError, api_error_handler)
    async def unauthenticated(): raise APIError("UNAUTHORIZED", "Autenticação necessária.", 401)
    app.dependency_overrides[current_control_user] = unauthenticated
    monkeypatch.setattr(control_operations, 'diagnostic_report', lambda: pytest.fail('must not read without authentication'))
    with TestClient(app) as client:
        response = client.get('/api/control/v1/tls/diagnostics')
        assert response.status_code == 401
        assert 'services' not in response.text
