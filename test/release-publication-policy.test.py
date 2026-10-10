#!/usr/bin/env python3
"""Regression for PR227: a release hold is not a failed source validation."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / '.github/scripts/release-publication-policy.py'
spec = importlib.util.spec_from_file_location('release_policy', SCRIPT)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PublicationPolicyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / '.github').mkdir()
        self.output = self.root / 'output'
        self.summary = self.root / 'summary'

    def hold(self, content='Publication is awaiting operational validation.'):
        (self.root / policy.HOLD_PATH).write_text(content, encoding='utf-8')

    def run_policy(self, event='push', ref='refs/heads/main', **extra):
        env = {
            'PATH': os.environ.get('PATH', ''),
            'GITHUB_EVENT_NAME': event, 'GITHUB_REF': ref,
            'GITHUB_OUTPUT': str(self.output),
            'GITHUB_STEP_SUMMARY': str(self.summary), **extra,
        }
        return subprocess.run([sys.executable, str(SCRIPT)], cwd=self.root, env=env,
                              capture_output=True, text=True, timeout=10)

    def outputs(self):
        return dict(line.split('=', 1) for line in self.output.read_text().splitlines()) if self.output.exists() else {}

    def test_post_merge_with_hold_suspends_publication_without_failing_validation(self):
        self.hold()
        result = self.run_policy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.outputs(), {'publish': 'false', 'reason': 'held'})
        self.assertIn('Validation continues', result.stdout)
        self.assertIn('no version, tag or image', self.summary.read_text())

    def test_dispatch_and_force_bump_cannot_override_hold(self):
        self.hold()
        result = self.run_policy('workflow_dispatch', FORCE_BUMP='major', INPUT_FORCE_BUMP='major')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.outputs()['publish'], 'false')

    def test_main_without_hold_can_publish_after_validation(self):
        for event in ['push', 'workflow_dispatch']:
            with self.subTest(event=event):
                self.assertEqual(policy.publication_policy(event, 'refs/heads/main', self.root), (True, 'eligible'))

    def test_pr_without_hold_never_publishes(self):
        result = self.run_policy('pull_request', 'refs/pull/229/merge')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.outputs(), {'publish': 'false', 'reason': 'validation-only'})

    def test_pr_with_hold_still_validates_and_reports_hold(self):
        self.hold()
        result = self.run_policy('pull_request', 'refs/pull/229/merge')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.outputs(), {'publish': 'false', 'reason': 'held'})

    def test_other_refs_fail_closed_for_push_and_manual_dispatch(self):
        for event in ['push', 'workflow_dispatch']:
            for ref in ['refs/heads/develop', 'refs/tags/v1.2.2', '', 'refs/pull/229/merge']:
                with self.subTest(event=event, ref=ref):
                    result = self.run_policy(event, ref)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn('publish', self.outputs())

    def test_unknown_events_fail_closed(self):
        for event in ['', 'schedule', 'pull_request_target', 'workflow_run']:
            with self.subTest(event=event):
                self.assertNotEqual(self.run_policy(event).returncode, 0)
                self.assertNotIn('publish', self.outputs())

    def test_empty_hold_is_a_hold(self):
        self.hold('')
        self.assertEqual(policy.publication_policy('push', 'refs/heads/main', self.root), (False, 'held'))

    def test_directory_at_hold_path_cannot_enable_publication(self):
        (self.root / policy.HOLD_PATH).mkdir()
        self.assertEqual(policy.publication_policy('push', 'refs/heads/main', self.root), (False, 'held'))

    def test_dangling_symlink_cannot_bypass_hold(self):
        (self.root / policy.HOLD_PATH).symlink_to(self.root / 'missing')
        self.assertEqual(policy.publication_policy('push', 'refs/heads/main', self.root), (False, 'held'))

    def test_io_errors_are_not_treated_as_absence(self):
        with patch.object(Path, 'lstat', side_effect=PermissionError('sensitive path')):
            with self.assertRaises(PermissionError):
                policy.publication_policy('push', 'refs/heads/main', self.root)

    def test_output_is_required_and_no_override_environment_can_enable_hold(self):
        self.hold()
        result = self.run_policy(GITHUB_OUTPUT='', RELEASE_HOLD='false', ALLOW_RELEASE='true')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('publish', self.outputs())

    def test_hold_contents_are_never_executed_or_echoed(self):
        secret = '::error::PRIVATE_MARKER\n$(touch injected)\npublish=true\n'
        self.hold(secret)
        result = self.run_policy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('PRIVATE_MARKER', result.stdout + result.stderr + self.summary.read_text())
        self.assertFalse((self.root / 'injected').exists())
        self.assertEqual(self.outputs()['publish'], 'false')
        self.assertEqual((self.root / policy.HOLD_PATH).read_text(), secret)

    def test_summary_failure_is_not_hidden(self):
        result = self.run_policy(GITHUB_STEP_SUMMARY=str(self.root / 'missing' / 'summary'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('publication denied', result.stderr)


class WorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / '.github/workflows/auto-version-release.yml').read_text()
        cls.workflow = yaml.load(cls.source, Loader=yaml.BaseLoader)
        cls.jobs = cls.workflow['jobs']

    def test_same_release_validation_runs_on_pr_before_merge(self):
        trigger = self.workflow['on']['pull_request']
        self.assertEqual(trigger['branches'], ['main'])
        self.assertIn('.github/workflows/auto-version-release.yml', trigger['paths'])
        self.assertIn('.github/scripts/release-publication-policy.py', trigger['paths'])
        self.assertEqual(self.jobs['validate']['permissions'], {'contents': 'read'})
        group = self.workflow['concurrency']['group']
        self.assertIn('release-validation-pr-', group)
        self.assertIn('argws-connect-release-main', group)

    def test_version_planning_requires_explicit_permission_and_success_on_main(self):
        validate = self.jobs['validate']
        self.assertEqual(validate['outputs']['publish'], '${{ steps.release-policy.outputs.publish }}')
        plan = self.jobs['plan-version']
        self.assertEqual(plan['needs'], 'validate')
        self.assertEqual(plan['if'], "${{ needs.validate.result == 'success' && needs.validate.outputs.publish == 'true' && github.ref == 'refs/heads/main' && github.event_name != 'pull_request' }}")
        self.assertNotIn('always()', plan['if'])

    def test_all_publication_jobs_remain_behind_version_planning(self):
        # Graph reachability protects every job, including downstream reusable workflows.
        def depends(job, target, seen=None):
            seen = set() if seen is None else seen
            if job in seen:
                return False
            seen.add(job)
            needs = self.jobs[job].get('needs', [])
            needs = [needs] if isinstance(needs, str) else needs
            return target in needs or any(depends(parent, target, seen.copy()) for parent in needs)
        for name, job in self.jobs.items():
            if name in ['validate', 'plan-version']:
                continue
            with self.subTest(job=name):
                self.assertTrue(depends(name, 'plan-version'))
                if 'always()' in job.get('if', ''):
                    self.assertEqual(name, 'protected-retention')
                    self.assertIn("needs.release.result == 'success'", job['if'])
                    self.assertIn("needs.sync-develop.result == 'success'", job['if'])

    def test_hold_does_not_skip_or_suppress_real_validation(self):
        validate = self.jobs['validate']
        self.assertNotIn('continue-on-error', validate)
        runs = '\n'.join(step.get('run', '') for step in validate['steps'])
        for command in ['npm ci', 'npm run lint:check', 'npm run db:generate', 'npm run build',
                        'npm run test:operations', 'npm --prefix manager run test', 'npm run docs:check']:
            self.assertIn(command, runs)
        for step in validate['steps']:
            self.assertNotIn('continue-on-error', step)
            if step.get('name') != 'Refuse publication outside main':
                self.assertNotIn('if', step, step.get('name'))
        self.assertNotIn('exit 0', runs)
        self.assertNotIn('|| true', runs)
        self.assertIn('python3 test/release-publication-policy.test.py', runs)

    def test_validation_dependencies_are_installed_before_audio_tests(self):
        steps = self.jobs['validate']['steps']
        dependencies = next(i for i, v in enumerate(steps) if v.get('name') == 'Install validation dependencies')
        operations = next(i for i, v in enumerate(steps) if v.get('name', '').startswith('Validate operations'))
        self.assertLess(dependencies, operations)
        self.assertIn('ffmpeg python3-yaml', steps[dependencies]['run'])


if __name__ == '__main__':
    unittest.main()
