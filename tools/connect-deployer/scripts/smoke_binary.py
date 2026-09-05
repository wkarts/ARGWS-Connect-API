"""Smoke checks execute the frozen artifact, never SSH or a real deployment."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    exe = (ROOT / "dist" / ("connect-deploy.exe" if os.name == "nt" else "connect-deploy")).resolve()
    info = json.loads((ROOT / "src/connect_deployer/build-info.json").read_text())
    # cwd outside the source tree detects payload accidentally loaded from the checkout.
    with tempfile.TemporaryDirectory(prefix="connect-deployer-smoke-") as directory:
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        def run(*arguments):
            return subprocess.check_output([str(exe), *arguments], cwd=directory, env=env,
                                           text=True, encoding="utf-8", errors="replace", timeout=60)
        assert "ARGWS Connect API" in run("--version")
        assert info == json.loads(run("--build-info"))
        checked = json.loads(run("--self-check"))
        assert checked["status"] == "PASS" and checked["network_used"] is False
        assert checked["payload_sha256"] == info["payload_sha256"]
        assert "ssh" in run("--help")
        assert "--known-hosts" in run("ssh", "--help")
        assert "--env-input" in run("local", "--help")
        if info["target"].startswith("linux-"):
            assert "--deployment" in run("local", "--", "--help")
    print("PASS: frozen identity, bundled payload, SSH/crypto, help and Linux local delegation")


if __name__ == "__main__":
    main()
