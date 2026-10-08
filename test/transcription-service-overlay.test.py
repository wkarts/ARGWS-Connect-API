import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('overlay', ROOT / 'scripts/prepare-transcription-service.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
COMPOSES = ['docker-compose.yaml', 'docker-compose.dev.yaml', 'deploy/canonical/compose.yaml',
            'deploy/develop/compose.yaml', 'deploy/production/compose.yaml',
            'deploy/fersoft/develop/compose.yaml', 'deploy/fersoft/production/compose.yaml',
            'deploy/homologation/compose.yaml', 'deploy/dockge/compose.yaml', 'deploy/cloudpanel/docker-compose.yml']


class OverlayTests(unittest.TestCase):
    def test_all_ten_templates_preserve_normal_service_structure(self):
        for filename in COMPOSES:
            with self.subTest(filename=filename):
                base = yaml.safe_load((ROOT / filename).read_text())
                original = copy.deepcopy(base)
                result = MODULE.make_overlay(base, 'connect-transcription-service:test')['services']
                self.assertEqual(base, original)
                service = result['transcription-service']
                self.assertEqual(service['profiles'], ['transcription'])
                self.assertEqual(service['scale'], 1)
                self.assertNotIn('ports', service)
                self.assertNotIn('expose', service)
                self.assertNotIn('container_name', service)
                self.assertTrue(service['read_only'])
                self.assertEqual(service['mem_limit'], service['memswap_limit'])
                self.assertEqual(service['environment']['SPEECH_WORKER_CONCURRENCY'], '1')
                self.assertIn(':-false', service['environment']['SPEECH_ENABLED'])
                self.assertNotIn('ASR_INTERNAL_TOKEN', service['environment'])
                for name, changed in result.items():
                    if name.startswith(('transcription-worker', 'dictation-worker')):
                        self.assertEqual(changed, {'scale': 0})
                    elif name != 'transcription-service':
                        self.assertEqual(set(changed), {'environment'})
                        self.assertNotIn('depends_on', changed)
                        self.assertEqual(changed['environment'], MODULE.MODEL_ENV)
                for value in service.get('depends_on', {}):
                    self.assertNotIn(value, result, 'ASR must not introduce a dependency cycle with API')

    def test_native_lock_has_no_onnx_transformers_or_gpu_packages(self):
        package = json.loads((ROOT / 'transcription-worker/native/package.json').read_text())
        lock = json.loads((ROOT / 'transcription-worker/native/package-lock.json').read_text())
        self.assertEqual(package['dependencies'], lock['packages']['']['dependencies'])
        self.assertEqual(set(package['dependencies']), {'amqplib', 'minio'})
        for name in lock['packages']:
            self.assertFalse(any(term in name.lower() for term in ['onnxruntime', 'transformers', 'cuda']))
        self.assertTrue(all(entry.get('integrity') for name, entry in lock['packages'].items() if name))

    def test_output_cannot_replace_base_or_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'service.yaml'
            source = ROOT / 'docker-compose.yaml'
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            command = ['python3', str(ROOT / 'scripts/prepare-transcription-service.py'), '--compose', str(source)]
            result = subprocess.run(command + ['--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)['enabled'])
            self.assertNotEqual(subprocess.run(command + ['--output', str(output)], capture_output=True).returncode, 0)
            self.assertNotEqual(subprocess.run(command + ['--output', str(source), '--force'], capture_output=True).returncode, 0)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest)


if __name__ == '__main__':
    unittest.main()
