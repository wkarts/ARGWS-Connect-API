from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('package_metadata_test', ROOT/'scripts/package_artifact.py')
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class HeaderMetadata(dict):
    def __str__(self):
        raise ValueError('Legacy email-style Description must not be reserialized')


class Distribution:
    version = '1.2.3'
    metadata = HeaderMetadata(Name='multiline-legacy')
    files = []

    def __init__(self, files):
        self.raw = files

    def read_text(self, name):
        return self.raw.get(name)


class PackageMetadataTests(unittest.TestCase):
    def test_multiline_legacy_metadata_is_preserved_verbatim(self):
        raw = 'Name: multiline-legacy\nDescription: first line\n    Links:\n    multiline text\n'
        with patch.object(package.importlib.metadata, 'distributions', return_value=[Distribution({'METADATA':raw})]):
            files = package.third_party_files()
        self.assertEqual(files['THIRD-PARTY/multiline-legacy/METADATA.txt'], raw.encode())
        self.assertEqual(files['DEPENDENCIES.txt'], b'multiline-legacy==1.2.3\n')

    def test_source_distribution_uses_pkg_info(self):
        raw = 'Name: multiline-legacy\nDescription: Conteúdo UTF-8\n'
        with patch.object(package.importlib.metadata, 'distributions', return_value=[Distribution({'PKG-INFO':raw})]):
            files = package.third_party_files()
        self.assertEqual(files['THIRD-PARTY/multiline-legacy/METADATA.txt'], raw.encode())

    def test_missing_raw_metadata_uses_structured_fallback(self):
        with patch.object(package.importlib.metadata, 'distributions', return_value=[Distribution({})]):
            files = package.third_party_files()
        self.assertEqual(json.loads(files['THIRD-PARTY/multiline-legacy/METADATA.txt']), [['Name','multiline-legacy']])


if __name__ == '__main__':
    unittest.main()
