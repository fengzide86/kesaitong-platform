"""Versioned freight-rate packs with integrity manifests and rollback."""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models import Setting
from services.tool_release_service import canonical_manifest, sign_manifest

RATE_PACKS_SETTING_KEY = "freight_rate_pack_releases"


def canonical_pack(pack: dict[str, Any]) -> bytes:
    return json.dumps(pack, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def validate_rate_pack(pack: Any) -> dict[str, Any]:
    if not isinstance(pack, dict):
        raise ValueError("pack 必须是 JSON 对象")
    if pack.get("schemaVersion") != 1 or pack.get("resourceType") != "freight-rate-pack":
        raise ValueError("费率包 schemaVersion/resourceType 不受支持")
    if not pack.get("id") or not pack.get("version"):
        raise ValueError("费率包缺少 id/version")
    rules = pack.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValueError("费率包没有有效规则")
    exchange_rate = pack.get("exchangeRateCnyPerUsd")
    if not isinstance(exchange_rate, (int, float)) or exchange_rate <= 0:
        raise ValueError("费率包汇率无效")
    allowed_service_types = {"tiered", "epacket", "ups"}
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict) or rule.get("serviceType") not in allowed_service_types:
            raise ValueError(f"第 {index + 1} 条费率规则类型无效")
        if not rule.get("carrierId") or not rule.get("countryCode"):
            raise ValueError(f"第 {index + 1} 条费率规则缺少承运商或国家代码")
    return pack


def build_rate_manifest(pack: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "resourceType": "freight-rate-pack",
        "packId": pack["id"],
        "version": pack["version"],
        "artifactSha256": hashlib.sha256(canonical_pack(pack)).hexdigest(),
        "artifactUrl": f"/api/freight-rate-packs/{pack['id']}/{pack['version']}/artifact",
    }


def create_rate_draft(pack_input: Any, source_file_name: str | None = None) -> dict[str, Any]:
    pack = validate_rate_pack(pack_input)
    manifest = build_rate_manifest(pack)
    return {
        "pack_id": pack["id"],
        "version": pack["version"],
        "name": pack.get("name") or pack["id"],
        "status": "draft",
        "created_at": datetime.now(UTC).isoformat(),
        "source_file_name": source_file_name,
        "source_hash": pack.get("sourceHash"),
        "manifest": manifest,
        "signature": None,
        "signing_key_id": None,
        "pack": pack,
    }


def publish_rate_release(releases: list[dict[str, Any]], pack_id: str, version: str) -> dict[str, Any]:
    target = next((item for item in releases if item.get("pack_id") == pack_id and item.get("version") == version), None)
    if not target:
        raise ValueError("目标费率版本不存在")
    for release in releases:
        if release.get("pack_id") == pack_id and release.get("status") == "published":
            release["status"] = "retired"
    target["manifest"] = build_rate_manifest(validate_rate_pack(target["pack"]))
    target["signature"] = sign_manifest(target["manifest"])
    target["signing_key_id"] = settings.TOOL_SIGNING_KEY_ID
    target["status"] = "published"
    target["published_at"] = datetime.now(UTC).isoformat()
    return target


def rollback_rate_releases(releases: list[dict[str, Any]], pack_id: str, target_version: str) -> dict[str, Any]:
    return publish_rate_release(releases, pack_id, target_version)


def version_key(version: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in version.split(".")[:3])
    except (TypeError, ValueError):
        return (0,)


def current_rate_release(releases: list[dict[str, Any]], pack_id: str | None = None) -> dict[str, Any] | None:
    candidates = [
        item for item in releases
        if item.get("status") == "published" and (pack_id is None or item.get("pack_id") == pack_id)
    ]
    candidates.sort(key=lambda item: version_key(str(item.get("version", "0"))), reverse=True)
    return candidates[0] if candidates else None


async def load_rate_releases(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(select(Setting).where(Setting.key == RATE_PACKS_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if not setting or not setting.value:
        return []
    try:
        data = json.loads(setting.value)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


async def save_rate_releases(db: AsyncSession, releases: list[dict[str, Any]]) -> None:
    result = await db.execute(select(Setting).where(Setting.key == RATE_PACKS_SETTING_KEY))
    setting = result.scalar_one_or_none()
    value = json.dumps(releases, ensure_ascii=False)
    if setting:
        setting.value = value
    else:
        db.add(Setting(key=RATE_PACKS_SETTING_KEY, value=value, description="签名物流费率包版本"))
    await db.commit()


def public_release(release: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in release.items() if key != "pack"}


def manifest_bytes(release: dict[str, Any]) -> bytes:
    return canonical_manifest(release["manifest"])
