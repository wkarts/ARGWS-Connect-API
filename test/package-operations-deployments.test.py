#!/usr/bin/env python3
"""Exercise real package contents, integrity failures and CI evidence in temporary directories."""
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "operations_package", Path(__file__).resolve().parent.parent / "scripts/package-operations-deployments.py")
PACKAGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGER)
REVISION = "a" * 40


class OperationsPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in (*PACKAGER.REQUIRED, "deploy/example/compose.yaml", "deploy/example/.env.example"):
            self.write(name, f"fixture: {name}\n".encode())
        self.output = self.root / "distribution.zip"

    def write(self, name, data):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def test_exact_zip_inventory_hashes_and_summary(self):
        receipt = PACKAGER.package(self.root, self.output, REVISION)
        self.assertEqual(receipt["sourceRevision"], REVISION)
        self.assertEqual(receipt["fileCount"], len(PACKAGER.REQUIRED) + 2)
        self.assertEqual(receipt["archive"]["sha256"], PACKAGER.digest(self.output.read_bytes()))
        with zipfile.ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {item["file"] for item in receipt["inventory"]})
            for item in receipt["inventory"]:
                data = archive.read(item["file"])
                self.assertEqual(data, (self.root / item["file"]).read_bytes())
                self.assertEqual(item["bytes"], len(data))
                self.assertEqual(item["sha256"], PACKAGER.digest(data))
        summary = self.root / "summary.md"
        summary.write_text("Earlier step\n", encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            PACKAGER.emit_evidence(receipt, summary)
        self.assertEqual(json.loads(output.getvalue()), receipt)
        self.assertTrue(summary.read_text().startswith("Earlier step\n"))
        self.assertIn(receipt["archive"]["sha256"], summary.read_text())
        self.assertIn(REVISION, summary.read_text())
        self.assertIn("deploy/example/.env.example", summary.read_text())
        original = self.output.read_bytes()
        PACKAGER.package(self.root, self.output, REVISION)
        self.assertEqual(original, self.output.read_bytes())

    def test_runtime_files_and_credentials_are_excluded(self):
        for name in ("deploy/example/.env", "deploy/example/install.lock", "deploy/example/volumes/db/data",
                     "deploy/example/__pycache__/cache.pyc"):
            self.write(name, b"PRIVATE RUNTIME CONTENT")
        receipt = PACKAGER.package(self.root, self.output, REVISION)
        self.assertFalse(any(PACKAGER.excluded(Path(item["file"])) for item in receipt["inventory"]))
        with zipfile.ZipFile(self.output) as archive:
            self.assertFalse(any(b"PRIVATE RUNTIME CONTENT" in archive.read(name) for name in archive.namelist()))

    def test_missing_required_source_or_empty_deploy_fails(self):
        (self.root / "docker-compose.yaml").unlink()
        with self.assertRaisesRegex(ValueError, "required template"):
            PACKAGER.package(self.root, self.output, REVISION)
        self.assertFalse(self.output.exists())
        self.write("docker-compose.yaml", b"restored")
        for file in (self.root / "deploy").rglob("*"):
            if file.is_file():
                file.unlink()
        with self.assertRaisesRegex(ValueError, "No deployment"):
            PACKAGER.package(self.root, self.output, REVISION)

    def test_symlink_and_invalid_revision_fail(self):
        (self.root / "deploy/example/link.yaml").symlink_to(self.root / "docker-compose.yaml")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            PACKAGER.package(self.root, self.output, REVISION)
        with self.assertRaisesRegex(ValueError, "revision"):
            PACKAGER.package(self.root, self.output, "invalid")

    def test_modified_member_unexpected_member_and_broken_crc_fail(self):
        expected = {"deploy/compose.yaml": b"services: exact-source\n"}
        with zipfile.ZipFile(self.output, "w") as archive:
            archive.writestr("deploy/compose.yaml", b"different source")
        with self.assertRaisesRegex(ValueError, "content does not match"):
            PACKAGER.verify_archive(self.output, expected)
        with zipfile.ZipFile(self.output, "a") as archive:
            archive.writestr("deploy/.env", b"secret")
        with self.assertRaisesRegex(ValueError, "inventory"):
            PACKAGER.verify_archive(self.output, expected)
        with zipfile.ZipFile(self.output, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("deploy/compose.yaml", expected["deploy/compose.yaml"])
        data = self.output.read_bytes().replace(b"exact-source", b"BROKENsource")
        self.output.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "CRC"):
            PACKAGER.verify_archive(self.output, expected)


if __name__ == "__main__":
    unittest.main()
