"""Fresh full-stack configs and upgrades use synthetic credentials only, never the operator environment."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import yaml
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('full_stack', ROOT/'scripts/prepare-full-stack-env.py')
prep=importlib.util.module_from_spec(spec); spec.loader.exec_module(prep)

class FullStackTests(unittest.TestCase):
    def setUp(self):
        self.clean=patch.dict(os.environ,{},clear=True);self.clean.start();self.addCleanup(self.clean.stop)
    def template(self,channel='develop'):
        return (ROOT/f'deploy/{channel}/full-stack/env.example').read_text()
    def test_new_environments_enable_14_local_services_with_distinct_credentials(self):
        for channel in ('develop','production'):
            result=prep.build(self.template(channel),self.template(channel),True)
            env=prep.validate(result)
            self.assertEqual(env['COMPOSE_PROFILES'],'operations,nats,kafka,mysql,traccar')
            self.assertEqual(env['TRACCAR_MODE'],'internal');self.assertEqual(env['DATABASE_PROVIDER'],'postgresql')
            self.assertEqual(env['NATS_ENABLED'],'true');self.assertEqual(env['KAFKA_ENABLED'],'true')
            self.assertNotEqual(env['TRACCAR_DATABASE_PASSWORD'],env['AUTHENTICATION_API_KEY'])
            self.assertNotEqual(env['TRACCAR_ADMIN_PASSWORD'],env['AUTHENTICATION_API_KEY'])
            self.assertEqual(prep.build(result,self.template(channel)),result)
    def test_existing_secrets_and_relative_volumes_preserved_during_import(self):
        original=prep.build(self.template(),self.template(),True)
        original=prep.ops.set_value(original,'ARGWS_CONNECT_POSTGRES_DATA_PATH','./volumes/postgres')
        original=prep.ops.set_value(original,'CUSTOM_INTEGRATION_OPTION','keep-this-value')
        result=prep.build(original,self.template(),True,Path('/deploy/develop/.env'),Path('/deploy/develop/full-stack/.env'))
        env=prep.parse(result);old=prep.parse(original)
        for key in prep.SECRET_KEYS:self.assertEqual(env[key],old[key],key)
        self.assertEqual(env['ARGWS_CONNECT_POSTGRES_DATA_PATH'],'../volumes/postgres')
        self.assertEqual(env['CUSTOM_INTEGRATION_OPTION'],'keep-this-value')
    def test_invalid_key_never_rotated(self):
        bad=prep.ops.set_value(self.template(),'FINDHUB_CREDENTIALS_KEY','invalid-existing-fixture')
        with self.assertRaises(ValueError):prep.build(bad,self.template(),True)
    def test_profiles_follow_flags_and_external_mode(self):
        text=prep.build(self.template(),self.template(),True)
        for key in prep.FLAGS:text=prep.ops.set_value(text,key,'false')
        text=prep.ops.set_value(text,'TRACCAR_MODE','external')
        result=prep.build(text,self.template());env=prep.validate(result)
        self.assertEqual(env['COMPOSE_PROFILES'],'');self.assertEqual(env['TRACCAR_REPLICAS'],'0')
        # Changing an integration flag without regenerating profiles cannot silently pass preflight.
        with self.assertRaises(ValueError):prep.validate(prep.ops.set_value(result,'NATS_ENABLED','true'))
    def test_connect_key_is_not_used_as_internal_traccar_token(self):
        text=prep.build(self.template(),self.template(),True);env=prep.parse(text)
        text=prep.ops.set_value(text,'TRACCAR_TOKEN',env['AUTHENTICATION_API_KEY'])
        result=prep.parse(prep.build(text,self.template()))
        self.assertEqual(result['TRACCAR_TOKEN'],'');self.assertEqual(result['TRACCAR_ADMIN_PASSWORD'],env['TRACCAR_ADMIN_PASSWORD'])
    def test_cloud_integrations_are_not_enabled_without_credentials(self):
        text=prep.build(self.template(),self.template(),True)
        for name in ('SQS_GLOBAL_ENABLED','PUSHER_GLOBAL_ENABLED'):
            with self.assertRaises(ValueError):prep.build(prep.ops.set_value(text,name,'true'),self.template())
    def test_duplicates_are_rejected_without_leaking_value(self):
        with self.assertRaises(ValueError) as caught:prep.parse('CUSTOM=private-fixture\nCUSTOM=another-fixture\n')
        self.assertNotIn('private-fixture',str(caught.exception))
    def test_cli_import_is_atomic_and_private(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d);dest=path/'full-stack';shutil.copytree(ROOT/'deploy/develop/full-stack',dest,ignore=shutil.ignore_patterns('.env','__pycache__'))
            source=path/'.env';source.write_text(prep.build(self.template(),self.template(),True));before=source.read_text()
            run=subprocess.run([sys.executable,'prepare-env.py','--from-env','../.env'],cwd=dest,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr);self.assertEqual(source.read_text(),before)
            self.assertEqual((dest/'.env').stat().st_mode & 0o777,0o600)
            self.assertNotIn(prep.parse(before)['AUTHENTICATION_API_KEY'],run.stdout+run.stderr)
            saved=(dest/'.env').read_text()
            repeated=subprocess.run([sys.executable,'prepare-env.py','--from-env','../.env'],cwd=dest,capture_output=True,text=True)
            self.assertNotEqual(repeated.returncode,0);self.assertEqual((dest/'.env').read_text(),saved)
    def test_compose_service_topology_and_only_api_public(self):
        for channel in ('develop','production'):
            cfg=yaml.safe_load((ROOT/f'deploy/{channel}/full-stack/compose.yaml').read_text())
            services=cfg['services'];suffix='argws-connect-'+channel
            self.assertEqual(len(services),14)
            self.assertEqual([name for name,service in services.items() if service.get('ports')],['api-'+suffix])
            api=services['api-'+suffix]
            for resource in ('traccar','traccar-postgres','traccar-bootstrap','mysql'):
                self.assertNotIn(resource+'-'+suffix,api['depends_on'])
            for name,service in services.items():
                self.assertEqual(service['container_name'],name)
                for volume in service.get('volumes',[]):
                    self.assertNotIn('docker.sock',str(volume));self.assertNotIn(':-./volumes',str(volume))
            self.assertIn(':-true',services['kafka-'+suffix]['environment']['KAFKA_AUTO_CREATE_TOPICS_ENABLE'])
    def test_docker_compose_effective_14_services_and_modes(self):
        executable=os.environ.get('FULL_STACK_COMPOSE_BINARY') or ('/mnt/data/tools/docker-compose' if Path('/mnt/data/tools/docker-compose').exists() else None)
        command=[executable] if executable else ['docker','compose']
        if not executable and not shutil.which('docker'):self.skipTest('Docker Compose executable not available')
        for channel in ('develop','production'):
            with tempfile.TemporaryDirectory() as d:
                path=Path(d);shutil.copytree(ROOT/f'deploy/{channel}/full-stack',path,dirs_exist_ok=True,ignore=shutil.ignore_patterns('.env','__pycache__'))
                full=prep.build(self.template(channel),self.template(channel),True)
                for mode,count in [('internal',14),('external',11),('disabled',11)]:
                    text=prep.ops.set_value(full,'TRACCAR_ENABLED','false' if mode=='disabled' else 'true')
                    text=prep.ops.set_value(text,'TRACCAR_MODE',mode);text=prep.build(text,self.template(channel));(path/'.env').write_text(text)
                    run=subprocess.run(command+['--env-file','.env','-f','compose.yaml','config','--format','json'],cwd=path,capture_output=True,text=True)
                    self.assertEqual(run.returncode,0,run.stderr)
                    cfg=json.loads(run.stdout);self.assertEqual(len(cfg['services']),count)
                    for name,service in cfg['services'].items():
                        if not name.startswith('api-'):self.assertFalse(service.get('ports'))

if __name__=='__main__':unittest.main()
