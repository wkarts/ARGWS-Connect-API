"""Regression coverage for legacy certificate recovery and the clpctl boundary."""
from __future__ import annotations

import json
import shutil

import pytest

from test_tls_automation import acme, agent, common, certificate, VHOST


def test_untrusted_cached_order_must_not_skip_ca(tmp_path, monkeypatch):
    names = ['connect.example.test', '*.connect.example.test']
    issued = tmp_path/'issued'
    certificate(issued)
    data = tmp_path/'data'
    store = data/(names[0] + '_ecc')
    store.mkdir(parents=True)
    for name, target in {'privkey.pem':names[0]+'.key', 'cert.pem':names[0]+'.cer',
                         'ca.pem':'ca.cer', 'fullchain.pem':'fullchain.cer'}.items():
        shutil.copyfile(issued/name, store/target)
    monkeypatch.setattr(acme, 'DATA', data)
    monkeypatch.setattr(acme, 'STATUS', tmp_path/'status')
    def untrusted(*args): raise RuntimeError('UNTRUSTED_CHAIN')
    monkeypatch.setattr(acme, 'verify_chain', untrusted)
    commands = []
    def ca(argv, **kwargs):
        commands.append(argv)
        raise RuntimeError('CA_ATTEMPTED')
    monkeypatch.setattr(acme, 'run', ca)
    with pytest.raises(RuntimeError, match='CA_ATTEMPTED'):
        acme.issue(tmp_path/'output', names, True, False)
    assert '--issue' in commands[0] and '--force' in commands[0]


@pytest.mark.parametrize('installer_fails', [False, True])
def test_installation_receipt_follows_probe_and_failed_install_restores_files(tmp_path, monkeypatch, installer_fails):
    host, certs, state, status = (tmp_path/name for name in ('host', 'certs', 'state', 'status'))
    enabled = host/'etc/nginx/sites-enabled'
    enabled.mkdir(parents=True)
    (host/'run').mkdir()
    (host/'etc/nginx/ssl').mkdir()
    old_key = host/'etc/nginx/ssl/base.key'
    old_key.write_text('old-private-key')
    vhost = enabled/'base.conf'
    vhost.write_text(VHOST.replace('    listen 443 ssl;', '    listen 443 ssl;\n    ssl_certificate_key /etc/nginx/ssl/base.key;'))
    names = ['connect.example.test', '*.connect.example.test']
    certificate(certs/'bundle-v1')
    (certs/'current').symlink_to('bundle-v1')
    for attr, value in [('HOST',host), ('CERTS',certs), ('STATE',state), ('STATUS',status)]:
        monkeypatch.setattr(agent, attr, value)
    monkeypatch.setenv('CLOUDPANEL_SITE_DOMAIN', names[0])
    monkeypatch.setattr(agent, 'verify_chain', lambda path: None)
    calls, probes = [], []
    def probe(requested, fingerprint):
        probes.append(fingerprint)
        if len(probes) == 1: raise ValueError('SERVED_CERTIFICATE_MISMATCH')
    def host_run(*argv):
        calls.append(argv)
        if argv[0] == 'clpctl':
            assert argv[1] == 'site:install:certificate'
            assert any(value.endswith('/ca.pem') for value in argv)
            old_key.write_text('new-private-key')
            if installer_fails: raise RuntimeError('INSTALL_FAILED')
    monkeypatch.setattr(agent, 'host_run', host_run)
    monkeypatch.setattr(agent, 'probe', probe)
    if installer_fails:
        with pytest.raises(RuntimeError, match='INSTALL_FAILED'):
            agent.reconcile_base(names, 'test-only')
        assert old_key.read_text() == 'old-private-key'
        assert not (status/'cloudpanel.json').exists()
    else:
        agent.reconcile_base(names, 'test-only')
        assert len(probes) == 2
        assert json.loads((status/'cloudpanel.json').read_text())['status'] == 'READY'
    assert len([argv for argv in calls if argv[0]=='clpctl']) == 1
    assert not (host/'run/connect-api-cloudpanel-test-only').exists()
