"""Permission preparation never changes populated or active data directories."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('volumes', Path(__file__).resolve().parents[1]/'scripts/prepare-full-stack-volumes.py')
volumes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(volumes)


class VolumeTests(unittest.TestCase):
    def test_writable_existing_data_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory); (path/'existing.ibd').write_text('fixture')
            with patch.object(volumes, 'writable', return_value=True), patch.object(volumes, 'run') as run:
                self.assertEqual(volumes.initialize('fixture-image', path, '1001', '1001', set()), 'preservado')
                run.assert_not_called()
            self.assertEqual((path/'existing.ibd').read_text(), 'fixture')

    def test_populated_unwritable_data_is_not_chowned_or_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory); (path/'existing.ibd').write_text('fixture')
            with patch.object(volumes, 'writable', return_value=False), patch.object(volumes, 'run') as run:
                with self.assertRaises(ValueError): volumes.initialize('fixture-image', path, '1001', '1001', set())
                run.assert_not_called()
            self.assertEqual((path/'existing.ibd').read_text(), 'fixture')

    def test_active_mount_is_not_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with patch.object(volumes, 'writable', return_value=False), patch.object(volumes, 'run') as run:
                with self.assertRaises(ValueError): volumes.initialize('fixture-image', path, '1001', '1001', {str(path)})
                run.assert_not_called()

    def test_empty_directory_uses_offline_finite_helper_not_privileged_daemon(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(volumes, 'writable', side_effect=[False, True]), patch.object(volumes, 'run') as run:
                self.assertEqual(volumes.initialize('fixture-image', Path(directory), '1001', '1002', set()), 'preparado')
                args = run.call_args.args[0]
                self.assertIn('--read-only', args); self.assertIn('none', args); self.assertNotIn('--privileged', args)
                self.assertEqual(args[-2:], ['1001', '1002'])
                self.assertNotIn('777', args[-4]); self.assertNotIn('chown -R', args[-4])
                self.assertIn('ls -A /prepared-data', args[-4])

    def test_symlink_in_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory); (path/'real').mkdir(); (path/'link').symlink_to(path/'real')
            with self.assertRaises(ValueError): volumes.safe_directory(path/'link'/'data')

    def test_whatsapp_and_primary_postgres_are_not_targets(self):
        self.assertEqual(set(volumes.TARGETS), {'mysql-', 'kafka-', 'zookeeper-'})
        self.assertNotIn('/argws-connect/instances', set().union(*volumes.TARGETS.values()))


if __name__ == '__main__': unittest.main()
