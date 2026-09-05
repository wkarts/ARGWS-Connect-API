from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from connect_deployer import build_info as identity

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare = load('prepare_build')
package = load('package_artifact')
assets = load('verify_assets')


class BuildIdentityTests(unittest.TestCase):
    def test_reference_matches_canonical_without_changing_application_installer(self):
        self.assertEqual((ROOT/'reference/install-connect-original.py').read_bytes(), (REPO/'install-connect.py').read_bytes())

    def test_payload_retains_user_file_secret_adaptation(self):
        text = (ROOT/'src/connect_deployer/payload/install-connect.py').read_text()
        self.assertIn("secret_from_file_env('GH_TOKEN_FILE')", text)
        self.assertIn("secret_from_file_env('ARGWS_CONNECT_GHCR_TOKEN_FILE')", text)
        self.assertEqual(prepare.literal_version(ROOT/'src/connect_deployer/payload/install-connect.py'), '1.0.1')

    def test_submitted_ssh_implementation_is_preserved(self):
        imported = json.loads((ROOT/'SOURCE-IMPORT.json').read_text())
        source = ROOT/'src/connect_deployer/ssh_client.py'
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),
                         imported['original_file_sha256']['src/connect_deployer/ssh_client.py'])

    def test_parent_project_is_found(self):
        self.assertEqual(prepare.find_repository(), REPO)

    def test_unbound_tool_tree_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                prepare.find_repository(Path(directory))

    def test_package_name_binds_project_channel_sha_and_platform(self):
        self.assertEqual(package.archive_name({'project_version':'1.2.3', 'channel':'pr',
            'source_sha':'a'*40, 'target':'windows-x86_64'}),
            'connect-deploy-1.2.3-pr-aaaaaaaaaaaa-windows-x86_64.zip')

    def test_package_path_injection_is_rejected(self):
        with self.assertRaises(ValueError):
            package.archive_name({'project_version':'../outside', 'channel':'pr',
                'source_sha':'a'*40, 'target':'linux-x86_64'})

    def test_native_arm64_target(self):
        with patch.object(prepare.platform, 'system', return_value='Linux'), patch.object(prepare.platform, 'machine', return_value='aarch64'):
            self.assertEqual(prepare.target_name(), 'linux-arm64')

    def test_unknown_target_fails(self):
        with patch.object(prepare.platform, 'machine', return_value='unknown'):
            with self.assertRaises(ValueError): prepare.target_name()

    def test_frozen_subprocess_library_paths_are_restored(self):
        with patch.dict(os.environ, {'LD_LIBRARY_PATH':'/frozen', 'LD_LIBRARY_PATH_ORIG':'/system'}, clear=True), patch.object(identity.sys, 'frozen', True, create=True):
            env = identity.system_subprocess_env()
            self.assertEqual(env['LD_LIBRARY_PATH'], '/system')
            self.assertNotIn('LD_LIBRARY_PATH_ORIG', env)
            self.assertEqual(os.environ['LD_LIBRARY_PATH'], '/frozen')

    def test_frozen_subprocess_unsets_private_path_without_original(self):
        with patch.dict(os.environ, {'LD_LIBRARY_PATH':'/frozen'}, clear=True), patch.object(identity.sys, 'frozen', True, create=True):
            self.assertNotIn('LD_LIBRARY_PATH', identity.system_subprocess_env())

    def test_source_subprocess_environment_is_unchanged(self):
        with patch.dict(os.environ, {'LD_LIBRARY_PATH':'/normal'}, clear=True), patch.object(identity.sys, 'frozen', False, create=True):
            self.assertEqual(identity.system_subprocess_env()['LD_LIBRARY_PATH'], '/normal')

    def test_release_hook_is_additive_and_does_not_create_deployer_release(self):
        workflow = (REPO/'.github/workflows/connect-deployer-binaries.yml').read_text()
        release = (REPO/'.github/workflows/auto-version-release.yml').read_text()
        self.assertIn('needs: [plan-version, version-source, release]', release)
        self.assertIn('uses: ./.github/workflows/connect-deployer-binaries.yml', release)
        self.assertNotIn('gh release create', workflow)
        self.assertNotIn('--clobber', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertNotIn('pull_request_target:', workflow)
        self.assertNotIn('tags:', workflow)
        self.assertFalse((ROOT/'.github/workflows/build.yml').exists())

    def test_build_matrix_contains_four_native_targets(self):
        workflow = (REPO/'.github/workflows/connect-deployer-binaries.yml').read_text()
        for target in assets.TARGETS:
            self.assertIn('target: '+target, workflow)

    def test_source_payload_is_detected_without_cwd_dependency(self):
        from connect_deployer.resources import payload_path
        self.assertTrue(payload_path().is_file())
        self.assertIn('secret_from_file_env', payload_path().read_text())

    def test_frozen_resource_path(self):
        from connect_deployer import resources
        with tempfile.TemporaryDirectory() as directory:
            payload = Path(directory)/'connect_deployer/payload/install-connect.py'
            payload.parent.mkdir(parents=True); payload.write_text('# test')
            with patch.object(resources.sys, 'frozen', True, create=True), patch.object(resources.sys, '_MEIPASS', directory, create=True):
                self.assertEqual(resources.payload_path(), payload)

    def test_missing_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): assets.verify(Path(directory), 'a'*40, '1.2.3', 'pr')

    def test_wrong_bundled_payload_checksum_is_rejected(self):
        # In CI Paramiko is available. Test detects tampering before any cryptographic operation.
        try:
            import paramiko
        except ImportError:
            self.skipTest('Paramiko is installed by the binary workflow')
        with patch.object(identity, 'build_info', return_value={'payload_sha256':'0'*64}):
            with self.assertRaises(OSError): identity.self_check()


if __name__ == '__main__':
    unittest.main()
