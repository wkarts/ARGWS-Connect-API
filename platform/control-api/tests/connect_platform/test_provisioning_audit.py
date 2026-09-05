"""Regressions discovered in the Scheduler Pro contract audit; no live DNS writes."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

INFRA = Path(__file__).resolve().parents[3]/'infrastructure'
sys.path.insert(0, str(INFRA))
sys.path.insert(0, str(INFRA/'acme'))
from cloudflare_dns import CloudflareDNS, reconcile_dns
from tls_common import configured_names

spec = importlib.util.spec_from_file_location('audit_cloudpanel_agent', INFRA/'cloudpanel-agent/service.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class DNS(CloudflareDNS):
    def __init__(self, target='proxy.connect.example.test'):
        super().__init__({'CF_Token': 'fake-test-token', 'CLOUDFLARE_TENANT_RECORD_TARGET': target})
        self.data, self.writes = {}, []
    def zone(self, name): return 'zone'
    def records(self, name): return self.data.get(name, [])
    def request(self, method, path, params=None, body=None):
        assert method in {'PUT','POST'}
        self.writes.append((method, body))
        self.data[body['name']] = [{'id': 'mock', **body}]
        return self.data[body['name']][0]


def test_cname_origin_is_created_only_with_an_explicit_public_ip():
    dns = DNS()
    with pytest.raises(ValueError, match='MISSING'):
        reconcile_dns(['connect.example.test','*.connect.example.test'], client=dns)
    assert dns.writes == []
    dns.env['CLOUDFLARE_ORIGIN_IPV4'] = '93.184.216.34'
    rows = reconcile_dns(['connect.example.test','*.connect.example.test'], client=dns)
    assert dns.data['proxy.connect.example.test'][0]['content'] == '93.184.216.34'
    assert all(row['proxied'] is False for row in rows)


def test_cname_chain_is_verified_not_just_the_first_alias():
    dns = DNS()
    dns.data['proxy.connect.example.test'] = [{'id':'one','type':'CNAME','content':'external.example.test','proxied':False}]
    dns.data['external.example.test'] = [{'id':'other','type':'A','content':'93.184.216.34','proxied':True}]
    with pytest.raises(ValueError,match='CHAIN_PROXIED'):
        reconcile_dns(['connect.example.test','*.connect.example.test'], client=dns)
    assert dns.writes == []
    assert dns.data['external.example.test'][0]['proxied'] is True


def test_alias_loop_is_rejected_before_managed_alias_is_changed():
    dns = DNS('api.connect.example.test')
    with pytest.raises(ValueError,match='CNAME_LOOP'):
        reconcile_dns(['connect.example.test','*.connect.example.test','api.connect.example.test'], client=dns)
    assert not dns.writes


@pytest.mark.parametrize('address', ['127.0.0.1','10.0.0.1','169.254.1.1','::1','0.0.0.0'])
def test_private_or_nonroutable_origin_is_not_published(address):
    dns = DNS(address)
    with pytest.raises(ValueError,match='PUBLIC'): reconcile_dns(['connect.example.test'], client=dns)


def test_readback_mismatch_cannot_publish_ready():
    dns = DNS('93.184.216.34')
    dns.request = lambda *a, **k: {'success': True}
    with pytest.raises(ValueError,match='READBACK'):
        reconcile_dns(['connect.example.test'], client=dns)


def test_ignored_wildcard_setting_is_now_rejected():
    with pytest.raises(ValueError,match='WILDCARD_NOT'):
        configured_names({'ACME_DOMAIN':'connect.example.test','CLOUDPANEL_WILDCARD_DOMAIN':'*.different.example.test'})


VHOST = '''server {
    listen 443 ssl;
    server_name connect.example.test;
    location / {
        proxy_set_header Host connect.example.test;
        proxy_pass http://127.0.0.1:9999;
    }
}
'''


def test_wrong_literal_upstream_is_corrected_only_inside_managed_proxy(monkeypatch):
    monkeypatch.setenv('CLOUDPANEL_REVERSE_PROXY_URL','http://127.0.0.1:38800')
    names=['connect.example.test','*.connect.example.test']
    updated = agent.reconcile_proxy(VHOST, names[0], names)
    assert '9999' not in updated
    assert 'proxy_pass http://127.0.0.1:38800;' in updated
    assert 'proxy_set_header Host $host;' in updated
    assert agent.reconcile_proxy(updated,names[0],names)==updated
    with pytest.raises(ValueError,match='UNMANAGED'):
        agent.reconcile_proxy(VHOST.replace('127.0.0.1:9999','elsewhere.example.test:80'), names[0], names)
    with pytest.raises(ValueError,match='UNMANAGED'):
        agent.reconcile_proxy(VHOST.replace('127.0.0.1:9999','$backend'), names[0], names)


def test_journal_recovers_after_process_dies_before_exception_handler(tmp_path,monkeypatch):
    host=tmp_path/'host'; state=tmp_path/'state';state.mkdir()
    file=host/'etc/nginx/sites-enabled/site.conf';file.parent.mkdir(parents=True);file.write_text(VHOST)
    monkeypatch.setattr(agent,'HOST',host);monkeypatch.setattr(agent,'STATE',state)
    calls=[];monkeypatch.setattr(agent,'host_run', lambda *args: calls.append(args))
    backup=agent.begin_transaction(file)
    assert (state/'pending.json').exists()
    assert (backup/'manifest.json').exists()
    file.write_text('incomplete mutation after simulated process crash')
    assert agent.recover_pending()
    assert file.read_text()==VHOST
    assert not agent.recover_pending()
    assert calls==[('nginx','-t'),('nginx','-s','reload')]


def test_corrupt_journal_never_overwrites_host_file(tmp_path,monkeypatch):
    host=tmp_path/'host';state=tmp_path/'state';state.mkdir()
    file=host/'etc/nginx/site.conf';file.parent.mkdir(parents=True);file.write_text(VHOST)
    monkeypatch.setattr(agent,'HOST',host);monkeypatch.setattr(agent,'STATE',state)
    backup=agent.begin_transaction(file);(backup/'0').write_text('corrupt')
    file.write_text('new-value')
    with pytest.raises(ValueError,match='CORRUPTED'):agent.recover_pending()
    assert file.read_text()=='new-value'


def test_verification_does_not_replace_installation_time(tmp_path,monkeypatch):
    state=tmp_path/'state';state.mkdir();status=tmp_path/'status';status.mkdir()
    monkeypatch.setattr(agent,'STATE',state);monkeypatch.setattr(agent,'STATUS',status)
    info={'fingerprint':'a'*64,'sans':['connect.example.test'],'expires_at':(datetime.now(UTC)+timedelta(days=60)).isoformat()}
    agent.publish_ready(info,True)
    installed=json.loads((status/'cloudpanel.json').read_text())['last_installed_at']
    agent.publish_ready(info,False)
    latest=json.loads((status/'cloudpanel.json').read_text())
    assert latest['last_installed_at']==installed
    assert (status/'last-cloudpanel-installed-at.txt').read_text().strip()==installed


class Provider:
    enabled=False
    def __init__(self, rows):self.rows=rows;self.writes=[]
    async def list_zones(self,suffix):return [{'id':'z','name':'example.test','status':'active'}] if suffix=='example.test' else []
    async def list_records(self,name,zone_id=None):return self.rows.get(name,[])
    async def _request(self,method,path,payload):
        self.writes.append(payload)
        self.rows[payload['name']]=[{'id':'existing',**payload}]


@pytest.fixture
def dns_proof(tmp_path,monkeypatch):
    from app.services import managed_dns
    monkeypatch.setattr(managed_dns.settings,'tenant_domain_root','connect.example.test')
    monkeypatch.setattr(managed_dns.settings,'cloudflare_zone_id','')
    monkeypatch.setattr(managed_dns,'receipt',lambda _: {'status':'READY','checked_at':datetime.now(UTC).isoformat(),
        'domains':['*.connect.example.test'],'origin':[['A','93.184.216.34']],'origin_fingerprint':'verified-origin'})
    return managed_dns


@pytest.mark.asyncio
async def test_only_known_legacy_hostname_is_reconciled(dns_proof):
    name='legacy.connect.example.test'
    provider=Provider({name:[{'id':'existing','name':name,'type':'A','content':'192.0.2.1','proxied':True}],
                       'unrelated.example.test':[{'proxied':True}]})
    domain=SimpleNamespace(hostname=name,management_mode='PLATFORM_SUBDOMAIN',provider_metadata={})
    assert await dns_proof.reconcile_known_subdomain(domain,provider=provider)
    assert provider.writes[0]['content']=='93.184.216.34' and provider.writes[0]['proxied'] is False
    assert provider.rows['unrelated.example.test']==[{'proxied':True}]
    assert domain.provider_metadata['managed_dns']['mode']=='EXACT_RECONCILED'


@pytest.mark.asyncio
async def test_new_customer_uses_wildcard_without_creating_a_record(dns_proof):
    provider=Provider({});domain=SimpleNamespace(hostname='new.connect.example.test',management_mode='PLATFORM_SUBDOMAIN',provider_metadata={})
    assert await dns_proof.reconcile_known_subdomain(domain,provider=provider)
    assert not provider.writes
    assert domain.provider_metadata['managed_dns']['mode']=='WILDCARD'


@pytest.mark.asyncio
async def test_exact_txt_node_and_external_domains_fail_closed(dns_proof):
    name='txt.connect.example.test'
    provider=Provider({name:[{'name':name,'type':'TXT','content':'verification'}]})
    domain=SimpleNamespace(hostname=name,management_mode='PLATFORM_SUBDOMAIN',provider_metadata={})
    assert not await dns_proof.reconcile_known_subdomain(domain,provider=provider)
    assert domain.provider_metadata['managed_dns']['error']=='EXACT_DNS_NODE_SHADOWS_WILDCARD'
    domain.hostname='outside.customer.test'
    assert not await dns_proof.reconcile_known_subdomain(domain,provider=provider)
    assert not provider.writes
