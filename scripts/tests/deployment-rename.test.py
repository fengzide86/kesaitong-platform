"""Exercise deployment path guards in an isolated Linux temp tree, never production.

Only function definitions and the restore preflight (before its first mutation)
are evaluated. All state-changing commands are tripwires; Python is a no-op fixture.
"""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DeploymentRenameTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kst-rename-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.app = self.base / "opt/kesaitong-platform"
        self.old = self.base / "opt/amazon-toolbox"
        self.data = self.base / "data"
        self.backup = self.app / "backups/pre-rename"
        (self.backup / "backend").mkdir(parents=True)
        self.data.mkdir()
        self.old.symlink_to(self.app, target_is_directory=True)
        self.venv = self.make_venv(self.app / "venvs/release")
        self.legacy = self.make_venv(self.app / "backend/.venv")
        for filename in ("package.json", "database.sql.gz", "backend.env"):
            (self.backup / filename).touch()
        self.metadata = self.backup / "current-venv.target"
        self.metadata.write_text(str(self.venv) + "\n")
        self.guard = self.base / "unexpected-mutation"
        self.bin = self.base / "bin"
        self.bin.mkdir()
        for name in ("systemctl", "rsync", "mysql", "nginx", "chown", "chmod", "cp", "mv", "rm", "tar"):
            stub = self.bin / name
            stub.write_text('#!/bin/sh\nprintf "%s\\n" "$0" >> "$GUARD_MARKER"\nexit 97\n')
            stub.chmod(0o755)

    def make_venv(self, directory):
        (directory / "bin").mkdir(parents=True)
        shutil.copyfile(shutil.which("true"), directory / "bin/python")
        (directory / "bin/python").chmod(0o755)
        return directory

    def run_bash(self, source, argument="", tripwires=True):
        env = dict(os.environ, GUARD_MARKER=str(self.guard))
        if tripwires:
            env["PATH"] = str(self.bin) + os.pathsep + env["PATH"]
        result = subprocess.run(
            ["bash", "-s", "--", str(argument)], input=source, text=True,
            capture_output=True, env=env, timeout=10, cwd=self.base,
        )
        self.assertFalse(self.guard.exists(), "Restore preflight attempted a mutation")
        return result

    def preflight(self, backup=None):
        source = (ROOT / "ops/deploy/restore-backup.sh").read_text()
        marker = "\nRESTORE_IN_PROGRESS=1\n"
        self.assertEqual(source.count(marker), 1)
        source = source.split(marker)[0]
        source = source.replace('APP_ROOT="/opt/kesaitong-platform"', f'APP_ROOT="{self.app}"')
        source = source.replace('DATA_ROOT="/var/lib/kesaitong-platform"', f'DATA_ROOT="{self.data}"')
        source = source.replace("ExecStart=/opt/", f"ExecStart={self.base}/opt/")
        source += '\nprintf "verified_target=%s\\n" "$RESTORE_VENV_DIR"\n'
        return self.run_bash(source, backup or self.backup)

    def assert_accepted(self, backup=None):
        result = self.preflight(backup)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def assert_rejected(self, backup=None):
        result = self.preflight(backup)
        self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_new_paths(self):
        self.assert_accepted()

    def test_old_backup_and_old_venv_pointer(self):
        self.metadata.write_text(str(self.old / "venvs/release") + "\n")
        result = self.assert_accepted(self.old / "backups/pre-rename")
        self.assertIn(f"verified_target={self.venv}", result.stdout)

    def test_old_service_without_pointer(self):
        self.metadata.unlink()
        (self.backup / "toolbox-backend.service").write_text(
            f"ExecStart={self.old}/backend/.venv/bin/python -m uvicorn\n"
        )
        self.assertIn(str(self.legacy), self.assert_accepted().stdout)

    def test_current_service_without_pointer_rejected(self):
        self.metadata.unlink()
        (self.backup / "toolbox-backend.service").write_text(
            f"ExecStart={self.old}/current-venv/bin/python -m uvicorn\n"
        )
        self.assert_rejected()

    def test_missing_pointer_marker_legacy_fallback(self):
        self.metadata.unlink()
        (self.backup / "current-venv.target.missing").touch()
        self.assertIn(str(self.legacy), self.assert_accepted().stdout)

    def test_outside_and_neighbor_prefix_rejected(self):
        for target in (self.base / "external", self.app / "venvs-other/release"):
            with self.subTest(target=target):
                self.make_venv(target)
                self.metadata.write_text(str(target) + "\n")
                self.assert_rejected()

    def test_venv_symlink_escape_rejected(self):
        outside = self.make_venv(self.base / "external")
        escape = self.app / "venvs/escape"
        escape.symlink_to(outside, target_is_directory=True)
        self.metadata.write_text(str(escape) + "\n")
        self.assert_rejected()

    def test_backup_symlink_escape_rejected(self):
        outside = self.base / "external-backup"
        shutil.copytree(self.backup, outside)
        escape = self.app / "backups/escape"
        escape.symlink_to(outside, target_is_directory=True)
        self.assert_rejected(escape)

    def test_missing_and_nonexecutable_venv_rejected(self):
        self.metadata.write_text(str(self.app / "venvs/missing") + "\n")
        self.assert_rejected()
        self.metadata.write_text(str(self.venv) + "\n")
        (self.venv / "bin/python").chmod(0o644)
        self.assert_rejected()

    def test_symlink_metadata_rejected(self):
        external = self.base / "pointer"
        self.metadata.rename(external)
        self.metadata.symlink_to(external)
        self.assert_rejected()

    def switch_source(self, name):
        source = (ROOT / "ops/deploy" / name).read_text()
        definitions = []
        for function in ("validate_venv_target", "atomic_switch_current_venv"):
            match = re.search(r"^" + function + r"\(\) \{\n.*?^\}", source, re.M | re.S)
            self.assertIsNotNone(match)
            definitions.append(match.group())
        setup = '\n'.join([
            'set -Eeuo pipefail', f'APP_ROOT="{self.app}"',
            f'VENV_ROOT="{self.app}/venvs"', f'LEGACY_VENV="{self.legacy}"',
            f'CURRENT_VENV="{self.app}/current-venv"', 'RELEASE_ID=test',
        ])
        return setup + '\n' + '\n'.join(definitions) + '\n'

    def test_both_switch_functions_resolve_old_alias(self):
        for name in ("deploy-backend.sh", "restore-backup.sh"):
            with self.subTest(script=name):
                result = self.run_bash(self.switch_source(name)
                    + f'atomic_switch_current_venv "{self.old}/venvs/release"\n', tripwires=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(os.readlink(self.app / "current-venv"), str(self.venv))

    def test_conditional_switch_rejects_escape_without_changing_pointer(self):
        outside = self.make_venv(self.base / "external")
        (self.app / "current-venv").symlink_to(self.venv)
        for name in ("deploy-backend.sh", "restore-backup.sh"):
            with self.subTest(script=name):
                result = self.run_bash(self.switch_source(name)
                    + f'if atomic_switch_current_venv "{outside}"; then exit 71; fi\n', tripwires=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(os.readlink(self.app / "current-venv"), str(self.venv))

    def test_conditional_switch_propagates_filesystem_failure(self):
        (self.app / "current-venv").symlink_to(self.legacy)
        for name in ("deploy-backend.sh", "restore-backup.sh"):
            for command in ("ln", "mv"):
                with self.subTest(script=name, command=command):
                    result = self.run_bash(self.switch_source(name)
                        + f'{command}() {{ return 42; }}\n'
                        + f'if atomic_switch_current_venv "{self.venv}"; then exit 71; fi\n', tripwires=False)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(os.readlink(self.app / "current-venv"), str(self.legacy))

    def test_shell_syntax(self):
        for name in ("deploy-backend.sh", "deploy-web.sh", "restore-backup.sh"):
            with self.subTest(script=name):
                result = subprocess.run(["bash", "-n"],
                    input=(ROOT / "ops/deploy" / name).read_text(),
                    text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
