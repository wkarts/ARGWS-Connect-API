"""Fersoft deployments inherit images but isolate every runtime identity."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = load('sync_fersoft', ROOT / 'scripts/sync-fersoft-deployments.py')


def env_values(path):
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value
    return values


class FersoftDeploymentTests(unittest.TestCase):
    def test_generated_deployments_are_synchronized(self):
        outputs = sync.generate()
        self.assertEqual(len(outputs), 71)
        for relative, expected in outputs.items():
            self.assertEqual((ROOT / relative).read_text(encoding='utf-8'), expected, str(relative))

    def test_four_profiles_keep_the_parent_image_references_exactly(self):
        for channel in sync.CHANNELS:
            source_suffix = f'argws-connect-{channel}'
            target_suffix = f'fersoft-connect-{channel}'
            for full in (False, True):
                parent = ROOT / 'deploy' / channel / ('full-stack/compose.yaml' if full else 'compose.yaml')
                target = ROOT / 'deploy/fersoft' / channel / ('full-stack/compose.yaml' if full else 'compose.yaml')
                source_services = yaml.safe_load(parent.read_text(encoding='utf-8'))['services']
                target_services = yaml.safe_load(target.read_text(encoding='utf-8'))['services']
                self.assertEqual(len(target_services), 14)
                self.assertEqual(
                    list(target_services),
                    [name.replace(source_suffix, target_suffix) for name in source_services],
                )
                for source_name, source_service in source_services.items():
                    target_name = source_name.replace(source_suffix, target_suffix)
                    self.assertEqual(target_services[target_name]['image'], source_service['image'])
                    self.assertNotIn(source_suffix, target_name)
                self.assertEqual(
                    [name for name, service in target_services.items() if service.get('ports')],
                    [f'api-{target_suffix}'],
                )
                self.assertNotIn('ports', target_services[f'docs-{target_suffix}'])
                for service in target_services.values():
                    self.assertNotIn('docker.sock', str(service.get('volumes', [])))

    def test_environment_shape_is_parent_compatible_and_runtime_identity_is_fersoft(self):
        expected = {
            'develop': ('https://d.api.connect.fersofterp.com.br', 'fersoft_connect_develop'),
            'production': ('https://api.connect.fersofterp.com.br', 'fersoft_connect_api'),
        }
        for channel, (server, database) in expected.items():
            for full in (False, True):
                source = ROOT / 'deploy' / channel / ('full-stack/env.example' if full else 'env.example')
                target = ROOT / 'deploy/fersoft' / channel / ('full-stack/env.example' if full else 'env.example')
                parent = env_values(source)
                env = env_values(target)
                self.assertEqual(set(env), set(parent))
                self.assertEqual(env['ARGWS_CONNECT_API_IMAGE'], parent['ARGWS_CONNECT_API_IMAGE'])
                self.assertEqual(env['ARGWS_CONNECT_DOCS_IMAGE'], parent['ARGWS_CONNECT_DOCS_IMAGE'])
                self.assertEqual(env['COMPOSE_PROJECT_NAME'], f'fersoft-connect-{channel}')
                self.assertEqual(env['ARGWS_CONNECT_NETWORK_NAME'], f'fersoft-connect-{channel}-net')
                self.assertEqual(env['SERVER_URL'], server)
                self.assertEqual(env['WEBSOCKET_ALLOWED_HOSTS'], f'127.0.0.1,::1,{server.replace("https://", "", 1)}')
                self.assertEqual(env['POSTGRES_DATABASE'], database)
                self.assertEqual(env['MYSQL_DATABASE'], database)
                self.assertIn(f'postgres-fersoft-connect-{channel}:5432/{database}', env['DATABASE_CONNECTION_URI'])
                self.assertEqual(env['KAFKA_BROKERS'], f'kafka-fersoft-connect-{channel}:9092')
                self.assertNotIn('CHANGE_ME', env['ARGWS_CONNECT_API_IMAGE'])
                self.assertNotIn('CHANGE_ME', env['ARGWS_CONNECT_DOCS_IMAGE'])

    def test_full_stack_has_safe_startup_and_no_image_policy_file(self):
        for channel in sync.CHANNELS:
            root = ROOT / 'deploy/fersoft' / channel
            self.assertFalse((root / 'image-policy.json').exists())
            full = root / 'full-stack'
            self.assertFalse((full / 'image-policy.json').exists())
            deploy = (full / 'deploy.sh').read_text(encoding='utf-8')
            self.assertLess(deploy.index(' pull'), deploy.index('prepare-volumes.py'))
            self.assertLess(deploy.index('prepare-volumes.py'), deploy.index(' up -d'))
            self.assertIn('check-runtime.py --expected 14', deploy)
            self.assertEqual(
                (full / 'prepare-volumes.py').read_text(encoding='utf-8'),
                (ROOT / 'scripts/prepare-full-stack-volumes.py').read_text(encoding='utf-8'),
            )

    def test_normal_profile_can_recover_all_services_without_deleting_data(self):
        for channel in sync.CHANNELS:
            recovery = (ROOT / 'deploy/fersoft' / channel / 'recover-full-stack.sh').read_text(encoding='utf-8')
            self.assertIn('config --services', recovery)
            self.assertIn('stop mysql-fersoft-connect-' + channel, recovery)
            self.assertIn('prepare-volumes.py --compose-file compose.yaml', recovery)
            self.assertIn('check-runtime.py --expected 14', recovery)
            self.assertNotIn(' down ', recovery)
            self.assertNotIn('rm ', recovery)
            self.assertNotIn('chown', recovery)

    def test_full_stack_prepares_a_private_environment_without_operator_secrets(self):
        for channel in sync.CHANNELS:
            with tempfile.TemporaryDirectory() as directory:
                full = Path(directory) / 'full-stack'
                shutil.copytree(ROOT / 'deploy/fersoft' / channel / 'full-stack', full)
                result = subprocess.run(
                    [sys.executable, 'prepare-env.py'], cwd=full, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                environment = full / '.env'
                self.assertEqual(environment.stat().st_mode & 0o777, 0o600)
                self.assertNotIn('CHANGE_ME_', environment.read_text(encoding='utf-8'))
                self.assertNotIn('CHANGE_ME_', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
