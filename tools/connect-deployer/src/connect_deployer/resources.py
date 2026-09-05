from __future__ import annotations

import sys
from pathlib import Path


def payload_path() -> Path:
    """Return the bundled installer payload path in source or PyInstaller builds."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        candidate = Path(sys._MEIPASS) / "connect_deployer" / "payload" / "install-connect.py"
    else:
        candidate = Path(__file__).resolve().parent / "payload" / "install-connect.py"

    if not candidate.is_file():
        raise FileNotFoundError(f"Payload install-connect.py não encontrado em {candidate}")
    return candidate
