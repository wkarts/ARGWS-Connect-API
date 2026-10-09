#!/usr/bin/env python3
"""Exercise the actual recovery control flow with a constrained Docker adapter."""

import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/connect-startup-diagnose.py'
SPEC = importlib.util.spec_from_file_location('startup_diagnose', SCRIPT)
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)
PROJECT = 'connect-develop'


def success(output=''):
    return {'ok': True, 'returncode': 0, 'timed_out': False, 'truncated': False, 'output': output}


def fixture(letter, service, project=PROJECT, running=True, image=None):
    worker = 'worker' in service or service.startswith('transcription-service')
    return {
        'Id': letter * 64, 'Image': 'sha256:' + ('f' if worker else 'e') * 64,
        'ImageReference': image or ('ghcr.io/wkarts/connect-transcription-service:develop' if worker else 'rabbitmq:4.3.6-management'),
        'Hostname': '8116f0934608', 'RestartCount': 0,
        'State': {'Status': 'running' if running else 'created', 'Running': running, 'Restarting': False,
                  'OOMKilled': False, 'ExitCode': 0, 'StartedAt': '2026-10-08T04:20:00Z',
                  'Health': {'Status': 'starting', 'FailingStreak': 0, 'Log': []}},
        'Labels': {diagnostic.PROJECT_LABEL: project, diagnostic.SERVICE_LABEL: service,
                   'com.docker.compose.project.working_dir': '/opt/stacks/connect',
                   'com.docker.compose.project.config_files': '/opt/stacks/connect/compose.yaml',
                   'com.docker.compose.oneoff': 'False'},
        'Env': ['SPEECH_ENABLED=true', 'SPEECH_WORKER_MODE=pool', 'SPEECH_ENGINE=whisper.cpp',
                'SPEECH_MODEL=whisper-base-q5_1', 'SPEECH_INFERENCE_THREADS=1'],
        'Quotas': {'Memory': 1342177280, 'MemorySwap': 1342177280, 'NanoCpus': 1000000000, 'PidsLimit': 96},
        'RabbitMounts': [],
    }


class DockerAdapter:
    def __init__(self, records):
        self.records = {record['Id']: copy.deepcopy(record) for record in records}
        self.calls = []
        self.inspections = {}
        self.on_inspect = None
        self.logs = {}
        self.stop_timeout = False
        self.list_timeout = False

    def run(self, args, **kwargs):
        self.calls.append(list(args))
        if args[:3] == ['docker', 'context', 'inspect']:
            return success(json.dumps('unix:///var/run/docker.sock'))
        if args[:2] == ['docker', 'ps']:
            if self.list_timeout:
                return {'ok': False, 'returncode': -9, 'timed_out': True, 'truncated': False,
                        'output': 'amqp://wrong:private-password@localhost/'}
            # Deliberately include foreign projects, as a faulty/stale listing could.
            return success('\n'.join(self.records))
        if args[:2] == ['docker', 'inspect']:
            identifier = args[-1]
            self.inspections[identifier] = self.inspections.get(identifier, 0) + 1
            if self.on_inspect:
                self.on_inspect(identifier, self.inspections[identifier], self.records[identifier])
            return success(json.dumps(self.records[identifier]))
        if args[:3] == ['docker', 'image', 'inspect']:
            return success(json.dumps({'id': args[-1], 'repo_digests': ['ghcr.io/wkarts/connect@sha256:' + 'b' * 64],
                                       'revision': 'a' * 40}))
        if args[:2] == ['docker', 'logs']:
            return success(self.logs.get(args[-1], 'Server startup complete; 4 plugins started.'))
        if args[:2] == ['docker', 'stats']:
            return success('\n'.join(json.dumps({'ID': identifier, 'Name': record['Labels'][diagnostic.SERVICE_LABEL],
                                                 'CPUPerc': '3.00%', 'MemUsage': '200MiB / 1.25GiB', 'PIDs': '8'})
                                      for identifier, record in self.records.items() if identifier in args and record['State']['Running']))
        if args[:2] == ['docker', 'stop']:
            if self.stop_timeout:
                return {'ok': False, 'returncode': -9, 'timed_out': True, 'truncated': False, 'output': ''}
            self.records[args[-1]]['State'].update(Running=False, Status='exited')
            return success(args[-1])
        if args[0] in ('df', 'ps', 'vmstat'):
            return success('')
        raise AssertionError('Unexpected command: ' + repr(args[:3]))


def host_stub(_runner, _vmstat=False):
    return {'meminfo': {'MemAvailable': '1024000 kB'}}


class StartupDiagnosisTests(unittest.TestCase):
    def test_default_is_read_only_and_verifies_project_after_listing(self):
        own = fixture('a', 'transcription-service')
        foreign = fixture('b', 'transcription-service', project='another-tenant')
        runner = DockerAdapter([own, foreign, fixture('c', 'rabbitmq')])
        report = diagnostic.diagnose(PROJECT, runner, sample_host=host_stub)
        self.assertEqual(report['mode'], 'read_only')
        self.assertEqual({item['id'] for item in report['before']['containers']}, {'a' * 64, 'c' * 64})
        self.assertEqual(report['actions'], [])
        self.assertTrue(report['issues'])
        self.assertIn('label=com.docker.compose.project=' + PROJECT, next(call for call in runner.calls if call[1] == 'ps'))
        self.assertFalse(any(call[:2] == ['docker', 'stop'] for call in runner.calls))
        self.assertFalse(any(call[:2] == ['docker', 'logs'] and call[-1] == foreign['Id'] for call in runner.calls))

    def test_pause_stops_only_same_project_recognized_speech_and_measures_again(self):
        records = [fixture('a', 'transcription-service'), fixture('b', 'speech-dictation-worker-argws-connect-develop'),
                   fixture('c', 'rabbitmq'), fixture('d', 'api'), fixture('e', 'kafka'), fixture('f', 'nats'),
                   fixture('1', 'postgres'), fixture('2', 'transcription-service', project='production')]
        runner = DockerAdapter(records)
        report = diagnostic.diagnose(PROJECT, runner, pause=True, sample_host=host_stub)
        stopped = [call for call in runner.calls if call[:2] == ['docker', 'stop']]
        self.assertEqual(stopped, [['docker', 'stop', '--time', '15', 'a' * 64],
                                   ['docker', 'stop', '--time', '15', 'b' * 64]])
        self.assertTrue(all(action['stopped'] for action in report['actions']))
        self.assertEqual(len([call for call in runner.calls if call[:2] == ['docker', 'stats']]), 2)
        self.assertTrue(runner.records['c' * 64]['State']['Running'])
        self.assertFalse(next(item for item in report['after']['containers'] if item['id'] == 'a' * 64)['state']['Running'])

    def test_changed_labels_unrecognized_image_and_oneoff_are_never_stopped(self):
        records = [fixture('a', 'transcription-service'), fixture('b', 'dictation-worker', image='postgres:15'),
                   fixture('c', 'speech-worker')]
        records[2]['Labels']['com.docker.compose.oneoff'] = 'True'
        runner = DockerAdapter(records)

        def replace_label(identifier, count, raw):
            if identifier == 'a' * 64 and count >= 2:
                raw['Labels'][diagnostic.SERVICE_LABEL] = 'api'

        runner.on_inspect = replace_label
        report = diagnostic.diagnose(PROJECT, runner, pause=True, sample_host=host_stub)
        self.assertFalse(any(call[:2] == ['docker', 'stop'] for call in runner.calls))
        self.assertTrue(all(not action['stopped'] for action in report['actions']))

    def test_timeout_never_becomes_success_or_healthy(self):
        runner = DockerAdapter([fixture('a', 'transcription-service')])
        runner.stop_timeout = True
        report = diagnostic.diagnose(PROJECT, runner, pause=True, sample_host=host_stub)
        self.assertFalse(report['actions'][0]['stopped'])
        self.assertTrue(report['actions'][0]['command']['timed_out'])
        runner = DockerAdapter([])
        runner.list_timeout = True
        report = diagnostic.diagnose(PROJECT, runner, pause=True, sample_host=host_stub)
        self.assertEqual(report['actions'], [])
        self.assertTrue(report['issues'][0]['timed_out'])
        self.assertNotIn('private-password', json.dumps(report))

    def test_report_does_not_expose_environment_credentials_or_log_uris(self):
        rabbit, worker = fixture('c', 'rabbitmq'), fixture('a', 'transcription-service')
        worker['Env'] += ['RABBITMQ_URI=amqp://user:never-env-password@mq/', 'DATABASE_URL=postgres://secret/db',
                          'API_KEY=never-api-key', 'SPEECH_CONFIG=' + json.dumps({
                              'enabled': True, 'model': 'whisper-base-q5_1', 'password': 'never-config-password',
                              'rabbitmq': {'uri': 'amqp://never-config-uri@mq'}, 'local': {'model': 'safe-model', 'secret': 'never-local-secret'}})]
        rabbit['State']['Health']['Log'] = [{'ExitCode': 1, 'Output': 'amqps://user:never-health-password@mq/vhost\npassword="never-plaintext"'}] * 7
        rabbit['State']['Error'] = 'Authorization: Bearer never-bearer-token'
        runner = DockerAdapter([rabbit, worker])
        runner.logs[rabbit['Id']] = ('amqp://user:never-log-password@host/vhost\naccess_key="never-access-key"\n'
                                    'amqp:\\/\\/user:never-escaped-password@host/vhost\nRunning boot step database')
        runner.logs[worker['Id']] = 'SPEECH_CONFIG ' + json.dumps({'model': 'safe-model', 'token': 'never-worker-token'})
        report = diagnostic.diagnose(PROJECT, runner, sample_host=host_stub)
        output = json.dumps(report) + diagnostic.summary(report)
        self.assertNotIn('never-', output)
        self.assertNotIn('amqp://', output)
        self.assertIn('safe-model', output)
        self.assertEqual(len(report['before']['containers'][0]['health']['last_checks']), 5)
        fmt = diagnostic.inspect_format()
        self.assertNotIn('"RABBITMQ_URI"', fmt)
        self.assertNotIn('"DATABASE_URL"', fmt)
        self.assertNotIn('{{json .Config.Env}}', fmt)

    def test_override_preserves_current_custom_identity_and_local_image_without_actions(self):
        rabbit = fixture('c', 'rabbitmq-argws-connect-develop')
        rabbit['Hostname'] = 'mq-persistido.internal'
        rabbit['Env'] += ['RABBITMQ_NODENAME=my-node@mq-persistido.internal', 'RABBITMQ_USE_LONGNAME=true',
                          'RABBITMQ_DEFAULT_PASS=never-override-password']
        runner = DockerAdapter([rabbit])
        report = diagnostic.diagnose(PROJECT, runner, sample_host=host_stub, prepare_override=True)
        override = report['rabbitmq_override']
        self.assertTrue(override['ok'])
        self.assertEqual(override['compose'], {'services': {'rabbitmq-argws-connect-develop': {
            'hostname': 'mq-persistido.internal', 'image': rabbit['Image'], 'pull_policy': 'never',
            'environment': {'RABBITMQ_NODENAME': 'my-node@mq-persistido.internal', 'RABBITMQ_USE_LONGNAME': 'true'},
        }}})
        self.assertNotIn('never-override-password', json.dumps(report))
        self.assertFalse(any(call[:2] in (['docker', 'stop'], ['docker', 'compose'], ['docker', 'pull']) for call in runner.calls))

    def test_override_refuses_ambiguous_missing_changed_or_invalid_identity(self):
        for records in ([], [fixture('b', 'rabbitmq'), fixture('c', 'rabbitmq-secondary')]):
            runner = DockerAdapter(records)
            selected, _ = diagnostic.inventory(runner, PROJECT)
            self.assertFalse(diagnostic.prepare_rabbit_override(runner, selected, PROJECT)['ok'])
        rabbit = fixture('c', 'rabbitmq')
        rabbit['Env'] += ['RABBITMQ_NODENAME=amqp://never-name-password@mq']
        runner = DockerAdapter([rabbit])
        selected, _ = diagnostic.inventory(runner, PROJECT)
        self.assertFalse(diagnostic.prepare_rabbit_override(runner, selected, PROJECT)['ok'])
        rabbit['Env'] = []
        runner = DockerAdapter([rabbit])
        selected, _ = diagnostic.inventory(runner, PROJECT)
        runner.records[rabbit['Id']]['Labels'][diagnostic.PROJECT_LABEL] = 'foreign'
        self.assertFalse(diagnostic.prepare_rabbit_override(runner, selected, PROJECT)['ok'])

    def test_mnesia_probe_only_lists_directories_one_level_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            mount = Path(temporary) / 'rabbitmq'
            mnesia = mount / 'mnesia'
            (mnesia / 'rabbit@existing' / 'private-child').mkdir(parents=True)
            (mnesia / 'rabbit@existing' / 'private-child' / 'contents').write_text('never-read-this-content')
            (mnesia / 'rabbit@second').mkdir()
            (mnesia / 'rabbit@not-a-directory').write_text('never-read-this-file')
            result = diagnostic.Runner().run([sys.executable, '-c', diagnostic.MNESIA_PROBE, str(mount), '/var/lib/rabbitmq'])
            self.assertTrue(result['ok'])
            self.assertEqual(json.loads(result['output'])['names'], ['rabbit@existing', 'rabbit@second'])
            self.assertNotIn('private-child', result['output'])
            link = Path(temporary) / 'other'
            link.symlink_to(mount, target_is_directory=True)
            result = diagnostic.Runner().run([sys.executable, '-c', diagnostic.MNESIA_PROBE, str(link), '/var/lib/rabbitmq'])
            self.assertEqual(json.loads(result['output'])['error'], 'ValueError')

    def test_subprocess_output_and_time_are_bounded_and_spawn_failure_is_reported(self):
        runner = diagnostic.Runner(timeout=0.15, budget=2)
        started = time.monotonic()
        result = runner.run([sys.executable, '-c', 'import time; time.sleep(10)'])
        self.assertTrue(result['timed_out'])
        self.assertLess(time.monotonic() - started, 2)
        result = diagnostic.Runner().run([sys.executable, '-c', 'print("x" * 1000000)'], cap=1024)
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['output']), 1024)
        result = diagnostic.Runner().run(['/no-such-connect-diagnostic-executable'])
        self.assertFalse(result['ok'])
        self.assertIn('FileNotFoundError', result['error'])

    def test_cli_requires_project_and_does_not_create_output_on_argument_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'report'
            result = subprocess.run([sys.executable, str(SCRIPT), '--output-dir', str(destination)], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 2)
            self.assertIn(b'--project', result.stderr)
            self.assertFalse(destination.exists())

    def test_cli_writes_private_reports_and_override_without_applying_it(self):
        runner = DockerAdapter([fixture('c', 'rabbitmq')])
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'report'
            previous_umask = os.umask(0o077)
            try:
                with patch.object(diagnostic, 'Runner', return_value=runner), redirect_stdout(io.StringIO()):
                    result = diagnostic.main(['--project', PROJECT, '--output-dir', str(destination), '--prepare-rabbitmq-override'])
            finally:
                os.umask(previous_umask)
            self.assertEqual(result, 0)
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o700)
            for name in ('diagnostico.json', 'resumo.txt', 'compose.rabbitmq-preserve.json'):
                self.assertEqual(stat.S_IMODE((destination / name).stat().st_mode), 0o600)
            override = json.loads((destination / 'compose.rabbitmq-preserve.json').read_text())
            self.assertEqual(override['services']['rabbitmq']['hostname'], '8116f0934608')
            self.assertFalse(any(call[:2] == ['docker', 'stop'] for call in runner.calls))


if __name__ == '__main__':
    unittest.main()
