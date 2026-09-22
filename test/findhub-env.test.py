import base64
import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/prepare-findhub-env.py'
spec = importlib.util.spec_from_file_location('findhub_env', SCRIPT)
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)


class FindHubEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self.clean = patch.dict(os.environ, {}, clear=True)
        self.clean.start()
        self.addCleanup(self.clean.stop)

    def test_initialization_and_idempotence_preserve_other_settings(self):
        before = '# preserve\r\nAUTHENTICATION_API_KEY=not-a-findhub-key\r\nCUSTOM="a=b"\r\n'
        first = env.prepare(before)
        self.assertTrue(first.startswith(before))
        self.assertEqual(len(env.decode_key(env.values(first)[env.KEY])), 32)
        self.assertEqual(env.prepare(first), first)
        self.assertEqual(env.values(first)['FINDHUB_STORE_POSITION_HISTORY'], 'false')

    def test_custom_values_and_existing_base64_key_preserved(self):
        key = base64.b64encode(bytes(range(32))).decode()
        before = f"{env.KEY}='{key}' # keep this comment\nFINDHUB_STORE_POSITION_HISTORY=true\nFINDHUB_LOCATION_TIMEOUT_MS=45000\n"
        result = env.prepare(before)
        self.assertTrue(result.startswith(before))
        self.assertEqual(env.values(result)[env.KEY], key)
        self.assertEqual(env.values(result)['FINDHUB_LOCATION_TIMEOUT_MS'], '45000')

    def test_existing_unpadded_and_urlsafe_base64_keys_preserved(self):
        raw = bytes(range(224, 256))
        for key in (base64.b64encode(raw).decode().rstrip('='), base64.urlsafe_b64encode(raw).decode().rstrip('=')):
            self.assertEqual(env.decode_key(key), raw)
            self.assertEqual(env.values(env.prepare(f'{env.KEY}={key}\n'))[env.KEY], key)

    def test_invalid_existing_key_is_not_rotated(self):
        for value in ('bad-secret', 'g' * 64, 'YQ==', 'Z' * 44):
            with self.subTest(value_length=len(value)), self.assertRaises(ValueError):
                env.prepare(f'{env.KEY}={value}\n')

    def test_duplicates_and_malformed_quotes_rejected(self):
        for text in (f'{env.KEY}=\n{env.KEY}=\n', f"{env.KEY}='broken\n"):
            with self.assertRaises(ValueError):
                env.prepare(text)

    def test_shell_key_is_preserved_not_replaced(self):
        key = '12' * 32
        os.environ[env.KEY] = key
        self.assertEqual(env.values(env.prepare(''))[env.KEY], key)
        with self.assertRaises(ValueError):
            env.prepare(f'{env.KEY}={"34" * 32}\n')

    def test_check_does_not_require_findhub_for_whatsapp(self):
        env.validate({})
        with self.assertRaises(ValueError):
            env.validate({}, require_key=True)

    def test_invalid_settings_rejected_without_values_in_errors(self):
        for name, value in (('FINDHUB_LOCATION_TIMEOUT_MS', '0'), ('FINDHUB_STORE_POSITION_HISTORY', 'yes'), ('FINDHUB_MIN_TRACKING_INTERVAL_SECONDS', 'x')):
            with self.assertRaises(ValueError):
                env.prepare(f'{name}={value}\n')

    def test_cli_private_atomic_file_and_no_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / '.env'
            file.write_text('AUTHENTICATION_API_KEY=unchanged\n')
            first = subprocess.run([sys.executable, str(SCRIPT), '--env-file', str(file)], capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            saved = file.read_text()
            key = env.values(saved)[env.KEY]
            self.assertNotIn(key, first.stdout + first.stderr)
            self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
            check = subprocess.run([sys.executable, str(SCRIPT), '--env-file', str(file), '--check', '--require-key'], capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)
            self.assertEqual(file.read_text(), saved)
            file.unlink()
            file.symlink_to(Path(directory) / 'other')
            refused = subprocess.run([sys.executable, str(SCRIPT), '--env-file', str(file)], capture_output=True, text=True)
            self.assertNotEqual(refused.returncode, 0)


if __name__ == '__main__':
    unittest.main()
