import base64
import hashlib
import io
import json
import os
import stat

import pytest
import yaml
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import domains.updates.service as service_module
import routers.updates as updates_module
from core.dependencies import require_super_admin
from domains.updates.service import UpdateReleaseService
from models import AuditLog, StaffRole
from routers.updates import router as updates_router


def upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(content))


def release_uploads(installer_name: str, installer: bytes, manifest: bytes) -> list[UploadFile]:
    return [
        upload(installer_name, installer),
        upload(f"{installer_name}.blockmap", b"blockmap-placeholder"),
        upload("latest.yml", manifest),
    ]


def test_legacy_direct_upload_route_is_not_registered():
    route_paths = {getattr(route, "path", None) for route in updates_router.routes}
    assert "/upload" not in route_paths


def test_release_mutations_explicitly_require_super_admin():
    mutation_paths = {
        "/releases/stage",
        "/releases/{version}/publish",
        "/releases/{version}/staged",
    }
    routes = {route.path: route for route in updates_router.routes if route.path in mutation_paths}
    assert routes.keys() == mutation_paths
    for route in routes.values():
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        assert require_super_admin in dependency_calls


@pytest.mark.asyncio
async def test_release_mutations_write_staff_and_request_id_audit(
    tmp_path,
    monkeypatch,
    client,
    auth_headers,
    staff_headers_factory,
    db_session,
):
    service = UpdateReleaseService(tmp_path / "updates")
    monkeypatch.setattr(updates_module, "release_service", service)

    async def stage(version: str, headers: dict[str, str]):
        installer = f"installer-{version}".encode()
        digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
        manifest = yaml.safe_dump({
            "version": version,
            "files": [{"url": f"setup-{version}.exe", "sha512": digest, "size": len(installer)}],
        }).encode()
        return await client.post(
            "/api/updates/releases/stage",
            data={"version": version},
            files=[
                ("files", (f"setup-{version}.exe", installer, "application/octet-stream")),
                (
                    "files",
                    (f"setup-{version}.exe.blockmap", b"blockmap", "application/octet-stream"),
                ),
                ("files", ("latest.yml", manifest, "application/yaml")),
            ],
            headers=headers,
        )

    operator_headers = await staff_headers_factory(StaffRole.OPERATOR, "updates-operator")
    assert (await stage("8.9.9", operator_headers)).status_code == 403

    assert (await stage("9.0.0", auth_headers)).status_code == 200
    assert (
        await client.post("/api/updates/releases/9.0.0/publish", headers=auth_headers)
    ).status_code == 200
    assert (await stage("9.0.1", auth_headers)).status_code == 200
    assert (
        await client.delete("/api/updates/releases/9.0.1/staged", headers=auth_headers)
    ).status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action.in_({
            "stage_update_release",
            "publish_update_release",
            "delete_staged_update_release",
        }))
    )
    logs = result.scalars().all()
    assert {log.action for log in logs} == {
        "stage_update_release",
        "publish_update_release",
        "delete_staged_update_release",
    }
    assert all(log.user_id and log.user_name for log in logs)
    audit_details = [json.loads(log.detail) for log in logs]
    assert all(detail["request_id"] for detail in audit_details)
    assert all({"role", "before", "after", "reason"}.issubset(detail) for detail in audit_details)
    assert all(detail["role"] == StaffRole.SUPER_ADMIN for detail in audit_details)
    assert all(detail["reason"] is None for detail in audit_details)


@pytest.mark.asyncio
async def test_staged_artifacts_are_outside_public_static_root(tmp_path):
    releases_dir = tmp_path / "updates"
    service = UpdateReleaseService(releases_dir)
    installer = b"private-staged-installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "7.0.0",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()
    await service.stage("7.0.0", release_uploads("setup.exe", installer, manifest))

    assert service.staging_dir == tmp_path / ".updates-staging"
    assert not (releases_dir / ".staging").exists()
    assert (service.staging_dir / "7.0.0" / "setup.exe").is_file()

    static_app = FastAPI()
    static_app.mount("/updates", StaticFiles(directory=releases_dir), name="updates")
    async with AsyncClient(transport=ASGITransport(app=static_app), base_url="http://test") as static_client:
        response = await static_client.get("/updates/.staging/7.0.0/setup.exe")
    assert response.status_code == 404


def test_legacy_public_staging_is_moved_before_static_mount(tmp_path):
    legacy = tmp_path / "updates" / ".staging" / "7.0.1"
    legacy.mkdir(parents=True)
    (legacy / "stage.json").write_text("{}", encoding="utf-8")

    service = UpdateReleaseService(tmp_path / "updates")

    assert not (tmp_path / "updates" / ".staging").exists()
    assert (service.staging_dir / "7.0.1" / "stage.json").is_file()


@pytest.mark.asyncio
async def test_stage_then_publish_places_manifest_last(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"signed-installer-placeholder"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.0",
        "files": [{"url": "AmazonToolbox Setup 1.8.0.exe", "sha512": digest, "size": len(installer)}],
        "path": "AmazonToolbox Setup 1.8.0.exe",
        "sha512": digest,
    }).encode()

    staged = await service.stage(
        "1.8.0",
        release_uploads("AmazonToolbox Setup 1.8.0.exe", installer, manifest),
    )
    assert staged["version"] == "1.8.0"
    assert staged["status"] == "staged"
    assert not (tmp_path / "updates" / "latest.yml").exists()

    published = service.publish("1.8.0")
    assert published["status"] == "published"
    assert (tmp_path / "updates" / "AmazonToolbox Setup 1.8.0.exe").read_bytes() == installer
    assert yaml.safe_load((tmp_path / "updates" / "latest.yml").read_text())["version"] == "1.8.0"


@pytest.mark.asyncio
async def test_republishing_identical_current_version_is_idempotent(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"same-installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.5",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()
    await service.stage("1.8.5", release_uploads("setup.exe", installer, manifest))

    first = service.publish("1.8.5")
    second = service.publish("1.8.5")

    assert second == first


@pytest.mark.asyncio
async def test_republishing_current_version_rejects_changed_online_file(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"same-installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.6",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()
    await service.stage("1.8.6", release_uploads("setup.exe", installer, manifest))
    service.publish("1.8.6")
    (tmp_path / "updates" / "setup.exe").write_bytes(b"different")

    with pytest.raises(HTTPException) as error:
        service.publish("1.8.6")
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_stage_rejects_manifest_hash_mismatch(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    manifest = yaml.safe_dump({
        "version": "1.8.0",
        "files": [{"url": "setup.exe", "sha512": "wrong", "size": 3}],
    }).encode()
    with pytest.raises(HTTPException) as error:
        await service.stage("1.8.0", release_uploads("setup.exe", b"abc", manifest))
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_stage_requires_blockmap(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.7",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()

    with pytest.raises(HTTPException) as error:
        await service.stage("1.8.7", [upload("setup.exe", installer), upload("latest.yml", manifest)])
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_stage_rejects_path_traversal(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    with pytest.raises(HTTPException):
        await service.stage("1.8.0", [upload("../setup.exe", b"abc")])


@pytest.mark.asyncio
async def test_stage_infers_version_from_manifest(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"unsigned-installer-is-supported"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.1",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()

    staged = await service.stage(None, release_uploads("setup.exe", installer, manifest))
    assert staged["version"] == "1.8.1"
    assert staged["staged_at"]


@pytest.mark.asyncio
async def test_publish_rejects_non_increasing_version(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")

    async def stage(version: str) -> None:
        installer = version.encode()
        digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
        manifest = yaml.safe_dump({
            "version": version,
            "files": [{"url": f"setup-{version}.exe", "sha512": digest, "size": len(installer)}],
        }).encode()
        await service.stage(
            version,
            release_uploads(f"setup-{version}.exe", installer, manifest),
        )

    await stage("1.8.0")
    service.publish("1.8.0")
    await stage("1.7.9")
    with pytest.raises(HTTPException) as error:
        service.publish("1.7.9")
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_publish_rehashes_staged_files_before_switching_manifest(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"original-installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.2",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()
    await service.stage("1.8.2", release_uploads("setup.exe", installer, manifest))

    (service.staging_dir / "1.8.2" / "setup.exe").write_bytes(b"tampered")

    with pytest.raises(HTTPException) as error:
        service.publish("1.8.2")
    assert error.value.status_code == 409
    assert not (tmp_path / "updates" / "latest.yml").exists()


@pytest.mark.asyncio
async def test_stage_rejects_overwriting_an_existing_version(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    installer = b"installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.3",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()
    await service.stage("1.8.3", release_uploads("setup.exe", installer, manifest))

    with pytest.raises(HTTPException) as error:
        await service.stage("1.8.3", release_uploads("setup.exe", installer, manifest))
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_publish_uses_a_cross_process_file_lock(tmp_path):
    first = UpdateReleaseService(tmp_path / "updates")
    second = UpdateReleaseService(tmp_path / "updates")
    installer = b"installer"
    digest = base64.b64encode(hashlib.sha512(installer).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": "1.8.4",
        "files": [{"url": "setup.exe", "sha512": digest, "size": len(installer)}],
    }).encode()
    await first.stage("1.8.4", release_uploads("setup.exe", installer, manifest))

    with first._file_lock(), pytest.raises(HTTPException) as error:
        second.publish("1.8.4")
    assert error.value.status_code == 409


async def stage_fixture_release(service, version, name, content):
    digest = base64.b64encode(hashlib.sha512(content).digest()).decode("ascii")
    manifest = yaml.safe_dump({
        "version": version,
        "files": [{"url": name, "sha512": digest, "size": len(content)}],
    }).encode()
    await service.stage(version, release_uploads(name, content, manifest))


@pytest.mark.asyncio
async def test_different_version_cannot_overwrite_old_installer(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    await stage_fixture_release(service, "2.0.0", "setup.exe", b"old")
    service.publish("2.0.0")
    previous = {p.name: p.read_bytes() for p in service.releases_dir.iterdir()}
    await stage_fixture_release(service, "2.0.1", "setup.exe", b"new")
    with pytest.raises(HTTPException) as error:
        service.publish("2.0.1")
    assert error.value.status_code == 409
    assert {p.name: p.read_bytes() for p in service.releases_dir.iterdir()} == previous


@pytest.mark.asyncio
async def test_interrupted_copy_preserves_old_release_and_retries(tmp_path, monkeypatch):
    import domains.updates.service as module
    service = UpdateReleaseService(tmp_path / "updates")
    await stage_fixture_release(service, "2.0.0", "setup-2.0.0.exe", b"old")
    service.publish("2.0.0")
    previous = {p.name: p.read_bytes() for p in service.releases_dir.iterdir()}
    await stage_fixture_release(service, "2.0.1", "setup-2.0.1.exe", b"new")
    copy = module.shutil.copy2
    def fail_blockmap(source, destination, *args, **kwargs):
        if str(source).endswith(".blockmap"):
            raise OSError("synthetic copy failure")
        return copy(source, destination, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(module.shutil, "copy2", fail_blockmap)
        with pytest.raises(OSError, match="synthetic"):
            service.publish("2.0.1")
    for name, content in previous.items():
        assert (service.releases_dir / name).read_bytes() == content
    assert not list(service.releases_dir.glob(".publishing-*"))
    assert service.publish("2.0.1")["status"] == "published"
    assert (service.releases_dir / "setup-2.0.1.exe").read_bytes() == b"new"
    # A later stage-file corruption must not mutate the published copy.
    (service.staging_dir / "2.0.1" / "setup-2.0.1.exe").write_bytes(b"changed")
    assert (service.releases_dir / "setup-2.0.1.exe").read_bytes() == b"new"


@pytest.mark.asyncio
async def test_public_permission_failure_keeps_previous_manifest(tmp_path, monkeypatch):
    service = UpdateReleaseService(tmp_path / "updates")
    await stage_fixture_release(service, "2.9.0", "setup-2.9.0.exe", b"previous")
    service.publish("2.9.0")
    previous_manifest = (service.releases_dir / "latest.yml").read_bytes()
    await stage_fixture_release(service, "3.0.0", "setup-3.0.0.exe", b"candidate")
    monkeypatch.setattr(service, "_prepare_public_file", lambda _path: (_ for _ in ()).throw(
        HTTPException(409, "synthetic public permission failure")
    ))

    with pytest.raises(HTTPException, match="synthetic public permission failure"):
        service.publish("3.0.0")
    assert (service.releases_dir / "latest.yml").read_bytes() == previous_manifest
    assert not list(service.releases_dir.glob(".latest.yml.tmp"))
    assert not list(service.releases_dir.glob(".publishing-*"))
    assert not list(service.staging_dir.glob(".publishing-*"))


@pytest.mark.skipif(os.name != "posix", reason="POSIX group ownership is not available on Windows")
@pytest.mark.asyncio
async def test_publishing_temp_inode_inherits_release_setgid(tmp_path):
    service = UpdateReleaseService(tmp_path / "updates")
    os.chmod(service.releases_dir, 0o2750)
    release_gid = service.releases_dir.stat().st_gid
    await stage_fixture_release(service, "3.1.0", "setup-3.1.0.exe", b"setgid-candidate")

    service.publish("3.1.0")

    for name in ("setup-3.1.0.exe", "setup-3.1.0.exe.blockmap", "latest.yml"):
        metadata = (service.releases_dir / name).stat()
        assert metadata.st_gid == release_gid
        assert stat.S_IMODE(metadata.st_mode) == 0o640


@pytest.mark.skipif(os.name != "posix", reason="POSIX group ownership is not available on Windows")
def test_public_file_is_repaired_to_release_group_and_mode(tmp_path):
    if os.geteuid() != 0:
        pytest.skip("changing a fixture file to a different gid requires root in CI")
    service = UpdateReleaseService(tmp_path / "updates")
    path = service.releases_dir / "setup.exe"
    path.write_bytes(b"complete")
    release_gid = service.releases_dir.stat().st_gid
    candidates = [gid for gid in os.getgroups() + [0] if gid != release_gid]
    if not candidates:
        pytest.skip("no alternate local gid available")
    old_gid = candidates[0]
    os.chown(path, -1, old_gid)
    os.chmod(path, 0o600)

    service._prepare_public_file(path)

    metadata = path.stat()
    assert metadata.st_gid == release_gid
    assert stat.S_IMODE(metadata.st_mode) == 0o640


@pytest.mark.skipif(os.name != "posix", reason="POSIX ownership APIs are not available on Windows")
def test_public_file_chown_error_is_reported(monkeypatch, tmp_path):
    if os.geteuid() != 0:
        pytest.skip("changing a fixture file to a different gid requires root in CI")
    service = UpdateReleaseService(tmp_path / "updates")
    path = service.releases_dir / "setup.exe"
    path.write_bytes(b"complete")
    release_gid = service.releases_dir.stat().st_gid
    candidates = [gid for gid in os.getgroups() + [0] if gid != release_gid]
    if not candidates:
        pytest.skip("no alternate local gid available")
    os.chown(path, -1, candidates[0])
    monkeypatch.setattr(service_module.os, "chown", lambda *_args: (_ for _ in ()).throw(PermissionError("synthetic chown")))

    with pytest.raises(HTTPException, match="组权限无法校正"):
        service._prepare_public_file(path)
