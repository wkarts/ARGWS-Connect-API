"""No Docker or credentials required for the full-stack readiness regression tests."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('readiness', Path(__file__).resolve().parents[1]/'scripts/check-full-stack-runtime.py')
readiness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(readiness)


def item(name, status='running', health='healthy', exit_code=0, restarts=0):
    return {'Config': {'Labels': {'com.docker.compose.service': name}}, 'RestartCount': restarts,
            'State': {'Status': status, 'Running': status == 'running', 'Restarting': status == 'restarting',
                      'ExitCode': exit_code, 'Health': {'Status': health}}}


class ReadinessTests(unittest.TestCase):
    def test_api_and_bootstrap_are_not_sufficient_while_mysql_is_starting(self):
        services = [item('api-test'), item('traccar-bootstrap-test', 'exited'), item('mysql-test', health='starting')]
        self.assertFalse(readiness.assess(services, ['api-test', 'traccar-bootstrap-test', 'mysql-test'])[0])

    def test_oneshot_completion_is_success_but_running_is_not(self):
        self.assertTrue(readiness.assess([item('traccar-bootstrap-test', 'exited')], ['traccar-bootstrap-test'])[0])
        self.assertFalse(readiness.assess([item('traccar-bootstrap-test')], ['traccar-bootstrap-test'])[0])
        self.assertFalse(readiness.assess([item('traccar-bootstrap-test', 'exited', exit_code=1)], ['traccar-bootstrap-test'])[0])

    def test_missing_or_extra_services_are_not_success(self):
        self.assertFalse(readiness.assess([item('api-test')], ['api-test', 'mysql-test'])[0])
        self.assertFalse(readiness.assess([item('api-test'), item('other-test')], ['api-test'])[0])

    def test_restarting_or_unhealthy_service_is_not_ready(self):
        self.assertFalse(readiness.assess([item('mysql-test', 'restarting')], ['mysql-test'])[0])
        self.assertFalse(readiness.assess([item('mysql-test', health='unhealthy')], ['mysql-test'])[0])
        self.assertTrue(readiness.assess([item('mysql-test')], ['mysql-test'])[0])

    def test_diagnostics_redact_secrets_and_workflow_commands(self):
        clean = readiness.redactor('MYSQL_ROOT_PASSWORD=synthetic-private-value\nTRACCAR_TOKEN="synthetic-token"\n')
        result = clean('password=not-env-secret\nsynthetic-private-value synthetic-token\nmysql://user:pass@localhost/db\n::warning::test')
        for secret in ('synthetic-private-value', 'synthetic-token', 'not-env-secret', 'user:pass'):
            self.assertNotIn(secret, result)
        self.assertIn('  ::warning::test', result)


if __name__ == '__main__':
    unittest.main()
