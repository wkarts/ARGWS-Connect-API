#!/usr/bin/env python3
"""Deployment packages must run with Compose, .env and persisted volumes only."""
import importlib.util
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def env_values(path):
    values = {}
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key] = value
    return values


def command_text(service):
    value = service.get('command', '')
    return value[0] if isinstance(value, list) and len(value) == 1 else value


class ComposeEnvOnlyDeploymentTests(unittest.TestCase):
    def test_deploy_tree_has_no_host_executables_or_full_stack_fork(self):
        forbidden = {'.py', '.sh', '.cjs'}
        files = [path for path in (ROOT / 'deploy').rglob('*') if path.is_file()]
        self.assertFalse(
            [path.relative_to(ROOT).as_posix() for path in files if path.suffix in forbidden],
            'deployment files must not require host executables',
        )
        self.assertFalse([path for path in (ROOT / 'deploy').rglob('full-stack') if path.is_dir()])

    def test_fersoft_directories_contain_only_compose_and_environment_template(self):
        for channel in ('develop', 'production'):
            folder = ROOT / 'deploy' / 'fersoft' / channel
            self.assertEqual({path.name for path in folder.iterdir() if path.is_file()}, {'compose.yaml', 'env.example'})

    def test_fersoft_production_is_full_stack_selected_by_env(self):
        environment = env_values(ROOT / 'deploy/fersoft/production/env.example')
        self.assertEqual(environment['COMPOSE_PROFILES'], 'operations,nats,kafka,mysql,traccar')
        for key in ('OPERATIONS_ENABLED', 'NATS_ENABLED', 'KAFKA_ENABLED', 'MYSQL_SERVICE_ENABLED', 'TRACCAR_ENABLED'):
            self.assertEqual(environment[key], 'true', key)
        self.assertEqual(environment['TRACCAR_MODE'], 'internal')
        self.assertNotIn('TRACCAR_PUBLIC_URL', environment)

        compose = yaml.safe_load((ROOT / 'deploy/fersoft/production/compose.yaml').read_text(encoding='utf-8'))
        services = compose['services']
        expected = {
            'api-fersoft-connect-production', 'docs-fersoft-connect-production',
            'postgres-fersoft-connect-production', 'redis-fersoft-connect-production',
            'rabbitmq-fersoft-connect-production', 'minio-fersoft-connect-production',
            'operations-fersoft-connect-production', 'transcription-worker-fersoft-connect-production', 'nats-fersoft-connect-production',
            'mysql-fersoft-connect-production', 'zookeeper-fersoft-connect-production',
            'kafka-fersoft-connect-production', 'traccar-fersoft-connect-production',
            'traccar-postgres-fersoft-connect-production',
            'traccar-bootstrap-fersoft-connect-production', 'volume-init-fersoft-connect-production',
            'mysql-volume-init-fersoft-connect-production',
        }
        self.assertEqual(set(services), expected)
        self.assertNotIn('ports', services['docs-fersoft-connect-production'])
        self.assertNotIn('TRACCAR_PUBLIC_URL', services['api-fersoft-connect-production']['environment'])
        volume_init = services['volume-init-fersoft-connect-production']
        self.assertEqual(volume_init['profiles'], ['kafka', 'extended'])
        self.assertEqual(volume_init['restart'], 'unless-stopped')
        self.assertIn('volume-init-ready', command_text(volume_init))
        self.assertEqual(
            services['zookeeper-fersoft-connect-production']['depends_on']['volume-init-fersoft-connect-production']['condition'],
            'service_healthy',
        )
        self.assertEqual(
            services['kafka-fersoft-connect-production']['depends_on']['volume-init-fersoft-connect-production']['condition'],
            'service_healthy',
        )
        mysql_init = services['mysql-volume-init-fersoft-connect-production']
        self.assertEqual(mysql_init['profiles'], ['mysql'])
        self.assertEqual(mysql_init['restart'], 'unless-stopped')
        self.assertIn('chown --no-dereference --recursive 1001:0', command_text(mysql_init))
        self.assertEqual(
            services['mysql-fersoft-connect-production']['depends_on']['mysql-volume-init-fersoft-connect-production']['condition'],
            'service_healthy',
        )
        traccar_postgres = services['traccar-postgres-fersoft-connect-production']
        primary_postgres = services['postgres-fersoft-connect-production']
        self.assertNotEqual(primary_postgres['volumes'], traccar_postgres['volumes'])
        self.assertEqual(
            primary_postgres['volumes'],
            ['${ARGWS_CONNECT_POSTGRES_DATA_PATH:-./volumes/postgres}:/var/lib/postgresql/data'],
        )
        self.assertEqual(
            traccar_postgres['volumes'],
            ['${ARGWS_CONNECT_TRACCAR_DB_PATH:-./volumes/traccar-postgres}:/var/lib/postgresql/data'],
        )
        self.assertEqual(traccar_postgres['entrypoint'], ['/bin/bash', '-ec'])
        self.assertIn('CREATE ROLE traccar LOGIN', command_text(traccar_postgres))
        self.assertIn('CREATE DATABASE traccar OWNER traccar', command_text(traccar_postgres))
        self.assertIn('postgres --single', command_text(traccar_postgres))
        self.assertIn(
            'ALTER ROLE traccar NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            command_text(traccar_postgres),
        )
        self.assertNotIn('ALTER ROLE traccar PASSWORD', command_text(traccar_postgres))
        self.assertEqual(
            traccar_postgres['environment']['TRACCAR_DATABASE_PASSWORD'],
            '${TRACCAR_DATABASE_PASSWORD:-}',
        )
        transcription_worker = services['transcription-worker-fersoft-connect-production']
        self.assertFalse(any('transcription-models' in str(volume) for volume in transcription_worker.get('volumes', [])))
        self.assertEqual(
            transcription_worker['environment']['TRANSCRIPTION_MODEL_CACHE_DIR'],
            '${TRANSCRIPTION_MODEL_CACHE_DIR:-/tmp/argws-connect-transcription-model-cache}',
        )
        self.assertIn('psql --no-password', ' '.join(traccar_postgres['healthcheck']['test']))
        self.assertNotIn('pg_isready', ' '.join(traccar_postgres['healthcheck']['test']))
        bootstrap = services['traccar-bootstrap-fersoft-connect-production']
        self.assertEqual(bootstrap['restart'], 'unless-stopped')
        self.assertIn('traccar-bootstrap-ready', command_text(bootstrap))

    def test_develop_transcription_is_enabled_with_its_compose_profile(self):
        environment = env_values(ROOT / 'deploy/develop/env.example')
        profiles = [item.strip() for item in environment['COMPOSE_PROFILES'].split(',') if item.strip()]
        self.assertIn('transcription', profiles)
        self.assertEqual(environment['TRANSCRIPTION_ENABLED'], 'true')
        self.assertEqual(environment['TRANSCRIPTION_PROVIDER'], 'local')

    def test_bootstraps_are_inside_images_or_compose_not_host_mounts(self):
        raw = (ROOT / 'deploy/fersoft/production/compose.yaml').read_text(encoding='utf-8')
        self.assertIn('traccar-bootstrap-fersoft-connect-production:', raw)
        self.assertIn('entrypoint:', raw)
        self.assertNotIn('traccar-bootstrap.cjs', raw)
        self.assertNotIn('/scripts/', raw)
        self.assertNotIn('../', raw)

    def test_fersoft_generator_is_synchronized(self):
        sync = load('sync_fersoft', ROOT / 'scripts/sync-fersoft-deployments.py')
        for relative, content in sync.generate().items():
            self.assertEqual((ROOT / relative).read_text(encoding='utf-8'), content, relative)


if __name__ == '__main__':
    unittest.main()
