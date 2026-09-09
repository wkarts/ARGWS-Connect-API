#!/usr/bin/env python3
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/prepare-operations-env.py'
def load_script(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

prepare = load_script('prepare_operations', SCRIPT)
sync = load_script('sync_operations', ROOT / 'scripts/sync-operations-deployments.py')

class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.env_patch = patch.dict(os.environ, {}, clear=True)
        self.env_patch.start()
    def tearDown(self):
        self.env_patch.stop()
    def test_upgrade_preserves_all_existing_application_configuration(self):
        original = ('# private existing configuration\nAUTHENTICATION_API_KEY="existing-global"\n'
                    'DATABASE_CONNECTION_URI=postgresql://same:secret@db/database\n'
                    'ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api@sha256:existing\n'
                    'ARGWS_CONNECT_INSTANCES_DATA_PATH=/srv/customer/instances\n'
                    'COMPOSE_PROJECT_NAME=customer-stack\nCOMPOSE_PROFILES=nats\n')
        updated = prepare.prepare(original)
        values = prepare.values(updated)
        self.assertTrue(updated.startswith(original.replace('COMPOSE_PROFILES=nats', 'COMPOSE_PROFILES=nats,operations')))
        self.assertEqual(values['OPERATIONS_ENABLED'], 'true')
        self.assertEqual(len(values['OPERATIONS_INTERNAL_TOKEN']), 64)
        self.assertEqual(prepare.prepare(updated), updated)
    def test_explicit_disable_and_dedicated_token_are_preserved(self):
        original = 'OPERATIONS_ENABLED=false\nOPERATIONS_INTERNAL_TOKEN=' + 'a' * 64 + '\nCOMPOSE_PROFILES=kafka,operations\n'
        updated = prepare.prepare(original)
        values = prepare.values(updated)
        self.assertEqual(values['OPERATIONS_ENABLED'], 'false')
        self.assertEqual(values['OPERATIONS_INTERNAL_TOKEN'], 'a' * 64)
        self.assertEqual(values['COMPOSE_PROFILES'], 'kafka')
        self.assertEqual(prepare.values(prepare.prepare(updated, enable=True))['COMPOSE_PROFILES'], 'kafka,operations')
    def test_shell_profile_is_additive_but_not_persisted(self):
        with patch.dict(os.environ, {'COMPOSE_PROFILES': 'extended'}):
            text = prepare.prepare('COMPOSE_PROFILES=nats\n')
            env = prepare.values(text)
            self.assertEqual(env['COMPOSE_PROFILES'], 'nats,operations')
            self.assertEqual(prepare.profiles(env), 'nats,operations,extended')
    def test_bad_settings_fail_without_replacing_supplied_secrets(self):
        for suffix in [
            'OPERATIONS_INTERNAL_TOKEN=too-short\n',
            'OPERATIONS_ENABLED=yes\n',
            'OPERATIONS_ENABLED=true\nOPERATIONS_ENABLED=false\n',
            'OPERATIONS_RETENTION_DAYS=2\n',
            'ARGWS_CONNECT_OPERATIONS_DATA_PATH=/\n',
            'OPERATIONS_AGENT_URL=http://user:password@operations:8092\n',
        ]:
            with self.assertRaises(ValueError):
                prepare.prepare(suffix)
    def test_global_key_is_never_reused(self):
        with self.assertRaises(ValueError):
            prepare.prepare('AUTHENTICATION_API_KEY=' + 'b' * 64 + '\nOPERATIONS_INTERNAL_TOKEN=' + 'b' * 64 + '\n')
    def test_no_dotenv_execution_and_no_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('AUTHENTICATION_API_KEY=DO_NOT_PRINT\nOTHER=$(touch /tmp/connect-test-should-not-exist)\n')
            result = subprocess.run([sys.executable, str(SCRIPT), '--env-file', str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('DO_NOT_PRINT', result.stdout + result.stderr)
            before = path.read_bytes()
            result = subprocess.run([sys.executable, str(SCRIPT), '--env-file', str(path), '--check'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(before, path.read_bytes())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn('OTHER=$(touch', path.read_text())
    def test_fresh_template_generation_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            env, template = Path(directory) / '.env', Path(directory) / 'env.example'
            template.write_text('AUTHENTICATION_API_KEY=CHANGE_ME_API_KEY\nPOSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD\nDATABASE_CONNECTION_URI=postgresql://u:CHANGE_ME_POSTGRES_PASSWORD@db/test\n')
            command = [sys.executable, str(SCRIPT), '--env-file', str(env), '--template', str(template)]
            for attempt in range(2):
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                current = env.read_text()
                if attempt == 0: before = current
                else: self.assertEqual(current, before)
            values = prepare.values(current)
            self.assertIn(values['POSTGRES_PASSWORD'], values['DATABASE_CONNECTION_URI'])
            self.assertNotIn('CHANGE_ME', current)
    def test_generated_templates_are_synchronized_and_exclude_frozen_stacks(self):
        outputs = sync.generate(ROOT)
        for path, expected in outputs.items():
            self.assertEqual((ROOT / path).read_text(), expected, path)
        self.assertFalse(any(path.startswith(('deploy/canonical/', 'deploy/docs/', 'deploy/docs-develop/')) for path in outputs))
        for path, api, agent, *_ in sync.CASES:
            text = outputs[path]
            self.assertIn('OPERATIONS_ENABLED: ${OPERATIONS_ENABLED:-false}', text)
            self.assertIn('OPERATIONS_AGENT_URL: ${OPERATIONS_AGENT_URL:-http://operations:8092}', text)
            self.assertIn('    profiles: ["operations"]', text)
            self.assertNotIn('8092:8092', text)
            self.assertNotIn('docker.sock', text)
            self.assertEqual(text.count('  ' + agent + ':\n'), 1)

if __name__ == '__main__':
    unittest.main()
