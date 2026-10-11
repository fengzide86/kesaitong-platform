"""自动化工具版本、灰度选择与 Ed25519 清单签名。"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models import Setting

RELEASES_SETTING_KEY = "automation_tool_releases"


def canonical_manifest(manifest: dict[str, Any]) -> bytes:
    return json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_artifact(adapter: dict[str, Any]) -> bytes:
    """Return the exact bytes served to runners and covered by artifactSha256."""
    return json.dumps(adapter, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def validate_declarative_artifact(adapter: Any, script_key: str, version: str) -> dict[str, Any]:
    if not isinstance(adapter, dict):
        raise ValueError("adapter 必须是声明式 JSON 对象")
    if adapter.get("key") != script_key or adapter.get("version") != version:
        raise ValueError("adapter 的 key/version 必须与发布版本一致")
    if adapter.get("mode") != "workflow" or adapter.get("sandbox") is True:
        raise ValueError("远程 adapter 只能是非沙盒 workflow")
    if not isinstance(adapter.get("steps"), list) or not adapter["steps"]:
        raise ValueError("adapter 必须包含可执行步骤")
    if not isinstance(adapter.get("successChecks"), list) or not adapter["successChecks"]:
        raise ValueError("adapter 必须包含结果核验规则")
    return adapter


def sign_manifest(manifest: dict[str, Any], private_key_b64: str | None = None) -> str:
    encoded_key = private_key_b64 or settings.TOOL_SIGNING_PRIVATE_KEY_B64
    if not encoded_key:
        raise ValueError("TOOL_SIGNING_PRIVATE_KEY_B64 未配置")
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(encoded_key))
    return base64.b64encode(key.sign(canonical_manifest(manifest))).decode("ascii")


def verify_manifest_signature(manifest: dict[str, Any], signature_b64: str, public_key_b64: str) -> bool:
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        key.verify(base64.b64decode(signature_b64), canonical_manifest(manifest))
        return True
    except Exception:
        return False


def build_manifest(release: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "toolId": release["tool_id"],
        "version": release["version"],
        "scriptKey": release["script_key"],
        "runnerApiVersion": int(release.get("runner_api_version", 1)),
        "artifactSha256": release.get("artifact_sha256", "embedded"),
        "artifactUrl": release.get("artifact_url"),
    }


def version_key(version: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in version.split(".")[:3])
    except (TypeError, ValueError):
        return (0,)


def rollout_bucket(tool_id: str, version: str, subject: str) -> int:
    digest = hashlib.sha256(f"{tool_id}:{version}:{subject}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100


def resolve_release(releases: list[dict[str, Any]], tool_id: str, subject: str) -> dict[str, Any] | None:
    published = [r for r in releases if r.get("tool_id") == tool_id and r.get("status") == "published"]
    canaries = sorted(
        (r for r in published if r.get("channel") == "canary"),
        key=lambda item: version_key(item.get("version", "0")),
        reverse=True,
    )
    for release in canaries:
        rollout = min(max(int(release.get("rollout_percentage", 0)), 0), 100)
        if rollout_bucket(tool_id, release["version"], subject) < rollout:
            return release
    stable = sorted(
        (r for r in published if r.get("channel") == "stable"),
        key=lambda item: version_key(item.get("version", "0")),
        reverse=True,
    )
    return stable[0] if stable else None


def create_release(payload: dict[str, Any], private_key_b64: str | None = None) -> dict[str, Any]:
    adapter = payload.get("adapter")
    artifact_sha256 = payload.get("artifact_sha256", "embedded")
    if adapter is not None:
        adapter = validate_declarative_artifact(adapter, payload["script_key"], payload["version"])
        artifact_sha256 = hashlib.sha256(canonical_artifact(adapter)).hexdigest()
    release = {
        "tool_id": payload["tool_id"],
        "version": payload["version"],
        "script_key": payload["script_key"],
        "runner_api_version": int(payload.get("runner_api_version", 1)),
        "artifact_sha256": artifact_sha256,
        "artifact_url": payload.get("artifact_url"),
        "channel": payload.get("channel", "canary"),
        "rollout_percentage": int(payload.get("rollout_percentage", 0)),
        "status": payload.get("status", "draft"),
        "created_at": datetime.now(UTC).isoformat(),
    }
    if adapter is not None:
        release["adapter"] = adapter
    release["manifest"] = build_manifest(release)
    release["signature"] = sign_manifest(release["manifest"], private_key_b64)
    release["signing_key_id"] = settings.TOOL_SIGNING_KEY_ID
    return release


def rollback_releases(releases: list[dict[str, Any]], tool_id: str, target_version: str) -> list[dict[str, Any]]:
    target = next((r for r in releases if r.get("tool_id") == tool_id and r.get("version") == target_version), None)
    if not target:
        raise ValueError("目标回滚版本不存在")
    for release in releases:
        if release.get("tool_id") != tool_id:
            continue
        if release is target:
            release.update(channel="stable", status="published", rollout_percentage=100)
        elif release.get("channel") == "stable" and release.get("status") == "published":
            release["status"] = "retired"
    return releases


async def load_releases(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(select(Setting).where(Setting.key == RELEASES_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if not setting or not setting.value:
        return []
    try:
        data = json.loads(setting.value)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


async def save_releases(db: AsyncSession, releases: list[dict[str, Any]]) -> None:
    result = await db.execute(select(Setting).where(Setting.key == RELEASES_SETTING_KEY))
    setting = result.scalar_one_or_none()
    value = json.dumps(releases, ensure_ascii=False)
    if setting:
        setting.value = value
    else:
        db.add(Setting(key=RELEASES_SETTING_KEY, value=value, description="自动化工具签名版本清单"))
    await db.commit()


async def resolve_release_for_launch(db: AsyncSession, tool_id: str, subject: str) -> dict[str, Any] | None:
    return resolve_release(await load_releases(db), tool_id, subject)
