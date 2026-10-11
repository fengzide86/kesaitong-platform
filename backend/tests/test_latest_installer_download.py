import base64
import hashlib
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

import routers.updates as updates_module
from domains.updates.download import MAX_MANIFEST_BYTES, published_installer_location
from domains.updates.service import UpdateReleaseService


def publish_fixture(directory: Path, name: str = "KST Setup 1.8.14.exe", version: str = "1.8.14"):
    directory.mkdir(exist_ok=True)
    (directory / name).write_bytes(b"fixture-installer")
    manifest = {"version": version, "path": name,
                "files": [{"url": name, "size": len(b"fixture-installer"),
                           "sha512": base64.b64encode(hashlib.sha512(b"fixture-installer").digest()).decode("ascii")}]}
    (directory / "latest.yml").write_text(yaml.safe_dump(manifest), encoding="utf-8")
    return manifest


def test_latest_location_tracks_only_published_manifest(tmp_path):
    directory = tmp_path / "updates"
    publish_fixture(directory)
    assert published_installer_location(directory) == "/updates/KST%20Setup%201.8.14.exe"
    staged = tmp_path / ".updates-staging"
    publish_fixture(staged, "KST Setup 9.9.9.exe", "9.9.9")
    assert "1.8.14" in published_installer_location(directory)
    publish_fixture(directory, "KST Setup 1.8.15.exe", "1.8.15")
    assert published_installer_location(directory) == "/updates/KST%20Setup%201.8.15.exe"


@pytest.mark.parametrize("name", ["../escape.exe", "https://evil.example/setup.exe", "nested/setup.exe",
                                "C:\\setup.exe", "setup%20name.exe", "latest.exe", ".secret.exe"])
def test_latest_rejects_unsafe_names_without_fallback(tmp_path, name):
    manifest = publish_fixture(tmp_path)
    manifest["path"] = name
    manifest["files"][0]["url"] = name
    (tmp_path / "latest.yml").write_text(yaml.safe_dump(manifest), encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        published_installer_location(tmp_path)
    assert caught.value.status_code == 503
    assert caught.value.headers["Cache-Control"].startswith("no-store")


@pytest.mark.parametrize("condition", ["missing", "malformed", "large", "bad_version", "missing_installer",
                                     "wrong_size", "path_mismatch", "multiple", "missing_files",
                                     "missing_hash", "invalid_hash", "wrong_version_filename"])
def test_latest_invalid_manifest_fails_closed(tmp_path, condition):
    manifest = publish_fixture(tmp_path)
    target = tmp_path / "latest.yml"
    if condition == "missing":
        target.unlink()
    elif condition == "malformed":
        target.write_text("files: [broken", encoding="utf-8")
    elif condition == "large":
        target.write_bytes(b"a" * (MAX_MANIFEST_BYTES + 1))
    elif condition == "missing_installer":
        (tmp_path / manifest["path"]).unlink()
    else:
        if condition == "bad_version":
            manifest["version"] = "not-a-version"
        elif condition == "wrong_size":
            manifest["files"][0]["size"] = 1
        elif condition == "path_mismatch":
            manifest["path"] = "another.exe"
        elif condition == "multiple":
            manifest["files"].append({"url": "another.exe", "size": 1})
        elif condition == "missing_hash":
            manifest["files"][0].pop("sha512")
        elif condition == "invalid_hash":
            manifest["files"][0]["sha512"] = "?" * 88
        elif condition == "wrong_version_filename":
            manifest["version"] = "1.8.99"
        else:
            manifest.pop("files")
        target.write_text(yaml.safe_dump(manifest), encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        published_installer_location(tmp_path)
    assert caught.value.status_code == 503


@pytest.mark.asyncio
async def test_public_get_head_redirect_to_existing_artifact(tmp_path, monkeypatch):
    from fastapi.staticfiles import StaticFiles

    service = UpdateReleaseService(tmp_path / "updates")
    publish_fixture(service.releases_dir)
    monkeypatch.setattr(updates_module, "release_service", service)
    app = FastAPI()
    app.include_router(updates_module.router, prefix="/api/updates")
    app.mount("/updates", StaticFiles(directory=service.releases_dir))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://local.test") as client:
        for method in ["GET", "HEAD"]:
            response = await client.request(method, "/api/updates/latest-installer")
            assert response.status_code == 302
            assert response.headers["location"] == "/updates/KST%20Setup%201.8.14.exe"
            assert "no-store" in response.headers["cache-control"]
        download = await client.get(response.headers["location"])
        assert download.status_code == 200
        assert download.content == b"fixture-installer"
