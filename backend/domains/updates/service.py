from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict, cast

import yaml
from fastapi import HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
ALLOWED_SUFFIXES = {".exe": 300 * 1024 * 1024, ".blockmap": 20 * 1024 * 1024, ".yml": 256 * 1024}


def get_update_releases_dir() -> Path:
    """Return the writable release directory shared with the HTTPS server."""
    configured = os.getenv("UPDATE_RELEASE_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(__file__).resolve().parents[2] / "updates").resolve()


class StagedFile(TypedDict):
    name: str
    size: int
    sha512: str


class UpdateReleaseService:
    def __init__(self, releases_dir: str | Path) -> None:
        self.releases_dir = Path(releases_dir).resolve()
        self.staging_dir = self.releases_dir.parent / ".updates-staging"
        self.releases_dir.mkdir(parents=True, exist_ok=True)
        if self.staging_dir.is_symlink():
            raise RuntimeError("更新暂存目录不能是符号链接")
        self._migrate_legacy_staging()
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        self._mutation_lock = threading.Lock()
        self._lock_path = self.staging_dir / ".release.lock"

    def _migrate_legacy_staging(self) -> None:
        legacy = self.releases_dir / ".staging"
        if not legacy.exists() and not legacy.is_symlink():
            return
        if legacy.is_symlink() or not legacy.is_dir():
            legacy.unlink()
            return
        if not self.staging_dir.exists():
            os.replace(legacy, self.staging_dir)
            return

        quarantine = self.releases_dir.parent / f".updates-staging-migrate-{uuid.uuid4().hex}"
        os.replace(legacy, quarantine)
        collisions: list[str] = []
        for entry in quarantine.iterdir():
            if entry.name == ".release.lock":
                entry.unlink(missing_ok=True)
                continue
            target = self.staging_dir / entry.name
            if target.exists():
                collisions.append(entry.name)
                continue
            os.replace(entry, target)
        if collisions:
            raise RuntimeError(
                "旧更新暂存目录已移出公开目录，但存在待人工处理的版本冲突：" + ", ".join(sorted(collisions))
            )
        quarantine.rmdir()

    async def stage(self, version: str | None, files: list[UploadFile]) -> dict[str, object]:
        if not files:
            raise HTTPException(400, "请选择需要暂存的更新文件")
        temp = (self.staging_dir / f".uploading-{uuid.uuid4().hex}").resolve()
        self._assert_within(temp, self.staging_dir)
        temp.mkdir(parents=True)

        staged: list[StagedFile] = []
        staged_names: set[str] = set()
        try:
            for upload in files:
                name = self._safe_name(upload.filename)
                if name.lower() in staged_names:
                    raise HTTPException(422, f"更新文件名重复：{name}")
                staged_names.add(name.lower())
                suffix = Path(name).suffix.lower()
                if suffix not in ALLOWED_SUFFIXES:
                    raise HTTPException(400, f"不支持的更新文件：{name}")
                output = temp / name
                size, sha512 = await self._stream_upload(upload, output, ALLOWED_SUFFIXES[suffix])
                staged.append({"name": name, "size": size, "sha512": sha512})

            manifest_path = next((temp / item["name"] for item in staged if item["name"].lower() == "latest.yml"), None)
            installer = next((item for item in staged if item["name"].lower().endswith(".exe")), None)
            blockmap = next((item for item in staged if item["name"].lower().endswith(".blockmap")), None)
            if not manifest_path or not installer or not blockmap:
                raise HTTPException(400, "暂存发布必须同时包含 latest.yml、Windows 安装包和 blockmap")
            inferred_version = self._manifest_version(manifest_path)
            if version and version != inferred_version:
                raise HTTPException(400, "提交版本与 latest.yml 版本不一致")
            resolved_version = version or inferred_version
            self._validate_version(resolved_version)
            target = (self.staging_dir / resolved_version).resolve()
            self._assert_within(target, self.staging_dir)
            manifest = self._validate_manifest(manifest_path, resolved_version, staged)
            metadata: dict[str, object] = {
                "version": resolved_version,
                "status": "staged",
                "files": staged,
                "manifest": manifest,
                "staged_at": datetime.now(UTC).isoformat(),
            }
            (temp / "stage.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            with self._mutation_lock, self._file_lock():
                if target.exists():
                    raise HTTPException(409, f"v{resolved_version} 已暂存，请先删除后再重新上传")
                os.replace(temp, target)
            return metadata
        except Exception:
            if temp.exists():
                shutil.rmtree(temp)
            raise

    def publish(self, version: str) -> dict[str, object]:
        with self._mutation_lock, self._file_lock():
            return self._publish_locked(version)

    def _publish_locked(self, version: str) -> dict[str, object]:
        self._validate_version(version)
        source = (self.staging_dir / version).resolve()
        self._assert_within(source, self.staging_dir)
        metadata_path = source / "stage.json"
        if not metadata_path.exists():
            raise HTTPException(404, "暂存版本不存在")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        files = metadata.get("files") or []
        if not isinstance(files, list):
            raise HTTPException(409, "暂存版本文件清单无效")
        manifest_name = next(
            (
                item.get("name")
                for item in files
                if isinstance(item, dict) and str(item.get("name") or "").lower() == "latest.yml"
            ),
            None,
        )
        if not manifest_name:
            raise HTTPException(409, "暂存版本缺少 latest.yml")
        # stage.json 只是暂存时的记录。发布前必须重新读取磁盘中的实物，
        # 防止暂存后损坏或被替换的文件进入线上更新源。
        verified_files = self._verify_staged_files(source, files)
        self._validate_manifest(source / manifest_name, version, verified_files)

        current_version = self._current_version()
        if current_version:
            version_key = self._semver_key(version)
            current_key = self._semver_key(current_version)
            if version_key < current_key:
                raise HTTPException(409, f"发布版本必须高于当前线上版本 v{current_version}")
            if version_key == current_key:
                if not self._published_files_match(verified_files, manifest_name):
                    raise HTTPException(409, f"v{version} 已发布，但线上文件与暂存内容不一致")
                published_path = source / "published.json"
                published = json.loads(published_path.read_text(encoding="utf-8")) if published_path.exists() else {}
                return {
                    "version": version,
                    "status": "published",
                    "files": verified_files,
                    "published_at": published.get("published_at"),
                    "is_latest": True,
                }

        # Published artifact names are immutable. Check every collision before
        # copying anything: switching latest.yml last cannot protect an older
        # manifest when a newer release overwrites the same installer name.
        for item in verified_files:
            if item["name"] == manifest_name:
                continue
            published_file = self.releases_dir / self._safe_name(item["name"])
            if published_file.exists() or published_file.is_symlink():
                if published_file.is_symlink() or not published_file.is_file():
                    raise HTTPException(409, "公开更新文件名已被占用")
                size, digest = self._hash_file(published_file)
                if size != item["size"] or digest != item["sha512"]:
                    raise HTTPException(409, "公开更新文件名已有不同内容，请使用带版本的新文件名")

        # Install complete files without replacing any existing public name.
        # A failed release can leave unreferenced immutable artifacts, but must
        # never damage the currently advertised release or expose partial bytes.
        for item in verified_files:
            name = self._safe_name(item["name"])
            if name == manifest_name:
                continue
            published_file = self.releases_dir / name
            if published_file.exists():
                continue
            descriptor, temporary_name = tempfile.mkstemp(prefix=".publishing-", dir=self.staging_dir)
            temporary = Path(temporary_name)
            os.close(descriptor)
            try:
                shutil.copy2(source / name, temporary)
                os.chmod(temporary, 0o640)
                with temporary.open("r+b") as prepared:
                    os.fsync(prepared.fileno())
                # Staging and public directories share a parent/filesystem.
                # link is atomic and fails, rather than overwriting a collision.
                os.link(temporary, published_file)
            finally:
                temporary.unlink(missing_ok=True)
        manifest_temp = self.releases_dir / ".latest.yml.tmp"
        shutil.copy2(source / manifest_name, manifest_temp)
        os.chmod(manifest_temp, 0o640)
        os.replace(manifest_temp, self.releases_dir / "latest.yml")
        published_at = datetime.now(UTC).isoformat()
        (source / "published.json").write_text(
            json.dumps({"version": version, "published_at": published_at}, ensure_ascii=False), encoding="utf-8"
        )
        return {
            "version": version,
            "status": "published",
            "files": verified_files,
            "published_at": published_at,
            "is_latest": True,
        }

    def list_releases(self) -> list[dict[str, object]]:
        releases: list[dict[str, object]] = []
        current_version = self._current_version()
        for entry in sorted(self.staging_dir.iterdir(), reverse=True):
            metadata_path = entry / "stage.json" if entry.is_dir() else None
            if not metadata_path or not metadata_path.exists():
                continue
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            published_path = entry / "published.json"
            metadata["status"] = "published" if published_path.exists() else "staged"
            metadata["is_latest"] = metadata.get("version") == current_version
            if published_path.exists():
                published = json.loads(published_path.read_text(encoding="utf-8"))
                metadata["published_at"] = published.get("published_at")
            releases.append(metadata)
        return releases

    def delete_staged(self, version: str) -> None:
        self._validate_version(version)
        target = (self.staging_dir / version).resolve()
        self._assert_within(target, self.staging_dir)
        with self._mutation_lock, self._file_lock():
            if not target.exists():
                raise HTTPException(404, "暂存版本不存在")
            if (target / "published.json").exists():
                raise HTTPException(409, "已发布版本不能删除")
            shutil.rmtree(target)

    async def stage_with_audit(
        self,
        db: AsyncSession,
        *,
        version: str | None,
        files: list[UploadFile],
        actor: dict[str, object],
        request: Request,
    ) -> dict[str, object]:
        release = await self.stage(version, files)
        await self._record_audit(
            db,
            actor=actor,
            action="stage_update_release",
            target_id=str(release["version"]),
            before=None,
            after=release,
            request=request,
        )
        await db.commit()
        return release

    async def publish_with_audit(
        self,
        db: AsyncSession,
        *,
        version: str,
        actor: dict[str, object],
        request: Request,
    ) -> dict[str, object]:
        before = self.find_release(version)
        release = self.publish(version)
        await self._record_audit(
            db,
            actor=actor,
            action="publish_update_release",
            target_id=version,
            before=before,
            after=release,
            request=request,
        )
        await db.commit()
        return release

    async def delete_staged_with_audit(
        self,
        db: AsyncSession,
        *,
        version: str,
        actor: dict[str, object],
        request: Request,
    ) -> None:
        before = self.find_release(version)
        self.delete_staged(version)
        await self._record_audit(
            db,
            actor=actor,
            action="delete_staged_update_release",
            target_id=version,
            before=before,
            after=None,
            request=request,
        )
        await db.commit()

    def find_release(self, version: str) -> dict[str, object] | None:
        return next(
            (release for release in self.list_releases() if release.get("version") == version),
            None,
        )

    @staticmethod
    def _release_snapshot(release: dict[str, object] | None) -> dict[str, object] | None:
        if release is None:
            return None
        return {
            "version": release.get("version"),
            "status": release.get("status"),
            "is_latest": release.get("is_latest"),
            "files": release.get("files", []),
        }

    async def _record_audit(
        self,
        db: AsyncSession,
        *,
        actor: dict[str, object],
        action: str,
        target_id: str,
        before: dict[str, object] | None,
        after: dict[str, object] | None,
        request: Request,
    ) -> None:
        await log_admin_action(
            db,
            user_id=cast(int | None, actor.get("staff_id")),
            user_name=cast(str | None, actor.get("username", "admin")),
            action=action,
            target_type="update_release",
            target_id=target_id,
            detail={
                "role": actor.get("role"),
                "before": self._release_snapshot(before),
                "after": self._release_snapshot(after),
                "reason": None,
            },
            request=request,
        )

    async def _stream_upload(self, upload: UploadFile, target: Path, limit: int) -> tuple[int, str]:
        digest = hashlib.sha512()
        size = 0
        with target.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    output.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(413, f"文件超过大小限制：{target.name}")
                digest.update(chunk)
                output.write(chunk)
        return size, base64.b64encode(digest.digest()).decode("ascii")

    def _verify_staged_files(self, source: Path, files: list[object]) -> list[StagedFile]:
        verified: list[StagedFile] = []
        seen: set[str] = set()
        for raw in files:
            if not isinstance(raw, dict):
                raise HTTPException(409, "暂存版本文件清单无效")
            name_value = raw.get("name")
            name = self._safe_name(name_value if isinstance(name_value, str) else None)
            if name.lower() in seen:
                raise HTTPException(409, f"暂存版本文件名重复：{name}")
            seen.add(name.lower())
            candidate = (source / name).resolve()
            self._assert_within(candidate, source)
            if not candidate.is_file():
                raise HTTPException(409, f"暂存文件不存在：{name}")
            size, sha512 = self._hash_file(candidate)
            try:
                expected_size = int(raw.get("size", -1))
            except (TypeError, ValueError):
                expected_size = -1
            if expected_size != size or raw.get("sha512") != sha512:
                raise HTTPException(409, f"暂存文件发布前校验失败：{name}")
            verified.append({"name": name, "size": size, "sha512": sha512})
        return verified

    @staticmethod
    def _hash_file(path: Path) -> tuple[int, str]:
        digest = hashlib.sha512()
        size = 0
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
        return size, base64.b64encode(digest.digest()).decode("ascii")

    def _published_files_match(self, files: list[StagedFile], manifest_name: str) -> bool:
        for item in files:
            published_name = "latest.yml" if item["name"] == manifest_name else item["name"]
            candidate = (self.releases_dir / published_name).resolve()
            self._assert_within(candidate, self.releases_dir)
            if not candidate.is_file():
                return False
            size, sha512 = self._hash_file(candidate)
            if size != item["size"] or sha512 != item["sha512"]:
                return False
        return True

    @contextmanager
    def _file_lock(self) -> Iterator[None]:
        descriptor = os.open(self._lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        acquired = False
        try:
            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"0")
            os.lseek(descriptor, 0, os.SEEK_SET)
            try:
                if os.name == "nt":
                    import msvcrt

                    msvcrt_api: Any = msvcrt
                    msvcrt_api.locking(descriptor, msvcrt_api.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)  # type: ignore[attr-defined]
                acquired = True
            except OSError as error:
                raise HTTPException(409, "更新发布正在处理中，请稍后重试") from error
            yield
        finally:
            if acquired:
                os.lseek(descriptor, 0, os.SEEK_SET)
                try:
                    if os.name == "nt":
                        import msvcrt

                        msvcrt_api = msvcrt
                        msvcrt_api.locking(descriptor, msvcrt_api.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(descriptor, fcntl.LOCK_UN)  # type: ignore[attr-defined]
                except OSError:
                    pass
            os.close(descriptor)

    def _validate_manifest(self, path: Path, version: str, files: list[StagedFile]) -> dict[str, object]:
        try:
            manifest = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, yaml.YAMLError) as error:
            raise HTTPException(400, "latest.yml 格式无效") from error
        if not isinstance(manifest, dict) or manifest.get("version") != version:
            raise HTTPException(400, "latest.yml 版本与暂存版本不一致")
        manifest_files = manifest.get("files")
        if not isinstance(manifest_files, list) or not manifest_files:
            raise HTTPException(400, "latest.yml 缺少文件清单")
        staged_by_name = {item["name"]: item for item in files}
        for item in manifest_files:
            if not isinstance(item, dict):
                raise HTTPException(400, "latest.yml 文件清单无效")
            name = self._safe_name(str(item.get("url") or ""))
            staged = staged_by_name.get(name)
            if not staged:
                raise HTTPException(400, f"latest.yml 引用了未暂存文件：{name}")
            if item.get("sha512") != staged["sha512"] or int(item.get("size") or -1) != staged["size"]:
                raise HTTPException(400, f"更新文件校验值不匹配：{name}")
        return manifest

    @staticmethod
    def _manifest_version(path: Path) -> str:
        try:
            manifest = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, yaml.YAMLError) as error:
            raise HTTPException(400, "latest.yml 格式无效") from error
        version = manifest.get("version") if isinstance(manifest, dict) else None
        if not isinstance(version, str):
            raise HTTPException(400, "latest.yml 缺少有效版本号")
        return version

    def _current_version(self) -> str | None:
        manifest_path = self.releases_dir / "latest.yml"
        if not manifest_path.exists():
            return None
        try:
            manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, yaml.YAMLError):
            return None
        version = manifest.get("version") if isinstance(manifest, dict) else None
        return version if isinstance(version, str) and SEMVER.fullmatch(version) else None

    @staticmethod
    def _semver_key(version: str) -> tuple[tuple[int, int, int], int, tuple[tuple[int, int | str], ...]]:
        core, _, prerelease = version.partition("-")
        major, minor, patch = (int(value) for value in core.split("."))
        if not prerelease:
            return (major, minor, patch), 1, ()
        identifiers: list[tuple[int, int | str]] = []
        for value in prerelease.split("."):
            identifiers.append((0, int(value)) if value.isdigit() else (1, value))
        return (major, minor, patch), 0, tuple(identifiers)

    @staticmethod
    def _validate_version(version: str) -> None:
        if not SEMVER.fullmatch(version):
            raise HTTPException(400, "版本号必须使用 SemVer")

    @staticmethod
    def _safe_name(filename: str | None) -> str:
        if not filename:
            raise HTTPException(400, "文件名不能为空")
        name = os.path.basename(filename)
        if name != filename or name in {".", ".."} or any(character in name for character in ("/", "\\", "\0")):
            raise HTTPException(400, "更新文件名不安全")
        return name

    @staticmethod
    def _assert_within(path: Path, parent: Path) -> None:
        if path == parent or parent not in path.parents:
            raise HTTPException(400, "更新文件路径不安全")
