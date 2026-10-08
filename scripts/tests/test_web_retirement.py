"""Portable integrity/path/rollback tests; no live service or database touched."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("retire_web", ROOT / "ops/deploy/retire-web.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kst-web-retirement-test-")
        self.root = Path(self.temporary.name).resolve()
        self.data = self.root / "kesaitong-platform"
        self.data.mkdir()
        self.web = self.data / "web"
        (self.web / "releases/r1").mkdir(parents=True)
        (self.web / "releases/r1/index.html").write_text("old app")
        (self.web / "assets").mkdir()
        (self.web / "assets/old.js").write_text("old script")
        self.nginx = self.root / "nginx.conf"
        self.nginx.write_text("old nginx")
        (self.data / "updates").mkdir()
        (self.data / "updates/latest.yml").write_text("existing installer manifest")
        (self.data / "database-proof").write_text("not changed")
        self.action = module.Retirement(self.data, self.nginx, ROOT / "ops")

    def tearDown(self):
        self.temporary.cleanup()

    def test_archive_cleanup_restore_round_trip_and_idempotence(self):
        original = module.inventory(self.web)
        backup = self.action.install()
        self.assertEqual(self.action.install(), backup)
        self.assertEqual(len(list(self.action.backups.iterdir())), 1)
        self.assertIn(b"kesaitong.top/#", self.nginx.read_bytes())
        self.assertTrue((self.data / "web-retired/sw.js").exists())
        self.action.cleanup(backup)
        self.assertFalse(self.web.exists())
        self.action.cleanup(backup)
        self.action.restore(backup)
        self.assertEqual(module.inventory(self.web), original)
        self.assertEqual(self.nginx.read_text(), "old nginx")
        self.assertFalse(self.action.marker.exists())
        self.assertEqual((self.data / "updates/latest.yml").read_text(), "existing installer manifest")
        self.assertEqual((self.data / "database-proof").read_text(), "not changed")

    def test_refuse_cleanup_if_web_changed(self):
        backup = self.action.install()
        (self.web / "assets/new.js").write_text("concurrent new file")
        with self.assertRaisesRegex(RuntimeError, "differs"):
            self.action.cleanup(backup)
        self.assertTrue(self.web.exists())

    def test_corrupt_backup_prevents_cleanup_and_restore(self):
        backup = self.action.install()
        archive = backup / "web.tar.gz"
        archive.write_bytes(archive.read_bytes() + b"corrupted")
        for operation in (self.action.cleanup, self.action.restore):
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                operation(backup)
        self.assertTrue(self.web.exists())

    def test_backup_must_belong_to_this_site(self):
        backup = self.action.install()
        manifest = backup / "manifest.json"
        content = json.loads(manifest.read_text())
        content["dataRoot"] = str(self.root)
        manifest.write_text(json.dumps(content))
        with self.assertRaisesRegex(RuntimeError, "different deployment"):
            self.action.restore(backup)

    def test_archive_rejects_traversal_and_escaped_links(self):
        for name, link in (("../secret", None), ("web/current", "/tmp/elsewhere"), ("web/assets/escape", "../releases")):
            archive = self.root / "unsafe.tar.gz"
            with tarfile.open(archive, "w:gz") as package:
                member = tarfile.TarInfo(name)
                if link:
                    member.type, member.linkname = tarfile.SYMTYPE, link
                else:
                    member.size = 4
                package.addfile(member, None if link else io.BytesIO(b"oops"))
            with self.assertRaises(RuntimeError):
                module.archive_inventory(archive, self.web)

    def test_config_write_failure_restores_only_frontend(self):
        real_write = module.atomic_write

        def fail_config(path, data, mode=0o600):
            if path == self.nginx and data != b"old nginx":
                raise OSError("simulated config write failure")
            return real_write(path, data, mode)

        with patch.object(module, "atomic_write", side_effect=fail_config):
            with self.assertRaisesRegex(OSError, "simulated"):
                self.action.install()
        self.assertEqual(self.nginx.read_text(), "old nginx")
        self.assertFalse(self.action.marker.exists())
        self.assertEqual((self.data / "database-proof").read_text(), "not changed")

    def test_linked_data_root_accepts_only_two_approved_roots(self):
        legacy = self.root / "amazon-toolbox"
        self.assertEqual(module.canonical_root(legacy, self.data), self.data)
        try:
            legacy.symlink_to(self.data, target_is_directory=True)
        except OSError:
            self.skipTest("Host does not allow symbolic links")
        self.assertEqual(module.canonical_root(legacy, self.data), self.data)
        legacy.unlink()
        legacy.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "Unexpected"):
            module.canonical_root(legacy, self.data)
        legacy.unlink()
        legacy.symlink_to(self.root / "missing", target_is_directory=True)
        with self.assertRaises(FileNotFoundError):
            module.canonical_root(legacy, self.data)

    def test_current_link_round_trip(self):
        try:
            (self.web / "current").symlink_to("releases/r1", target_is_directory=True)
        except OSError:
            self.skipTest("Host does not allow symbolic links")
        backup = self.action.install()
        self.action.cleanup(backup)
        self.action.restore(backup)
        self.assertEqual((self.web / "current/index.html").read_text(), "old app")

    def test_origin_validation_blocks_credentials_and_paths(self):
        self.assertEqual(module.validate_origin("https://example.test/"), "https://example.test")
        for value in ("http://example.test", "https://name:password@example.test", "https://example.test/api", "https://example.test?token=secret", "https://example.test/#hash"):
            with self.assertRaises(ValueError):
                module.validate_origin(value)

    def test_api_and_range_validation_detects_changed_services(self):
        def response(url, *, headers=None):
            if "/api/health/" in url:
                return 200, {}, b'{"status":"ok","version":"1.8.13"}'
            if url.endswith("latest.yml"):
                return 200, {}, b"version: 1.8.13\npath: KST Setup 1.8.13.exe\n"
            self.assertEqual(headers, {"Range": "bytes=0-0"})
            return 206, {"content-range": "bytes 0-0/100"}, b"M"

        with patch.object(module, "fetch", side_effect=response):
            result = module.service_snapshot("https://example.test")
            self.assertEqual(result["updates"]["range"], "bytes 0-0/100")
        with patch.object(module, "fetch", return_value=(200, {}, b'{"status":"failed"}')):
            with self.assertRaisesRegex(RuntimeError, "Service check"):
                module.service_snapshot("https://example.test")

    def test_reload_waits_for_old_workers_but_bounds_permanent_failure(self):
        baseline = {"version": "unchanged"}
        pending = module.RetirementRoutesPending("old nginx worker")
        with patch.object(module, "service_snapshot", return_value=baseline), patch.object(module, "verify_routes", side_effect=[pending, {"policy": "retired"}]), patch.object(module.time, "sleep") as sleep:
            self.assertEqual(module.verify_converged("https://example.test", baseline)["policy"], "retired")
            sleep.assert_called_once_with(0.5)
        with patch.object(module, "service_snapshot", return_value=baseline), patch.object(module, "verify_routes", side_effect=pending), patch.object(module.time, "monotonic", side_effect=[0, 0.5, 15]), patch.object(module.time, "sleep") as sleep:
            with self.assertRaises(module.RetirementRoutesPending):
                module.verify_converged("https://example.test", baseline)
            sleep.assert_called_once_with(0.5)

    def test_reload_never_retries_a_changed_backend_or_installer(self):
        with patch.object(module, "service_snapshot", return_value={"version": "changed"}), patch.object(module, "verify_routes") as routes, patch.object(module.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "changed during"):
                module.verify_converged("https://example.test", {"version": "original"})
            routes.assert_not_called()
            sleep.assert_not_called()

    def test_standalone_installs_restore_guard_and_rolls_it_back_explicitly(self):
        command = self.root / "toolbox-restore-backup"
        command.write_text("old restore program")
        action = module.Retirement(self.data, self.nginx, ROOT / "ops", command)
        backup = action.install()
        self.assertIn("web-retirement.json", command.read_text())
        self.assertIn("Keep this retirement-aware restore program", command.read_text())
        action.restore(backup)
        self.assertEqual(command.read_text(), "old restore program")


if __name__ == "__main__":
    unittest.main()
