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
        for key in ('TRANSCRIPTION_ENABLED', 'SPEECH_ENABLED', 'MANAGER_FEATURE_TRANSCRIPTION'):
            self.assertEqual(environment[key], 'false', key)
        self.assertEqual(environment['DICTATION_ENABLED'], 'false')
        self.assertEqual(environment['SPEECH_TRANSCRIPTION_REPLICAS'], '1')
        self.assertEqual(environment['TRANSCRIPTION_PROVIDER'], 'local')
        self.assertEqual(environment['TRACCAR_MODE'], 'internal')
        self.assertNotIn('TRACCAR_PUBLIC_URL', environment)

        compose = yaml.safe_load((ROOT / 'deploy/fersoft/production/compose.yaml').read_text(encoding='utf-8'))
        services = compose['services']
        expected = {
            'api-fersoft-connect-production', 'docs-fersoft-connect-production',
            'postgres-fersoft-connect-production', 'redis-fersoft-connect-production',
            'rabbitmq-fersoft-connect-production', 'minio-fersoft-connect-production',
            'operations-fersoft-connect-production', 'nats-fersoft-connect-production',
            'mysql-fersoft-connect-production', 'zookeeper-fersoft-connect-production',
            'kafka-fersoft-connect-production', 'traccar-fersoft-connect-production',
            'traccar-postgres-fersoft-connect-production',
            'traccar-bootstrap-fersoft-connect-production', 'volume-init-fersoft-connect-production',
            'mysql-volume-init-fersoft-connect-production',
            'transcription-worker-fersoft-connect-production',
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
        self.assertTrue(any('/models' in str(volume) for volume in services['api-fersoft-connect-production']['volumes']))
        self.assertNotIn('speech-dictation-worker-fersoft-connect-production', services)
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
        self.assertEqual(environment['SPEECH_ENABLED'], 'true')
        self.assertEqual(environment['MANAGER_FEATURE_TRANSCRIPTION'], 'true')

        develop = yaml.safe_load((ROOT / 'deploy/develop/compose.yaml').read_text(encoding='utf-8'))
        worker = develop['services']['transcription-worker-argws-connect-develop']
        self.assertEqual(worker['profiles'], ['transcription'])

        self.assertEqual(worker['environment']['SPEECH_WORKER_MODE'], 'pool')
        self.assertFalse([name for name in develop['services'] if 'dictation-worker' in name])

    def test_transcription_is_available_in_every_application_deployment(self):
        layouts = {
            'docker-compose.yaml': '.env.example',
            'docker-compose.dev.yaml': '.env.example',
            'deploy/production/compose.yaml': 'deploy/production/env.example',
            'deploy/develop/compose.yaml': 'deploy/develop/env.example',
            'deploy/canonical/compose.yaml': 'deploy/canonical/env.example',
            'deploy/cloudpanel/docker-compose.yml': 'deploy/cloudpanel/env.example',
            'deploy/dockge/compose.yaml': 'deploy/dockge/env.example',
            'deploy/homologation/compose.yaml': 'deploy/homologation/env.example',
            'deploy/fersoft/production/compose.yaml': 'deploy/fersoft/production/env.example',
            'deploy/fersoft/develop/compose.yaml': 'deploy/fersoft/develop/env.example',
        }
        for compose_file, environment_file in layouts.items():
            with self.subTest(compose=compose_file):
                services = yaml.safe_load((ROOT / compose_file).read_text(encoding='utf-8'))['services']
                workers = [value for name, value in services.items() if name.startswith('transcription-worker')]
                self.assertEqual(len(workers), 1)
                self.assertEqual(workers[0]['profiles'], ['transcription'])
                self.assertEqual(workers[0]['environment']['SPEECH_WORKER_MODE'], 'pool')
                self.assertEqual(workers[0]['environment']['SPEECH_GLOBAL_CONCURRENCY'], '${SPEECH_GLOBAL_CONCURRENCY:-1}')
                self.assertEqual(workers[0]['scale'], 1, 'old replica settings cannot multiply resident models')
                self.assertEqual(workers[0]['memswap_limit'], workers[0]['mem_limit'])
                self.assertEqual(workers[0]['cgroup_parent'], '${SPEECH_CGROUP_PARENT:-}')
                self.assertTrue(workers[0]['init'])
                self.assertEqual(workers[0]['restart'], 'on-failure:3')
                self.assertFalse(workers[0].get('ports'), 'the native engine must stay inside the worker cgroup')
                self.assertIn('noexec,nosuid,nodev', workers[0]['tmpfs'][0])
                self.assertEqual(workers[0]['environment']['SPEECH_INFERENCE_THREADS'], '${SPEECH_INFERENCE_THREADS:-1}')
                self.assertEqual(workers[0]['environment']['SPEECH_ENGINE'], '${SPEECH_ENGINE:-transformers}')
                self.assertTrue(any('/models:ro' in str(volume) for volume in workers[0]['volumes']))
                self.assertFalse([name for name in services if 'dictation-worker' in name])
                api = next(value for name, value in services.items() if name == 'api' or name.startswith('api-'))
                for flag in ('SPEECH_ENABLED', 'TRANSCRIPTION_ENABLED', 'MANAGER_FEATURE_TRANSCRIPTION'):
                    self.assertIn('${', api['environment'][flag], (compose_file, flag))
                self.assertEqual(api['environment']['DICTATION_ENABLED'], '${DICTATION_ENABLED:-false}')
                self.assertEqual(workers[0]['environment']['DICTATION_ENABLED'], api['environment']['DICTATION_ENABLED'])
                self.assertEqual(api['environment']['SPEECH_S3_BUCKET_NAME'], '${SPEECH_S3_BUCKET_NAME:-}')
                self.assertEqual(workers[0]['environment']['SPEECH_S3_BUCKET_NAME'], api['environment']['SPEECH_S3_BUCKET_NAME'])
                self.assertTrue(any('/models' in str(volume) for volume in api.get('volumes', [])))
                env = env_values(ROOT / environment_file)
                enabled = compose_file == 'deploy/develop/compose.yaml'
                self.assertEqual('transcription' in env.get('COMPOSE_PROFILES', '').split(','), enabled)
                for flag in ('TRANSCRIPTION_ENABLED', 'SPEECH_ENABLED', 'DICTATION_ENABLED', 'MANAGER_FEATURE_TRANSCRIPTION'):
                    self.assertEqual(env[flag], str(enabled).lower())
                self.assertEqual(env['SPEECH_TRANSCRIPTION_REPLICAS'], '1')
                self.assertEqual(env['SPEECH_S3_BUCKET_NAME'], '', 'derive the private bucket from each installation at runtime')
                self.assertEqual(env['SPEECH_GLOBAL_CONCURRENCY'], '1')
                self.assertEqual(env['TRANSCRIPTION_WORKER_TMPFS_SIZE'], '256m')
                self.assertEqual(env['SPEECH_MAX_PENDING_JOBS'], '50')
                self.assertEqual(env['SPEECH_MAX_PENDING_JOBS_PER_INSTANCE'], '5')
                self.assertEqual(env['DICTATION_MAX_DURATION_SECONDS'], '60')
                self.assertEqual(env['DICTATION_JOB_DEADLINE_SECONDS'], '120')

    def test_whisper_canary_is_explicit_and_uses_one_total_cgroup_budget(self):
        env = env_values(ROOT / 'deploy/speech/canary-whisper-cpp.env.example')
        self.assertEqual(env['SPEECH_ENGINE'], 'whisper.cpp')
        self.assertEqual(env['SPEECH_S3_BUCKET_NAME'], '')
        self.assertEqual(env['SPEECH_MODEL'], 'whisper-base-q5_1')
        self.assertEqual(env['SPEECH_WORKER_MODE'], 'pool')
        self.assertEqual(env['SPEECH_WORKER_MEMORY'], '1280m')
        self.assertEqual(env['SPEECH_WORKER_CPUS'], '1.00')
        self.assertEqual(env['TRANSCRIPTION_WORKER_TMPFS_SIZE'], '128m')
        self.assertEqual(len(env['SPEECH_WHISPER_MODEL_SHA256']), 64)
        self.assertNotIn('COMPOSE_PROFILES', env, 'a canary overlay cannot replace the selected installation profiles')

    def test_host_budget_is_opt_in_and_shared_above_container_limits(self):
        override = yaml.safe_load((ROOT / 'deploy/speech/host-budget.compose.yaml').read_text())
        parent = override['services']['transcription-worker']['cgroup_parent']
        self.assertTrue(parent.startswith('${SPEECH_CGROUP_PARENT:?'))
        unit = (ROOT / 'deploy/speech/connect-speech.slice.example').read_text()
        self.assertIn('[Slice]', unit)
        self.assertIn('MemoryMax=2560M', unit)
        self.assertIn('MemorySwapMax=0', unit)
        self.assertIn('CPUQuota=200%', unit)
        self.assertIn('TasksMax=256', unit)
        for template in ('deploy/develop/env.example', 'deploy/production/env.example',
                         'deploy/fersoft/develop/env.example', 'deploy/fersoft/production/env.example'):
            self.assertEqual(env_values(ROOT / template)['SPEECH_CGROUP_PARENT'], '')

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
