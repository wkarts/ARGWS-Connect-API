from __future__ import annotations

import contextlib
import io
import json
import unittest
from unittest.mock import patch

from connect_deployer import cli


class CLIBuildTests(unittest.TestCase):
    def test_build_info_does_not_connect(self):
        output = io.StringIO()
        with patch.object(cli, 'connect') as connect, contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(['--build-info']), 0)
        connect.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['repository'], 'wkarts/ARGWS-Connect-API')

    def test_missing_mode_remains_an_error(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            cli.main([])
        self.assertEqual(raised.exception.code, 2)

    def test_local_handoff_keeps_args_and_restores_library_path(self):
        args = cli.parser().parse_args(['local','--','--deployment','platform-develop','--help'])
        with patch.object(cli.sys, 'platform', 'linux'), patch.object(cli.shutil, 'which', return_value='/usr/bin/python3'), patch.object(cli.subprocess, 'call', return_value=0) as call:
            self.assertEqual(cli.run_local(args), 0)
        positional, keyword = call.call_args
        self.assertEqual(positional[0][0], '/usr/bin/python3')
        self.assertEqual(positional[0][-3:], ['--deployment','platform-develop','--help'])
        self.assertIn('env', keyword)

    def test_no_ssh_credentials_in_build_info(self):
        output = io.StringIO()
        with patch.dict(cli.os.environ, {'GH_TOKEN':'test-secret-never-embed'}), contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(['--build-info']), 0)
        self.assertNotIn('test-secret-never-embed', output.getvalue())


if __name__ == '__main__':
    unittest.main()
