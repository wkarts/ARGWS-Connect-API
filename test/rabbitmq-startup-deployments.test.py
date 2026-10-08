#!/usr/bin/env python3
"""RabbitMQ readiness and resource budgets must agree across deployment packages."""

import json
import os
import shlex
import shutil
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = (
    'docker-compose.yaml',
    'Docker/rabbitmq/docker-compose.yaml',
    'deploy/canonical/compose.yaml',
    'deploy/cloudpanel/docker-compose.yml',
    'deploy/develop/compose.yaml',
    'deploy/dockge/compose.yaml',
    'deploy/fersoft/develop/compose.yaml',
    'deploy/fersoft/production/compose.yaml',
    'deploy/homologation/compose.yaml',
    'deploy/production/compose.yaml',
)
ENVIRONMENTS = (
    '.env.example', 'env.example',
    'deploy/canonical/env.example',
    'deploy/cloudpanel/env.example', 'deploy/cloudpanel/.env.example',
    'deploy/develop/env.example',
    'deploy/dockge/env.example', 'deploy/dockge/.env.example',
    'deploy/fersoft/develop/env.example',
    'deploy/fersoft/production/env.example',
    'deploy/homologation/env.example',
    'deploy/production/env.example',
)
DEFAULT_ARGS = (
    '+S 2:2 +SDcpu 1 +SDio 1 +A 4 '
    '-rabbit vm_memory_high_watermark {absolute,1073741824}'
)


def manifests():
    for name in MANIFESTS:
        document = yaml.safe_load((ROOT / name).read_text(encoding='utf-8'))
        brokers = [
            (key, value) for key, value in document['services'].items()
            if 'argws-connect-rabbitmq:' in value.get('image', '')
        ]
        if len(brokers) != 1:
            raise AssertionError(f'{name}: expected exactly one RabbitMQ service')
        yield name, document, *brokers[0]


def compose_command():
    explicit = os.environ.get('RABBITMQ_TEST_COMPOSE_COMMAND')
    if explicit:
        return shlex.split(explicit)
    if shutil.which('docker'):
        result = subprocess.run(
            ['docker', 'compose', 'version'], capture_output=True, timeout=10,
        )
        if result.returncode == 0:
            return ['docker', 'compose']
    if shutil.which('docker-compose'):
        return ['docker-compose']
    return None


class RabbitMQBootstrapDeploymentTests(unittest.TestCase):
    def test_every_broker_has_one_light_bounded_amqp_probe(self):
        for name, _, _, broker in manifests():
            with self.subTest(manifest=name):
                health = broker['healthcheck']
                self.assertEqual(health['test'], [
                    'CMD', 'timeout', '${RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT:-2}',
                    'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/5672',
                ])
                self.assertEqual(health['interval'], '${RABBITMQ_HEALTHCHECK_INTERVAL:-30s}')
                self.assertEqual(health['timeout'], '${RABBITMQ_HEALTHCHECK_TIMEOUT:-3s}')
                self.assertEqual(health['retries'], '${RABBITMQ_HEALTHCHECK_RETRIES:-10}')
                self.assertEqual(health['start_period'], '${RABBITMQ_HEALTHCHECK_START_PERIOD:-120s}')
                self.assertNotIn('rabbitmq-diagnostics', ' '.join(health['test']))

    def test_probe_succeeds_only_while_a_real_tcp_listener_is_open(self):
        _, _, _, broker = next(manifests())
        probe = broker['healthcheck']['test'][1:]
        probe[1] = '2'
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            probe[-1] = probe[-1].replace('/5672', f'/{port}')
            result = subprocess.run(probe, capture_output=True, timeout=4)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            listener.settimeout(2)
            connection, _ = listener.accept()
            with connection:
                self.assertEqual(connection.recv(1), b'')
        result = subprocess.run(probe, capture_output=True, timeout=4)
        self.assertNotEqual(result.returncode, 0)

    def test_resource_bounds_leave_headroom_and_allow_operator_overrides(self):
        for name, _, _, broker in manifests():
            with self.subTest(manifest=name):
                self.assertEqual(broker['cpus'], '${RABBITMQ_CPUS:-2.00}')
                self.assertEqual(broker['mem_limit'], '${RABBITMQ_MEMORY:-2g}')
                self.assertEqual(broker['memswap_limit'], broker['mem_limit'])
                self.assertEqual(broker['pids_limit'], '${RABBITMQ_PIDS_LIMIT:-256}')
                args = broker['environment']['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS']
                self.assertTrue(args.startswith('${RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS:-'))
                self.assertTrue(args.endswith('${RABBITMQ_MEMORY_WATERMARK_BYTES:-1073741824}}}'))
                self.assertNotIn('RABBITMQ_SERVER_ERL_ARGS', broker['environment'])
                self.assertNotIn('RABBITMQ_VM_MEMORY_HIGH_WATERMARK', broker['environment'])

    def test_bootstrap_does_not_reassign_identity_or_migrate_broker_state(self):
        for name, _, _, broker in manifests():
            with self.subTest(manifest=name):
                self.assertEqual(
                    broker['image'],
                    '${ARGWS_CONNECT_RABBITMQ_IMAGE:-ghcr.io/wkarts/argws-connect-rabbitmq:management}',
                )
                self.assertEqual(broker['restart'], 'unless-stopped')
                self.assertNotIn('hostname', broker)
                self.assertNotIn('command', broker)
                self.assertNotIn('entrypoint', broker)
                self.assertNotIn('RABBITMQ_NODENAME', broker['environment'])
                self.assertNotIn('RABBITMQ_MNESIA_DIR', broker['environment'])
                self.assertEqual(len(broker['volumes']), 1)
                self.assertTrue(broker['volumes'][0].endswith(':/var/lib/rabbitmq'))

    def test_dependents_still_wait_for_broker_readiness(self):
        checked = 0
        for name, document, rabbit_name, _ in manifests():
            for service_name, service in document['services'].items():
                dependency = service.get('depends_on', {}).get(rabbit_name)
                if dependency is not None:
                    with self.subTest(manifest=name, service=service_name):
                        self.assertEqual(dependency['condition'], 'service_healthy')
                        checked += 1
        self.assertGreaterEqual(checked, 18)

    def test_environment_templates_document_the_budget_without_forcing_custom_args(self):
        for name in ENVIRONMENTS:
            values = {}
            for line in (ROOT / name).read_text(encoding='utf-8').splitlines():
                if line.startswith('RABBITMQ_') and '=' in line:
                    key, value = line.split('=', 1)
                    self.assertNotIn(key, values, f'{name}: duplicate {key}')
                    values[key] = value
            with self.subTest(environment=name):
                self.assertEqual(values['RABBITMQ_MEMORY'], '2g')
                self.assertEqual(values['RABBITMQ_MEMORY_WATERMARK_BYTES'], '1073741824')
                self.assertEqual(values['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS'], '')
                self.assertEqual(values['RABBITMQ_CTL_ERL_ARGS'], '')


class RabbitMQComposeInterpolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = compose_command()
        if cls.command is None:
            if os.environ.get('RABBITMQ_TEST_REQUIRE_COMPOSE') == '1':
                raise AssertionError('Docker Compose is required for interpolation validation')
            raise unittest.SkipTest('Docker Compose unavailable; CI must render defaults and overrides')

    def render(self, document, rabbit_name, broker, overrides):
        # Resolve the unmodified broker fields using real Compose, without requiring
        # deployment secrets or touching any data volume or Docker daemon.
        service = dict(broker)
        service.pop('env_file', None)
        fixture = {'services': {rabbit_name: service}}
        for field in ('networks', 'volumes'):
            if field in document:
                fixture[field] = document[field]
        environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith(('RABBITMQ_', 'ARGWS_CONNECT_', 'COMPOSE_'))
        }
        with tempfile.TemporaryDirectory(prefix='rabbitmq-compose-') as folder:
            path = Path(folder)
            (path / 'compose.yaml').write_text(yaml.safe_dump(fixture), encoding='utf-8')
            (path / '.env').write_text(
                ''.join(f"{key}='{value}'\n" for key, value in overrides.items()), encoding='utf-8',
            )
            result = subprocess.run(
                self.command + ['--env-file', str(path / '.env'), '-f', str(path / 'compose.yaml'),
                                'config', '--format', 'json'],
                cwd=folder, env=environment, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)['services'][rabbit_name]

    def test_real_compose_renders_all_default_budgets_and_erlang_terms(self):
        for name, document, rabbit_name, broker in manifests():
            with self.subTest(manifest=name):
                rendered = self.render(document, rabbit_name, broker, {})
                self.assertEqual(rendered['environment']['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS'], DEFAULT_ARGS)
                self.assertEqual(rendered['mem_limit'], 2 * 1024 ** 3)
                self.assertEqual(rendered['memswap_limit'], 2 * 1024 ** 3)
                self.assertEqual(rendered['cpus'], 2.0)
                self.assertEqual(rendered['pids_limit'], 256)
                self.assertEqual(rendered['healthcheck']['test'][1:3], ['timeout', '2'])

    def test_real_compose_applies_a_configurable_absolute_watermark(self):
        _, document, rabbit_name, broker = next(manifests())
        rendered = self.render(document, rabbit_name, broker, {
            'RABBITMQ_MEMORY': '3g', 'RABBITMQ_MEMORY_WATERMARK_BYTES': '1610612736',
            'RABBITMQ_CPUS': '1.5', 'RABBITMQ_PIDS_LIMIT': '320',
        })
        self.assertEqual(rendered['mem_limit'], 3 * 1024 ** 3)
        self.assertEqual(rendered['memswap_limit'], rendered['mem_limit'])
        self.assertEqual(rendered['cpus'], 1.5)
        self.assertEqual(rendered['pids_limit'], 320)
        self.assertEqual(
            rendered['environment']['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS'],
            DEFAULT_ARGS.replace('1073741824', '1610612736'),
        )

    def test_real_compose_preserves_custom_erlang_arguments_verbatim(self):
        _, document, rabbit_name, broker = next(manifests())
        custom = '+S 3:3 -rabbit vm_memory_high_watermark {absolute,123456789}'
        rendered = self.render(document, rabbit_name, broker, {
            'RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS': custom,
            'RABBITMQ_MEMORY_WATERMARK_BYTES': '1610612736',
            'RABBITMQ_CTL_ERL_ARGS': '+S 2:2',
        })
        self.assertEqual(rendered['environment']['RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS'], custom)
        self.assertEqual(rendered['environment']['RABBITMQ_CTL_ERL_ARGS'], '+S 2:2')


if __name__ == '__main__':
    unittest.main()
