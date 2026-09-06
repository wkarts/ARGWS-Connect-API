"""Regression for diagnostics-20260906: the root error must not become PROOF_PENDING."""
from __future__ import annotations

import asyncio
import io
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from zipfile import ZipFile

import pytest
from app.core.tls_diagnostics import error_code, error_details
from app.services import tls_status
from test_tls_automation import acme, agent, common, VHOST


def now(**values): return {'checked_at': datetime.now(UTC).isoformat(), **values}


def test_legacy_valueerror_receipt_recovers_specific_acme_cause(monkeypatch):
    data = {'dns.json': now(status='RECONCILIATION_FAILED', error='ValueError'),
            'acme.json': now(status='RECONCILIATION_FAILED', error='CLOUDFLARE_ZONE_NOT_AUTHORIZED'),
            'cloudpanel.json': now(status='RECONCILIATION_FAILED', error='FileNotFoundError')}
    monkeypatch.setattr(tls_status, 'receipt', lambda filename: data.get(filename, {}))
    assert tls_status.dns_blocking_reason() == 'CLOUDFLARE_ZONE_NOT_AUTHORIZED'
    assert tls_status.snapshot('demo.example.test')['last_error'] == 'CLOUDFLARE_ZONE_NOT_AUTHORIZED'
    assert not tls_status.snapshot('demo.example.test')['dns_ready']


def test_recent_dns_error_is_not_hidden_by_unrelated_cloudpanel_error(monkeypatch):
    data = {'dns.json': now(status='RECONCILIATION_FAILED', error='PLATFORM_DNS_CNAME_LOOP'),
            'acme.json': now(status='RECONCILIATION_FAILED', error='PLATFORM_DNS_CNAME_LOOP'),
            'cloudpanel.json': now(status='WAITING_CERTIFICATE', error='CERTIFICATE_NOT_READY')}
    monkeypatch.setattr(tls_status, 'receipt', lambda filename: data.get(filename, {}))
    assert tls_status.snapshot('demo.example.test')['last_error'] == 'PLATFORM_DNS_CNAME_LOOP'


def test_missing_receipts_do_not_create_files_or_fake_dns_ready(tmp_path, monkeypatch):
    directory = tmp_path/'service-generated'
    monkeypatch.setattr(tls_status.settings, 'platform_tls_status_dir', directory)
    assert tls_status.dns_blocking_reason() == 'TLS_STATUS_MISSING'
    assert tls_status.diagnostic_summary()['requires_manual_proof'] is False
    assert not directory.exists()
    assert not tls_status.snapshot('demo.example.test')['tls_ready']


def test_old_receipts_are_not_treated_as_current_configuration_errors(monkeypatch):
    old = {'checked_at': (datetime.now(UTC)-timedelta(days=30)).isoformat(), 'status': 'READY', 'error': 'INVALID_DOMAIN'}
    monkeypatch.setattr(tls_status, 'receipt', lambda _: old)
    assert tls_status.dns_blocking_reason() == 'TLS_STATUS_STALE'


@pytest.mark.parametrize('raw', ['token-secret-value', 'password=do-not-log', {'token':'never-log'},
                               RuntimeError('Bearer never-log'), ValueError('CLOUDFLARE_TOKEN_REQUIRED\nsecret')])
def test_unknown_messages_and_secret_material_are_not_exported(raw):
    assert error_code(raw) == 'TLS_UNEXPECTED_ERROR'
    assert 'never-log' not in str(error_details(raw))
    assert 'do-not-log' not in str(error_details(raw))


@pytest.mark.parametrize('raw,expected', [(ValueError('INVALID_DOMAIN'),'INVALID_DOMAIN'),
    (RuntimeError('acme.sh_EXIT_1'),'ACME_COMMAND_FAILED'),
    (FileNotFoundError('/secret/path.pem'),'TLS_RESOURCE_MISSING'),
    (PermissionError('/secret/volume'),'TLS_VOLUME_PERMISSION_DENIED'),
    ('CLOUDFLARE_HTTP_403','CLOUDFLARE_HTTP_403')])
def test_controlled_exception_codes_are_preserved(raw,expected):
    assert error_code(raw) == expected
    assert '/secret/' not in str(error_details(raw))


def test_export_never_copies_raw_receipt_fields_or_error_messages(monkeypatch):
    data = now(status='RECONCILIATION_FAILED', stage='dns', error='CLOUDFLARE_HTTP_403',
               CF_Token='never-log', privkey='never-log', message='Bearer never-log', records=[{'secret':'never-log'}])
    monkeypatch.setattr(tls_status, 'receipt', lambda _: data)
    summary = tls_status.diagnostic_summary()
    assert 'never-log' not in json.dumps(summary)
    assert summary['services']['dns']['error'] == 'CLOUDFLARE_HTTP_403'
    assert summary['operator_files'] == ['compose.yaml','.env']


def test_invalid_field_types_in_receipt_do_not_break_bundle_export(monkeypatch):
    monkeypatch.setattr(tls_status,'receipt',lambda _: {'status':[], 'stage':{}, 'error':{'secret':'never-log'}})
    assert tls_status.diagnostic_summary()['services']['acme']['status'] == 'UNKNOWN'


def test_state_log_reports_allowed_error_without_dumping_other_values(tmp_path, capsys):
    common.state(tmp_path/'dns.json', status='RECONCILIATION_FAILED', stage='dns', error='PLATFORM_ORIGIN_DNS_MISSING',
                 password='never-log', token='never-log')
    output = capsys.readouterr().out
    assert 'never-log' not in output
    assert json.loads(output)['error'] == 'PLATFORM_ORIGIN_DNS_MISSING'


class StopCycle(BaseException): pass


@pytest.mark.parametrize('has_token,reason', [(True,'CLOUDFLARE_HTTP_403'),(False,'ACME_EMAIL_AND_CLOUDFLARE_TOKEN_REQUIRED')])
def test_acme_loop_writes_and_logs_real_cause_without_dns_success(tmp_path, monkeypatch, capsys, has_token, reason):
    monkeypatch.setattr(acme,'STATUS',tmp_path/'status')
    monkeypatch.setattr(acme,'DATA',tmp_path/'account')
    monkeypatch.setattr(acme,'Path',lambda p: tmp_path/'challenges' if p=='/challenges' else Path(p))
    monkeypatch.setattr(acme,'configured_names',lambda: ['connect.example.test','*.connect.example.test'])
    monkeypatch.setattr(acme.sys,'argv',['service.py'])
    monkeypatch.setenv('PLATFORM_TLS_AUTOMATION_ENABLED','true')
    monkeypatch.setenv('ACME_EMAIL','test@example.test')
    monkeypatch.setenv('CF_Token','synthetic-secret' if has_token else '')
    calls=[]
    def fail(_):
        calls.append(1)
        raise ValueError('CLOUDFLARE_HTTP_403')
    def stop(_): raise StopCycle()
    monkeypatch.setattr(acme,'reconcile_dns',fail)
    monkeypatch.setattr(acme.time,'sleep',stop)
    with pytest.raises(StopCycle): acme.main()
    for filename in ('acme.json','dns.json'):
        state=json.loads((tmp_path/'status'/filename).read_text())
        assert state['error'] == reason and state['status'] != 'READY'
    assert bool(calls) == has_token
    output=capsys.readouterr().out
    assert reason in output and 'synthetic-secret' not in output


def test_diagnostic_export_includes_sanitized_tls_only_for_platform(monkeypatch):
    from app.services.observability import ObservabilityService
    class Session:
        async def scalars(self,*args): return SimpleNamespace(all=lambda: [])
        async def get(self,*args): return SimpleNamespace(name='Example')
    class Docker:
        async def containers(self): return []
    monkeypatch.setattr(tls_status,'receipt',lambda _: now(status='RECONCILIATION_FAILED',error='CLOUDFLARE_HTTP_403',token='never-log'))
    async def run(tenant=None):
        service=ObservabilityService(Session());service.docker=Docker()
        return await service.export_bundle(tenant)
    contents,_=asyncio.run(run())
    with ZipFile(io.BytesIO(contents)) as z:
        safe=z.read('platform/tls-status.json')
        assert b'never-log' not in safe and b'CLOUDFLARE_HTTP_403' in safe
    contents,_=asyncio.run(run(uuid4()))
    with ZipFile(io.BytesIO(contents)) as z: assert 'platform/tls-status.json' not in z.namelist()
