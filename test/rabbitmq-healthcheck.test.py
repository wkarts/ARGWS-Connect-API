#!/usr/bin/env python3
"""Regression gate for the RabbitMQ-only change; protects each branch's own runtime."""
import copy
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
PROBE = ['CMD', 'timeout', '${RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT:-2}', 'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/5672']
KEYS = {'RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT', 'RABBITMQ_HEALTHCHECK_INTERVAL', 'RABBITMQ_HEALTHCHECK_TIMEOUT', 'RABBITMQ_HEALTHCHECK_RETRIES', 'RABBITMQ_HEALTHCHECK_START_PERIOD'}


def dev(name):
    return 'develop' in name or 'homologation' in name or name == 'docker-compose.dev.yaml'


def tracked():
    return [n for n in subprocess.check_output(['git','ls-files','-z'], cwd=ROOT).decode().split('\0') if n]


def brokers(text):
    cfg = yaml.safe_load(text)
    if not isinstance(cfg,dict) or not isinstance(cfg.get('services'),dict):return []
    return [(name, value) for name,value in cfg['services'].items() if isinstance(value,dict) and 'rabbitmq' in str(value.get('image','')).lower()]


def manifests():
    return [(name, brokers((ROOT/name).read_text())) for name in tracked() if name.endswith(('.yaml','.yml')) and brokers((ROOT/name).read_text())]


def without_probe(text):
    cfg = yaml.safe_load(text)
    for name,_ in brokers(text):cfg['services'][name].pop('healthcheck',None)
    return cfg


def env_contract(text):
    return [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#') and line.split('=',1)[0] not in KEYS]


class HealthcheckTests(unittest.TestCase):
    def test_all_broker_variants_have_bounded_local_tcp_readiness(self):
        variants = manifests()
        self.assertGreaterEqual(len(variants),10)
        names = {n for n,_ in variants}
        for required in ['deploy/production/compose.yaml','deploy/develop/compose.yaml','deploy/fersoft/production/compose.yaml','deploy/fersoft/develop/compose.yaml','Docker/rabbitmq/docker-compose.yaml']:
            self.assertIn(required,names)
        for path, services in variants:
            for _, service in services:
                with self.subTest(path=path):
                    h = service['healthcheck']
                    self.assertEqual(h['test'],PROBE)
                    self.assertEqual(h['interval'],'${RABBITMQ_HEALTHCHECK_INTERVAL:-'+('30s' if dev(path) else '60s')+'}')
                    self.assertEqual(h['timeout'],'${RABBITMQ_HEALTHCHECK_TIMEOUT:-3s}')
                    self.assertEqual(h['retries'],'${RABBITMQ_HEALTHCHECK_RETRIES:-'+('10' if dev(path) else '5')+'}')
                    self.assertEqual(h['start_period'],'${RABBITMQ_HEALTHCHECK_START_PERIOD:-120s}')
                    self.assertNotIn('nc',h['test'])
                    self.assertNotIn('rabbitmq-diagnostics',h['test'])

    def test_probe_observes_listener_and_sends_no_application_payload(self):
        command=PROBE[1:];command[1]='2'
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen(1);port=listener.getsockname()[1]
            command[-1]=command[-1].replace('/5672',f'/{port}')
            self.assertEqual(subprocess.run(command,capture_output=True,timeout=4).returncode,0)
            listener.settimeout(2)
            with listener.accept()[0] as connection:self.assertEqual(connection.recv(1),b'')
        self.assertNotEqual(subprocess.run(command,capture_output=True,timeout=4).returncode,0)

    def test_environment_defaults_do_not_reenable_any_resource(self):
        checked=0
        for name in tracked():
            p=ROOT/name
            if p.name not in ('.env.example','env.example') and not p.name.endswith('.env.example'):continue
            text=p.read_text()
            if 'RABBITMQ_URI=' not in text and 'ARGWS_CONNECT_RABBITMQ_IMAGE=' not in text:continue
            values=dict(line.split('=',1) for line in text.splitlines() if line and not line.startswith('#') and '=' in line)
            checked+=1
            for key in KEYS:self.assertIn(key,values,name)
            self.assertEqual(values['RABBITMQ_HEALTHCHECK_INTERVAL'],'30s' if dev(name) else '60s',name)
            self.assertEqual(values['RABBITMQ_HEALTHCHECK_RETRIES'],'10' if dev(name) else '5',name)
        self.assertGreaterEqual(checked,12)

    def test_no_runtime_logic_or_non_health_compose_contract_changes(self):
        base=os.environ.get('RABBITMQ_BASE_SHA')
        if not base:
            base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        self.assertRegex(base,r'^[a-f0-9]{40}$')
        immutable=['src','manager','prisma','transcription-worker','transcription-service','operations-agent','Dockerfile','package.json','package-lock.json','RELEASE-MANIFEST.json','.github/retention-policy.json']
        for prefix in immutable:
            result=subprocess.run(['git','diff','--exit-code',base,'--',prefix],cwd=ROOT,capture_output=True)
            self.assertEqual(result.returncode,0, f'Out-of-scope runtime change: {prefix}')
        for name,_ in manifests():
            prior=subprocess.check_output(['git','show',base+':'+name],cwd=ROOT,text=True)
            current=(ROOT/name).read_text()
            self.assertEqual(without_probe(current),without_probe(prior),name)
            old=dict(brokers(prior))
            for key,service in brokers(current):
                if dev(name) and old[key].get('healthcheck',{}).get('test')==PROBE:
                    self.assertEqual(service['healthcheck'],old[key]['healthcheck'],f'Healthy develop changed: {name}')
        for name in tracked():
            p=ROOT/name
            if p.name not in ('.env.example','env.example') and not p.name.endswith('.env.example'):continue
            old=subprocess.run(['git','show',base+':'+name],cwd=ROOT,capture_output=True,text=True)
            if old.returncode==0:self.assertEqual(env_contract(p.read_text()),env_contract(old.stdout),name)

    def test_fersoft_generation_preserves_branch_specific_profiles(self):
        generator=ROOT/'scripts/sync-fersoft-deployments.py'
        if generator.exists():
            result=subprocess.run(['python3',str(generator),'--check'],cwd=ROOT,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    @unittest.skipUnless(shutil.which('docker'), 'Real Compose interpolation runs in CI')
    def test_compose_defaults_overrides_and_dependency_conditions(self):
        for name,services in manifests():
            cfg=yaml.safe_load((ROOT/name).read_text())
            for key,service in services:
                raw=copy.deepcopy(service);raw.pop('env_file',None)
                fixture={k:v for k,v in cfg.items() if k in ('networks','volumes','configs','secrets')}
                fixture['services']={key:raw}
                for custom in ({},{'RABBITMQ_HEALTHCHECK_INTERVAL':'75s','RABBITMQ_HEALTHCHECK_RETRIES':'7'}):
                    with tempfile.TemporaryDirectory() as folder:
                        p=Path(folder);(p/'compose.json').write_text(json.dumps(fixture));(p/'.env').write_text(''.join(k+'='+v+'\n' for k,v in custom.items()))
                        env={k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','RABBITMQ_','ARGWS_CONNECT_'))}
                        r=subprocess.run(['docker','compose','-p','probe-render-test','-f',str(p/'compose.json'),'--env-file',str(p/'.env'),'config','--format','json'],cwd=p,env=env,capture_output=True,text=True,timeout=30)
                        self.assertEqual(r.returncode,0,r.stderr)
                        h=json.loads(r.stdout)['services'][key]['healthcheck']
                        self.assertEqual(h['test'][1:3],['timeout','2'])
                        self.assertIn(h['interval'],[custom.get('RABBITMQ_HEALTHCHECK_INTERVAL', '30s' if dev(name) else '60s'),'1m0s' if not custom and not dev(name) else 'unused','1m15s' if custom else 'unused'])
                        self.assertEqual(int(h['retries']),int(custom.get('RABBITMQ_HEALTHCHECK_RETRIES','10' if dev(name) else '5')))
                for dependent in cfg['services'].values():
                    deps=dependent.get('depends_on',{})
                    if isinstance(deps,dict) and key in deps:self.assertEqual(deps[key]['condition'],'service_healthy')

if __name__=='__main__':unittest.main()
