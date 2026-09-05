from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from connect_deployer.cli import _installer_remainder
from connect_deployer.ssh_client import SSHOptions, build_remote_command


class CommandTests(unittest.TestCase):
    def test_remainder_removes_separator(self):
        self.assertEqual(_installer_remainder(["--", "--apply", "--yes"]), ["--apply", "--yes"])

    def test_remote_command_quotes_arguments(self):
        options = SSHOptions(host="example.test", user="deploy", python_command="python3")
        cmd = build_remote_command(
            options=options,
            paths={"payload": "/tmp/a/install-connect.py", "env_input": "/tmp/a/env.input"},
            installer_args=["--directory", "/opt/stacks/name with space", "--apply"],
        )
        self.assertIn("'/opt/stacks/name with space'", cmd)
        self.assertIn("--env-input /tmp/a/env.input", cmd)

    def test_sudo_places_secret_file_after_sudo_env(self):
        options = SSHOptions(host="example.test", user="deploy", sudo=True)
        cmd = build_remote_command(
            options=options,
            paths={"payload": "/tmp/a/install-connect.py", "github_token": "/tmp/a/github.token"},
            installer_args=["--prepare", "--yes"],
        )
        self.assertTrue(cmd.startswith("sudo -n env GH_TOKEN_FILE="))
        self.assertNotIn("secret-value", cmd)


if __name__ == "__main__":
    unittest.main()
