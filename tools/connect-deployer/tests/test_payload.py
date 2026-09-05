from __future__ import annotations

import ast
import unittest
from pathlib import Path


class PayloadTests(unittest.TestCase):
    def test_payload_is_valid_python(self):
        path = Path(__file__).resolve().parents[1] / "src" / "connect_deployer" / "payload" / "install-connect.py"
        ast.parse(path.read_text(encoding="utf-8"))

    def test_payload_keeps_no_destructive_database_actions(self):
        path = Path(__file__).resolve().parents[1] / "src" / "connect_deployer" / "payload" / "install-connect.py"
        text = path.read_text(encoding="utf-8")
        self.assertIn("Never runs SQL, ACME, clpctl, host cron or migrations", text)
        self.assertNotIn("docker compose down -v", text)


if __name__ == "__main__":
    unittest.main()
