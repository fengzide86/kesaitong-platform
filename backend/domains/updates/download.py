"""Read-only installer discovery from the atomically published update manifest."""
from __future__ import annotations

import base64
import binascii
import re
from pathlib import Path
from urllib.parse import quote

import yaml
from fastapi import HTTPException

MAX_MANIFEST_BYTES = 256 * 1024
VERSION = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail="当前正式安装包暂时不可用，请稍后重试或联系交付方。",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


def published_installer_location(releases_dir: Path) -> str:
    """Never inspect staging, guess versions, copy files, or choose an old fallback."""
    manifest_path = releases_dir / "latest.yml"
    try:
        if manifest_path.is_symlink() or not manifest_path.is_file():
            raise _unavailable()
        with manifest_path.open("rb") as source:
            content = source.read(MAX_MANIFEST_BYTES + 1)
        if len(content) > MAX_MANIFEST_BYTES:
            raise _unavailable()
        manifest = yaml.safe_load(content)
        if not isinstance(manifest, dict) or not VERSION.fullmatch(str(manifest.get("version", ""))):
            raise _unavailable()
        files = manifest.get("files")
        if not isinstance(files, list) or not files:
            raise _unavailable()
        installers = [entry for entry in files if isinstance(entry, dict)
                      and isinstance(entry.get("url"), str) and entry["url"].lower().endswith(".exe")]
        if len(installers) != 1:
            raise _unavailable()
        entry = installers[0]
        name = entry["url"]
        if (name != manifest.get("path", name) or not name.strip()
                or name.lower() == "latest.exe" or name.startswith(".") or ".." in name
                or any(character in name for character in "/\\:%?#\x00\r\n")
                or any(ord(character) < 32 for character in name)):
            raise _unavailable()
        if not name.lower().endswith(str(manifest["version"]).lower() + ".exe"):
            raise _unavailable()
        digest = entry.get("sha512")
        if not isinstance(digest, str) or len(digest) != 88:
            raise _unavailable()
        try:
            if len(base64.b64decode(digest, validate=True)) != 64:
                raise _unavailable()
        except (binascii.Error, ValueError) as error:
            raise _unavailable() from error
        installer = releases_dir / name
        if installer.is_symlink() or not installer.is_file():
            raise _unavailable()
        if installer.resolve().parent != releases_dir.resolve():
            raise _unavailable()
        size = entry.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or size <= 0 or installer.stat().st_size != size:
            raise _unavailable()
        return "/updates/" + quote(name, safe="")
    except HTTPException:
        raise
    except (OSError, ValueError, yaml.YAMLError) as error:
        raise _unavailable() from error
