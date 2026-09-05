"""Build identity and offline checks for the optional deployment launcher."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

from . import __version__
from .resources import payload_path


def build_info() -> dict:
    path = Path(__file__).with_name("build-info.json")
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "project": "ARGWS Connect API",
        "repository": "wkarts/ARGWS-Connect-API",
        "deployer_version": __version__,
        "channel": "source-unbuilt",
        "payload_sha256": hashlib.sha256(payload_path().read_bytes()).hexdigest(),
    }


def version_label() -> str:
    info = build_info()
    revision = info.get("source_sha", "unbuilt")[:12]
    return (f"connect-deploy {__version__} | ARGWS Connect API "
            f"{info.get('project_version', 'source')} [{info['channel']}:{revision}]")


def system_subprocess_env() -> dict[str, str]:
    """Restore Linux/macOS library paths before invoking the VPS's own Python."""
    env = dict(os.environ)
    if getattr(sys, "frozen", False):
        for name in ("LD_LIBRARY_PATH", "LIBPATH", "DYLD_LIBRARY_PATH"):
            original = env.pop(name + "_ORIG", None)
            env.pop(name, None)
            if original is not None:
                env[name] = original
    return env


def self_check() -> dict:
    """Exercise bundled resources, cryptography and SSH imports; never connect."""
    import ast
    import paramiko
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    data = payload_path().read_bytes()
    ast.parse(data.decode("utf-8"))
    info = build_info()
    actual = hashlib.sha256(data).hexdigest()
    if actual != info["payload_sha256"]:
        raise OSError("Integridade do payload embutido não confere.")
    key = Ed25519PrivateKey.generate()
    message = b"connect-deployer-offline-self-check"
    key.public_key().verify(key.sign(message), message)
    # Key construction loads Paramiko's crypto integration without a network call.
    paramiko.RSAKey.generate(2048)
    return {"status": "PASS", "network_used": False, "deployment_executed": False,
            "payload_sha256": actual, "paramiko_version": paramiko.__version__,
            "build": info}
