from __future__ import annotations

import importlib.util
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[3] / 'infrastructure'
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'acme'))
import tls_common as common
from cloudflare_dns import CloudflareDNS, reconcile_dns


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


acme = module('tls_acme_tests', 'acme/service.py')
agent = module('tls_agent_tests', 'cloudpanel-agent/service.py')


def certificate(directory: Path, names=None, days=60):
    names = names or ['connect.example.test', '*.connect.example.test']
    directory.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, names[0])])
    now = datetime.now(UTC)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=2)).not_valid_after(now + timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name) for name in names]), False)
            .sign(key, hashes.SHA256()))
    pem = cert.public_bytes(serialization.Encoding.PEM)
    for name in ['fullchain.pem', 'cert.pem', 'ca.pem']: (directory/name).write_bytes(pem)
    (directory/'privkey.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return common.bundle(directory, names) if days > 0 else None


def test_develop_sans_cover_fixed_hosts_as_well_as_tenant_wildcard():
    names = common.configured_names({'ACME_DOMAIN':'d.connect.example.test', 'TENANT_DOMAIN_ROOT':'d.connect.example.test',
                                    'CONTROL_PLANE_HOST':'d.control.connect.example.test'})
    assert '*.d.connect.example.test' in names
    assert 'd.control.connect.example.test' in names
    assert names.count('d.connect.example.test') == 1
    assert not common.covers('*.d.connect.example.test', 'd.control.connect.example.test')


@pytest.mark.parametrize('name', ['bad\nsite.com', 'a;delete.com', 'https://example.com', '../host.com', '*.bad.com', 'a_b.example.com'])
def test_invalid_hostnames_are_rejected(name):
    with pytest.raises(ValueError): common.hostname(name)


def test_wildcard_never_covers_two_levels():
    assert common.covers('*.connect.example.test', 'demo.connect.example.test')
    assert not common.covers('*.connect.example.test', 'a.b.connect.example.test')
    assert not common.covers('*.connect.example.test', 'connect.example.test')


def test_certificates_require_matching_names_key_and_dates(tmp_path):
    info = certificate(tmp_path/'good')
    assert info['days_remaining'] >= 59
    with pytest.raises(ValueError, match='SAN'): common.bundle(tmp_path/'good', ['not-covered.example.test'])
    certificate(tmp_path/'wrong')
    (tmp_path/'good/privkey.pem').write_bytes((tmp_path/'wrong/privkey.pem').read_bytes())
    with pytest.raises(ValueError, match='KEY'): common.bundle(tmp_path/'good', ['connect.example.test'])
    certificate(tmp_path/'expired', days=-1)
    with pytest.raises(ValueError, match='EXPIRED'): common.bundle(tmp_path/'expired', ['connect.example.test'])


def test_valid_bundle_is_not_reissued(tmp_path, monkeypatch):
    target = tmp_path/'certs'
    certificate(target/'bundle-v1')
    (target/'current').symlink_to('bundle-v1')
    monkeypatch.setattr(acme, 'STATUS', tmp_path/'status')
    monkeypatch.setattr(acme, 'verify_chain', lambda path: None)
    monkeypatch.setattr(acme, 'run', lambda *a, **k: pytest.fail('valid certificate must not contact CA'))
    acme.issue(target, ['connect.example.test','*.connect.example.test'], True, False)
    assert json.loads((tmp_path/'status/acme.json').read_text())['status'] == 'READY'


def test_failed_renewal_preserves_previous_bundle(tmp_path, monkeypatch):
    target=tmp_path/'certs'
    certificate(target/'bundle-old', days=10)
    (target/'current').symlink_to('bundle-old')
    before=(target/'current/fullchain.pem').read_bytes()
    monkeypatch.setattr(acme, 'STATUS', tmp_path/'status')
    monkeypatch.setattr(acme, 'DATA', tmp_path/'data')
    monkeypatch.setattr(acme, 'verify_chain', lambda path: None)
    def fail(*args, **kwargs): raise RuntimeError('CA_UNAVAILABLE')
    monkeypatch.setattr(acme, 'run', fail)
    with pytest.raises(RuntimeError): acme.issue(target,['connect.example.test','*.connect.example.test'],True,False)
    assert (target/'current/fullchain.pem').read_bytes()==before


VHOST = '''server {
    listen 443 ssl;
    server_name connect.example.test;
    location / {
        proxy_set_header Host connect.example.test;
        proxy_pass http://127.0.0.1:38800;
    }
}
'''


def test_vhost_update_is_scoped_and_idempotent_and_preserves_host():
    names=['connect.example.test','*.connect.example.test']
    updated=agent.reconcile_proxy(VHOST, names[0], names)
    assert 'server_name connect.example.test *.connect.example.test;' in updated
    assert 'proxy_set_header Host $host;' in updated
    assert updated==agent.reconcile_proxy(updated,names[0],names)
    with pytest.raises(ValueError): agent.reconcile_proxy(VHOST,'other.example.test',names)


def test_nginx_rejection_rolls_back_exact_file(tmp_path, monkeypatch):
    file=tmp_path/'site.conf'; file.write_text(VHOST)
    calls=[]
    def host_run(*args):
        calls.append(args)
        if len(calls)==1: raise RuntimeError('NGINX_INVALID')
    monkeypatch.setattr(agent,'host_run',host_run)
    with pytest.raises(RuntimeError): agent.apply_vhost(file, VHOST+'invalid;\n')
    assert file.read_text()==VHOST
    assert calls[-2:]==[('nginx','-t'),('nginx','-s','reload')]


def test_no_base_reverse_proxy_means_no_site_creation(tmp_path, monkeypatch):
    monkeypatch.setattr(agent,'HOST',tmp_path)
    monkeypatch.setattr(agent,'host_run',lambda *a: pytest.fail('must wait, not create a host site'))
    with pytest.raises(ValueError,match='BASE_REVERSE_PROXY_MISSING'): agent.ensure_base('connect.example.test')


def test_site_selection_requires_exact_server_name(tmp_path, monkeypatch):
    directory=tmp_path/'etc/nginx/sites-enabled'; directory.mkdir(parents=True)
    (directory/'wrong.conf').write_text(VHOST.replace('connect.example.test','evilconnect.example.test'))
    monkeypatch.setattr(agent,'HOST',tmp_path)
    assert agent.find_vhost('connect.example.test') is None
    (directory/'correct.conf').write_text(VHOST)
    assert agent.find_vhost('connect.example.test')==directory/'correct.conf'


def test_live_health_never_accepts_pending_or_staging(tmp_path):
    file=tmp_path/'status.json'
    for status in ['STAGING','ISSUING','INSTALLATION_FAILED']:
        common.state(file,status=status,expires_at=(datetime.now(UTC)+timedelta(days=30)).isoformat())
        with pytest.raises(ValueError): common.check_health(file,300)
    common.state(file,status='DISABLED')
    common.check_health(file,300)


class DNSFake(CloudflareDNS):
    def __init__(self):
        super().__init__({'CF_Token':'test-token-not-real','CLOUDFLARE_TENANT_RECORD_TARGET':'93.184.216.34'})
        self.data={}
        self.writes=[]
    def zone(self,name): return 'testzone'
    def records(self,name): return self.data.get(name,[])
    def request(self,method,path,params=None,body=None):
        assert method in {'PUT','POST'}
        self.writes.append((method,body))
        self.data[body['name']]=[{'id':str(len(self.writes)),**body}]
        return self.data[body['name']][0]


def test_dns_wildcard_and_fixed_hosts_are_dns_only_and_repeat_safe():
    client=DNSFake(); names=['connect.example.test','*.connect.example.test','d.control.example.test']
    result=reconcile_dns(names,client=client)
    assert len(result)==3 and len(client.writes)==3
    assert all(not row['proxied'] for _,row in client.writes)
    reconcile_dns(names,client=client)
    assert len(client.writes)==3
    assert all('_acme-challenge' not in row['name'] for _,row in client.writes)


def test_dns_preserves_unrelated_records_and_refuses_ambiguous_conflict():
    client=DNSFake()
    client.data['other.example.test']=[{'id':'foreign','type':'A','content':'192.0.2.1'}]
    client.data['connect.example.test']=[{'id':'a','type':'A','content':'192.0.2.1'},{'id':'b','type':'AAAA','content':'2001:db8::1'}]
    with pytest.raises(ValueError,match='CONFLICT'): client.ensure('connect.example.test',[('CNAME','origin.example.test')])
    assert not client.writes
    assert client.data['other.example.test'][0]['id']=='foreign'


def test_issued_file_is_not_proof_of_installed_tls(tmp_path, monkeypatch):
    from app.services import tls_status
    monkeypatch.setattr(tls_status.settings,'platform_tls_status_dir',tmp_path)
    common.state(tmp_path/'dns.json',status='READY',domains=['*.connect.example.test'])
    common.state(tmp_path/'acme.json',status='READY',expires_at=(datetime.now(UTC)+timedelta(days=30)).isoformat())
    assert tls_status.snapshot('demo.connect.example.test')['dns_ready']
    assert not tls_status.snapshot('demo.connect.example.test')['tls_ready']
    common.state(tmp_path/'cloudpanel.json',status='READY',sans=['*.connect.example.test'],expires_at=(datetime.now(UTC)+timedelta(days=30)).isoformat())
    assert tls_status.snapshot('demo.connect.example.test')['tls_ready']
    assert not tls_status.snapshot('a.b.connect.example.test')['tls_ready']


def test_transient_receipt_failure_preserves_a_verified_site_until_certificate_expires(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from app.services import tls_status
    monkeypatch.setattr(tls_status.settings, 'platform_tls_status_dir', tmp_path)
    monkeypatch.setattr(tls_status.settings, 'public_scheme', 'https')
    domain=SimpleNamespace(hostname='demo.connect.example.test', status='ACTIVE', ssl_status='ACTIVE',
        provider_metadata={'verified_tls':{'expires_at':(datetime.now(UTC)+timedelta(days=10)).isoformat()}},
        last_error=None)
    tls_status.apply_receipt(domain)
    assert domain.status=='ACTIVE' and domain.ssl_status=='RECHECK_PENDING'
    domain.provider_metadata['verified_tls']['expires_at']=(datetime.now(UTC)-timedelta(seconds=1)).isoformat()
    tls_status.apply_receipt(domain)
    assert domain.status=='WAITING_DNS' and domain.ssl_status=='PENDING'
