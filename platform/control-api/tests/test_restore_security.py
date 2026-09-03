from pathlib import Path

import pytest

from app.services.backup import BackupError, safe_backup_path


def test_safe_path_accepts_relative_member(tmp_path: Path) -> None:
    expected = (tmp_path / "databases" / "tenant.dump").resolve()
    assert safe_backup_path(tmp_path, "./databases/tenant.dump") == expected


@pytest.mark.parametrize("value", ["../etc/passwd", "/etc/passwd", "objects/../../root"])
def test_safe_path_rejects_traversal(tmp_path: Path, value: str) -> None:
    with pytest.raises(BackupError):
        safe_backup_path(tmp_path, value)
