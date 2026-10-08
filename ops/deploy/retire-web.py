#!/usr/bin/env python3
"""Retire only the public business Web; never stop the backend or touch a DB.

Run from an extracted repository ops/ tree, as root on the existing server:
  python3 ops/deploy/retire-web.py --control-plane-url https://HOST --dry-run
  python3 ops/deploy/retire-web.py --control-plane-url https://HOST --apply --cleanup
Rollback is explicit and frontend-only:
  ... --restore /var/lib/kesaitong-platform/.web-retirement-backups/ID --allow-web-restore
--install-policy is for deploy-backend.sh before its nginx test/reload. It backs
up the Web and installs the policy but does not reload or check a stopped API.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid


OFFICIAL_URL = "https://kesaitong.top/#"
MARKER_NAME = "web-retirement.json"
NAVIGATIONS = ("/", "/index.html", "/login?return_url=private#old", "/user/home", "/business/workspace", "/admin/users", "/agent", "/agency")
ASSETS = ("/assets/js/old.js", "/web-version.json", "/manifest.webmanifest", "/registerSW.js", "/workbox-old.js", "/pwa-192x192.png")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_root(legacy: Path, current: Path) -> Path:
    source = legacy if legacy.exists() or legacy.is_symlink() else current
    target = source.resolve(strict=True)
    if target not in (legacy, current) or not target.is_dir():
        raise RuntimeError(f"Unexpected deployment data root: {target}")
    return target


def direct_child(parent: Path, name: str) -> Path:
    candidate = parent / name
    if candidate.is_symlink() or candidate.resolve() != candidate:
        raise RuntimeError(f"Refusing linked or escaped target: {candidate}")
    return candidate


def atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    if path.is_symlink():
        raise RuntimeError(f"Refusing symbolic-link output: {path}")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".retire-write-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json(path: Path, value: dict) -> None:
    atomic_write(path, (json.dumps(value, indent=2, sort_keys=True) + "\n").encode())


def inventory(web: Path) -> list[dict]:
    """Allow only the existing current -> own release pointer, never traverse it."""
    if not web.exists():
        return []
    if web.is_symlink():
        raise RuntimeError("Web root must not be a symbolic link")
    entries = []
    for path in sorted([web, *web.rglob("*")]):
        name = path.relative_to(web.parent).as_posix()
        if path.is_symlink():
            destination = path.resolve(strict=True)
            releases = web / "releases"
            if path != web / "current" or releases not in destination.parents or not destination.is_dir():
                raise RuntimeError(f"Unexpected Web link: {path}")
            entries.append({"name": name, "type": "link", "target": os.readlink(path)})
        elif path.is_file():
            entries.append({"name": name, "type": "file", "sha256": file_sha(path), "size": path.stat().st_size})
        elif path.is_dir():
            entries.append({"name": name, "type": "directory"})
        else:
            raise RuntimeError(f"Unexpected Web filesystem object: {path}")
    return entries


def archive_inventory(archive: Path, web: Path) -> list[dict]:
    entries, names = [], set()
    with tarfile.open(archive, "r:gz") as package:
        for member in package.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or name.parts[:1] != ("web",) or member.name in names:
                raise RuntimeError(f"Unsafe archive entry: {member.name}")
            names.add(member.name)
            entry = {"name": member.name}
            if member.issym():
                destination = Path(member.linkname)
                if not destination.is_absolute():
                    destination = web / destination
                destination = destination.resolve(strict=False)
                if member.name != "web/current" or web / "releases" not in destination.parents:
                    raise RuntimeError("Archive contains an escaped symbolic link")
                entry.update(type="link", target=member.linkname)
            elif member.isfile():
                stream = package.extractfile(member)
                digest = hashlib.sha256()
                assert stream is not None
                with stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                entry.update(type="file", sha256=digest.hexdigest(), size=member.size)
            elif member.isdir():
                entry.update(type="directory")
            else:
                raise RuntimeError("Archive contains unsupported filesystem objects")
            entries.append(entry)
    # No file may be nested under any link, even one declared after the file.
    links = {item["name"] for item in entries if item["type"] == "link"}
    if any(any(parent.as_posix() in links for parent in PurePosixPath(item["name"]).parents) for item in entries):
        raise RuntimeError("Archive contains a file below a symlink")
    return sorted(entries, key=lambda item: item["name"])


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url: str, *, headers: dict | None = None) -> tuple[int, dict, bytes]:
    request = Request(url, headers=headers or {})
    try:
        response = build_opener(NoRedirect).open(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        return response.status, {key.lower(): value for key, value in response.headers.items()}, response.read(2 * 1024 * 1024)


def validate_origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Control plane must be an HTTPS origin without credentials, path or parameters")
    return value.rstrip("/")


def service_snapshot(origin: str) -> dict:
    result = {}
    for route in ("/api/health/live", "/api/health/ready"):
        status, _, body = fetch(origin + route)
        payload = json.loads(body)
        if status != 200 or payload.get("status") != "ok":
            raise RuntimeError(f"Service check failed: {route}, HTTP {status}")
        result[route] = {key: payload.get(key) for key in ("status", "version", "commit_sha", "release_id")}
    status, _, manifest = fetch(origin + "/updates/latest.yml")
    if status != 200:
        raise RuntimeError("Existing desktop update manifest is unavailable")
    match = re.search(r"^path:\s*['\"]?([^\r\n'\"]+\.exe)['\"]?\s*$", manifest.decode(), re.MULTILINE)
    if not match or "/" in match[1] or "\\" in match[1] or ".." in match[1]:
        raise RuntimeError("Update manifest does not identify a single installer filename")
    status, headers, body = fetch(origin + "/updates/" + quote(match[1]), headers={"Range": "bytes=0-0"})
    if status != 206 or len(body) != 1 or not headers.get("content-range", "").startswith("bytes 0-0/"):
        raise RuntimeError("Installer byte-range check failed")
    result["updates"] = {"manifestSha256": sha(manifest), "range": headers["content-range"]}
    return result


class RetirementRoutesPending(RuntimeError):
    pass


def verify_routes(origin: str) -> dict:
    probes = []
    for route in NAVIGATIONS:
        status, headers, _ = fetch(origin + route)
        if status != 302 or headers.get("location") != OFFICIAL_URL:
            raise RetirementRoutesPending(f"Legacy page is not retired: {route}, HTTP {status}")
        probes.append({"path": route, "status": status})
    for route in ASSETS:
        status, _, _ = fetch(origin + route)
        if status != 410:
            raise RetirementRoutesPending(f"Legacy static asset is not retired: {route}, HTTP {status}")
        probes.append({"path": route, "status": status})
    status, headers, body = fetch(origin + "/sw.js")
    if status != 200 or "javascript" not in headers.get("content-type", "") or "no-store" not in headers.get("cache-control", "") or b"self.registration.unregister()" not in body:
        raise RetirementRoutesPending("Retirement service worker check failed")
    return {"policy": "retired", "probes": probes, "serviceWorkerSha256": sha(body)}


def verify(origin: str, baseline: dict | None = None) -> dict:
    services = service_snapshot(origin)
    if baseline is not None and services != baseline:
        raise RuntimeError("Backend or desktop update changed during frontend-only retirement")
    return {**verify_routes(origin), "services": services}


def verify_converged(origin: str, baseline: dict, max_wait: float = 15) -> dict:
    # nginx reload is asynchronous: its old workers can briefly serve requests.
    # Retry only old Web responses. Changed API/update identity fails immediately.
    deadline = time.monotonic() + max_wait
    while True:
        services = service_snapshot(origin)
        if services != baseline:
            raise RuntimeError("Backend or desktop update changed during frontend-only retirement")
        try:
            return {**verify_routes(origin), "services": services}
        except RetirementRoutesPending:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)


class Retirement:
    def __init__(self, data_root: Path, nginx_file: Path, source_root: Path, restore_command: Path | None = None):
        self.data = data_root
        self.web = direct_child(data_root, "web")
        self.retired = direct_child(data_root, "web-retired")
        self.backups = direct_child(data_root, ".web-retirement-backups")
        self.marker = direct_child(data_root, MARKER_NAME)
        self.nginx_file = nginx_file
        self.nginx_target = nginx_file.resolve(strict=True)
        if not self.nginx_target.is_file():
            raise RuntimeError("Existing nginx site is not a regular file")
        self.config = (source_root / "nginx/amazon-toolbox.conf").read_bytes().replace(b"/var/lib/amazon-toolbox", str(data_root).encode())
        self.worker = (source_root / "web-retired/sw.js").read_bytes()
        self.restore_command = restore_command
        self.restore_script = (source_root / "deploy/restore-backup.sh").read_bytes()
        if restore_command is not None and restore_command.is_symlink():
            raise RuntimeError("Installed restore helper cannot be a symbolic link")

    def backup(self) -> Path:
        entries = inventory(self.web)
        self.backups.mkdir(mode=0o700, exist_ok=True)
        self.backups.chmod(0o700)
        directory = self.backups / (time.strftime("retire-%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid.uuid4().hex[:8])
        directory.mkdir(mode=0o700)
        archive = directory / "web.tar.gz"
        with tarfile.open(archive, "w:gz", dereference=False) as package:
            if self.web.exists():
                package.add(self.web, arcname="web")
        if archive_inventory(archive, self.web) != entries or inventory(self.web) != entries:
            raise RuntimeError("Web changed while archiving; no configuration switched")
        atomic_write(directory / "nginx.conf", self.nginx_target.read_bytes())
        manifest = {"schemaVersion": 1, "dataRoot": str(self.data), "nginxTarget": str(self.nginx_target), "nginxLink": os.readlink(self.nginx_file) if self.nginx_file.is_symlink() else None, "nginxSha256": file_sha(directory / "nginx.conf"), "archiveSha256": file_sha(archive), "entries": entries, "previousMarker": json.loads(self.marker.read_text()) if self.marker.exists() else None}
        if self.restore_command is not None:
            manifest["restoreCommand"] = str(self.restore_command)
            if self.restore_command.exists():
                atomic_write(directory / "restore-helper.sh", self.restore_command.read_bytes())
                manifest["restoreHelperSha256"] = file_sha(directory / "restore-helper.sh")
            else:
                manifest["restoreHelperSha256"] = None
        write_json(directory / "manifest.json", manifest)
        self.validate_backup(directory)
        return directory

    def validate_backup(self, directory: Path) -> dict:
        if directory.is_symlink():
            raise RuntimeError("Backup directory cannot be a symbolic link")
        directory = directory.resolve(strict=True)
        if directory.parent != self.backups or directory.is_symlink():
            raise RuntimeError("Backup must be a direct private retirement-backup child")
        metadata = json.loads((directory / "manifest.json").read_text())
        if metadata.get("schemaVersion") != 1 or metadata.get("dataRoot") != str(self.data) or metadata.get("nginxTarget") != str(self.nginx_target):
            raise RuntimeError("Backup belongs to a different deployment or nginx target")
        if file_sha(directory / "nginx.conf") != metadata["nginxSha256"] or file_sha(directory / "web.tar.gz") != metadata["archiveSha256"]:
            raise RuntimeError("Backup integrity check failed")
        if archive_inventory(directory / "web.tar.gz", self.web) != metadata["entries"]:
            raise RuntimeError("Backup inventory differs from verified manifest")
        if "restoreCommand" in metadata:
            if self.restore_command is None or metadata["restoreCommand"] != str(self.restore_command):
                raise RuntimeError("Backup restore helper target does not match")
            if metadata.get("restoreHelperSha256") and file_sha(directory / "restore-helper.sh") != metadata["restoreHelperSha256"]:
                raise RuntimeError("Restore helper backup integrity check failed")
        return metadata

    def install(self) -> Path:
        if self.marker.exists():
            state = json.loads(self.marker.read_text())
            if state.get("schemaVersion") != 1 or state.get("policy") != "retired":
                raise RuntimeError("Unrecognized retirement state; refusing overwrite")
            directory = Path(state["backupDir"])
            self.validate_backup(directory)
            restore_current = self.restore_command is None or (self.restore_command.is_file() and self.restore_command.read_bytes() == self.restore_script)
            if self.nginx_target.read_bytes() == self.config and (self.retired / "sw.js").is_file() and (self.retired / "sw.js").read_bytes() == self.worker and restore_current:
                return directory
            directory = self.backup()
        else:
            directory = self.backup()
        try:
            self.retired.mkdir(mode=0o755, exist_ok=True)
            self.retired.chmod(0o755)
            atomic_write(self.retired / "sw.js", self.worker, 0o644)
            atomic_write(self.retired / "nginx.conf", self.config, 0o644)
            if self.restore_command is not None:
                atomic_write(self.restore_command, self.restore_script, 0o750)
            # Durable policy comes first. Normal backend rollback preserves it.
            write_json(self.marker, {"schemaVersion": 1, "policy": "retired", "backupDir": str(directory), "configSha256": sha(self.config), "workerSha256": sha(self.worker)})
            atomic_write(self.nginx_target, self.config, 0o644)
        except BaseException:
            self.restore(directory)
            raise
        return directory

    def cleanup(self, directory: Path) -> None:
        metadata = self.validate_backup(directory)
        if not self.web.exists():
            return
        if inventory(self.web) != metadata["entries"]:
            raise RuntimeError("Web differs from its verified archive; refusing cleanup")
        # Exact resolved child was validated at construction and again just now.
        direct_child(self.data, "web")
        shutil.rmtree(self.web)

    def restore(self, directory: Path) -> None:
        metadata = self.validate_backup(directory)
        if self.web.exists() and inventory(self.web) != metadata["entries"]:
            raise RuntimeError("Current Web differs from archived state; refusing overwrite")
        if not self.web.exists() and metadata["entries"]:
            with tempfile.TemporaryDirectory(dir=self.data, prefix=".web-restore-") as temporary:
                root = Path(temporary)
                with tarfile.open(directory / "web.tar.gz", "r:gz") as package:
                    # archive_inventory has rejected links except web/current,
                    # traversal, hard links and any entries nested below links.
                    for member in package.getmembers():
                        target = root / member.name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if member.isdir():
                            target.mkdir(exist_ok=True)
                        elif member.issym():
                            target.symlink_to(member.linkname, target_is_directory=True)
                        else:
                            stream = package.extractfile(member)
                            assert stream is not None
                            with stream, target.open("wb") as output:
                                shutil.copyfileobj(stream, output)
                        if not member.issym():
                            target.chmod(member.mode)
                        if hasattr(os, "chown"):
                            os.chown(target, member.uid, member.gid, follow_symlinks=False)
                os.replace(root / "web", self.web)
        atomic_write(self.nginx_target, (directory / "nginx.conf").read_bytes(), 0o644)
        if "restoreCommand" in metadata:
            if metadata.get("restoreHelperSha256"):
                atomic_write(self.restore_command, (directory / "restore-helper.sh").read_bytes(), 0o750)
            else:
                self.restore_command.unlink(missing_ok=True)
        previous = metadata.get("previousMarker")
        if previous is None:
            self.marker.unlink(missing_ok=True)
        else:
            write_json(self.marker, previous)


def nginx_reload() -> None:
    subprocess.run(["nginx", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--control-plane-url", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--install-policy", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    mode.add_argument("--restore", type=Path)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--allow-web-restore", action="store_true")
    args = parser.parse_args()
    origin = validate_origin(args.control_plane_url)
    if args.verify_only:
        print(json.dumps(verify(origin), indent=2))
        return
    if args.cleanup and not args.apply:
        parser.error("--cleanup requires --apply")
    if args.restore and not args.allow_web_restore:
        parser.error("Frontend restoration reopens the old Web: --allow-web-restore is required")
    if os.name != "posix" or os.geteuid() != 0:
        parser.error("Server operations require Linux root; use --verify-only remotely")
    import fcntl
    data = canonical_root(Path("/var/lib/amazon-toolbox"), Path("/var/lib/kesaitong-platform"))
    nginx = Path("/etc/nginx/sites-enabled/amazon-toolbox")
    target = nginx.resolve(strict=True)
    if Path("/etc/nginx") not in target.parents:
        raise RuntimeError("nginx site resolves outside /etc/nginx")
    action = Retirement(data, nginx, Path(__file__).resolve().parent.parent, Path("/usr/local/sbin/toolbox-restore-backup"))
    if args.dry_run:
        entries = inventory(action.web)
        print(json.dumps({"dryRun": True, "dataRoot": str(data), "webRoot": str(action.web), "nginxTarget": str(target), "backupRoot": str(action.backups), "entryCount": len(entries), "bytes": sum(item.get("size", 0) for item in entries), "services": service_snapshot(origin)}, indent=2))
        return
    lock_file = direct_child(data, ".web-retirement.lock")
    with ExitStack() as stack:
        if not args.install_policy:
            # CLI deployments hold this exact guard for each remote mutation.
            # Standalone retirement must not race an active/interrupted release.
            release_control = direct_child(data, "release-control")
            release_control.mkdir(mode=0o700, exist_ok=True)
            production_guard = direct_child(release_control, "production.lease.guard")
            guard = stack.enter_context(production_guard.open("a"))
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            lease = release_control / "production.lease"
            if lease.exists() or lease.is_symlink():
                raise RuntimeError("A production release lease exists; finish/recover that release before retirement")
        lock = stack.enter_context(lock_file.open("a"))
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            baseline = service_snapshot(origin)
            action.restore(args.restore)
            nginx_reload()
            if service_snapshot(origin) != baseline:
                raise RuntimeError("Service changed during frontend restore")
            print(json.dumps({"restored": str(args.restore), "backendAndDatabaseUntouched": True}))
            return
        baseline = None if args.install_policy else service_snapshot(origin)
        previous_config = action.nginx_target.read_bytes()
        directory = action.install()
        if args.install_policy:
            print(json.dumps({"policy": "retired", "backupDir": str(directory), "reloadPending": True}))
            return
        try:
            nginx_reload()
            result = verify_converged(origin, baseline)
            write_json(directory / "acceptance.json", result)
            if args.cleanup:
                action.cleanup(directory)
                verify(origin, baseline)
        except BaseException:
            # An idempotent verification must never reopen a previously retired
            # Web merely because a dependency is temporarily unavailable.
            if previous_config != action.config:
                action.restore(directory)
                nginx_reload()
            raise
        print(json.dumps({**result, "backupDir": str(directory), "cleanupCompleted": args.cleanup}, indent=2))


if __name__ == "__main__":
    main()
