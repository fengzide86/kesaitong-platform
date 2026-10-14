"""Target registration is metadata only: never fetch user supplied URLs.

Each profile has its own Setting row. Reviews lock that row and also use an
optimistic value comparison, so SQLite and multi-worker SQL deployments reject
stale approvals instead of overwriting one another.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.config import settings
from models import Setting
from schemas.target_profiles import TargetProfile, TargetProfileReview, TargetProfileSubmission
from services.tool_release_service import sign_manifest, verify_manifest_signature

PROFILE_PREFIX = "target_profile:"
BINDING_PREFIX = "target_launch:"
TEMPLATE_CAPABILITY = "template.create.v1"
TEMPLATE_ADAPTER = "bjysoft-v2-template.1"


def fail(code: str, message: str, status: int = 409) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def sanitized_url(value: str) -> str:
    """Discard credentials, query and fragment before persistence or response."""
    if any(ord(char) < 32 for char in value) or "\\" in value:
        raise fail("TARGET_URL_INVALID", "入口必须为规范的 HTTP(S) 地址", 422)
    try:
        parts = urlsplit(value.strip())
        host = (parts.hostname or "").encode("idna").decode("ascii").lower()
        port = parts.port
        if parts.scheme not in {"http", "https"} or not host or "*" in host or host.endswith("."):
            raise ValueError
        try:
            address = ipaddress.ip_address(host)
            # Match the first desktop scope: public DNS/IPv4, not IPv6.
            if not address.is_global or address.version != 4:
                raise ValueError
        except ValueError:
            if ":" in host or re.fullmatch(r"[\d.]+", host) or host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local")):
                raise ValueError from None
            if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host) or "." not in host:
                raise ValueError from None
        authority = f"[{host}]" if ":" in host else host
        if port is not None and port != (443 if parts.scheme == "https" else 80):
            authority += f":{port}"
        path = safe_path(parts.path or "/")
        clean = urlunsplit((parts.scheme, authority, path, "", ""))
        if len(clean) > 2048:
            raise ValueError
        return clean
    except (ValueError, UnicodeError):
        raise fail("TARGET_URL_INVALID", "入口地址无效或指向本机/私有网络", 422) from None


def safe_path(value: str) -> str:
    # No encoded slash/dot ambiguity, user credentials or glob route patterns.
    if not value.startswith("/") or not re.fullmatch(r"/[A-Za-z0-9_./-]*", value) or "//" in value or any(part in {".", ".."} for part in value.split("/")):
        raise fail("TARGET_PATH_INVALID", "入口路径必须明确，不支持通配符、编码路径或相对路径", 422)
    return value


def normalized_routes(routes: list[dict[str, Any]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for route in routes:
        raw = str(route["origin"])
        clean = sanitized_url(raw)
        parts = urlsplit(raw)
        if parts.username or parts.password or parts.query or parts.fragment or parts.path not in {"", "/"}:
            raise fail("TARGET_ROUTE_INVALID", "路由 origin 只能包含协议、主机和端口", 422)
        origin = clean.rstrip("/")
        prefix = safe_path(str(route["pathPrefix"]))
        if prefix == "/":
            raise fail("TARGET_ROUTE_TOO_BROAD", "审核路由不能开放整个站点", 422)
        normalized = {"origin": origin, "pathPrefix": prefix, "role": route["role"]}
        if normalized not in result:
            result.append(normalized)
    return result


def route_matches(url: str, route: dict[str, str]) -> bool:
    parts = urlsplit(sanitized_url(url))
    prefix = route["pathPrefix"].rstrip("/")
    return f"{parts.scheme}://{parts.netloc}" == route["origin"] and (parts.path == prefix or parts.path.startswith(prefix + "/"))


def owner_key(user: dict[str, Any]) -> str:
    key = user.get("user_id") if user.get("role") == "user" else user.get("staff_id")
    if key is None:
        raise fail("TARGET_OWNER_REQUIRED", "请使用有效登录身份登记入口", 403)
    return f"{'user' if user.get('role') == 'user' else 'staff'}:{key}"


def _decode(setting: Setting) -> dict[str, Any]:
    try:
        stored = json.loads(setting.value or "")
        TargetProfile.model_validate(stored["profile"])
        return stored
    except (ValueError, TypeError, KeyError):
        raise fail("TARGET_PROFILE_CORRUPT", "入口登记数据损坏，需要管理员核对") from None


def _public(stored: dict[str, Any]) -> dict[str, Any]:
    return {key: stored.get(key) for key in ("profile", "signature", "signingKeyId")}


async def list_profiles(db: AsyncSession, user: dict[str, Any], *, admin: bool = False) -> list[dict[str, Any]]:
    rows = (await db.execute(select(Setting).where(Setting.key.startswith(PROFILE_PREFIX)).order_by(Setting.key))).scalars().all()
    owner = owner_key(user)
    return [_public(stored) for row in rows if (stored := _decode(row)) and (admin or stored.get("owner") == owner or stored["profile"]["reviewStatus"] == "approved")]


async def submit_profile(db: AsyncSession, payload: TargetProfileSubmission, user: dict[str, Any]) -> dict[str, Any]:
    owner = owner_key(user)
    clean = sanitized_url(payload.entryUrl)
    # One candidate per submitter and credential-free entry, including retries.
    identity = hashlib.sha256(f"{owner}\n{clean}".encode()).hexdigest()[:32]
    key = PROFILE_PREFIX + identity
    existing = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if existing:
        return _public(_decode(existing))
    evidence = payload.evidence.model_dump()
    # New optional fields must not alter the signed representation of old profiles.
    if evidence.get("pageFingerprints") is None:
        evidence.pop("pageFingerprints", None)
    evidence["source"] = "client-observed"
    profile = TargetProfile(id=identity, revision=1, name=payload.name.strip() or "未命名入口", providerId=payload.providerId,
                            productKey=payload.productKey, edition=payload.edition, entryUrl=clean, allowedRoutes=[],
                            reviewStatus="pending", capabilities=[], adapterVersion=None, evidence=evidence).model_dump()
    stored = {"profile": profile, "signature": None, "signingKeyId": None, "owner": owner}
    db.add(Setting(key=key, value=json.dumps(stored, ensure_ascii=False), description="待审核的平台入口，不含认证参数"))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
        if existing:
            return _public(_decode(existing))
        raise
    return _public(stored)


async def review_profile(db: AsyncSession, profile_id: str, payload: TargetProfileReview, actor: dict[str, Any], request: Request | None = None) -> dict[str, Any]:
    # SELECT FOR UPDATE alone is a no-op in SQLite. This also serializes tests
    # and local deployments before reading the revision, without process locks.
    await db.execute(update(Setting).where(Setting.key == PROFILE_PREFIX + profile_id).values(value=Setting.value))
    setting = (await db.execute(select(Setting).where(Setting.key == PROFILE_PREFIX + profile_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not setting:
        raise fail("TARGET_PROFILE_MISSING", "入口登记不存在", 404)
    stored = _decode(setting)
    before = stored["profile"]
    if before["revision"] != payload.revision:
        raise fail("TARGET_PROFILE_REVISION_CONFLICT", "入口已被其他管理员修改，请刷新后审核")
    if payload.reviewStatus == "approved":
        # The schema requires these values for approval; keep the explicit
        # guard here as a defensive boundary for callers constructing models
        # directly rather than through FastAPI validation.
        if payload.edition is None or payload.allowedRoutes is None or payload.capabilities is None or payload.evidence is None or payload.executionScopes is None:
            raise fail("TARGET_REVIEW_CONFIGURATION_REQUIRED", "批准入口必须提供完整配置", 422)
        changes = payload.model_dump(exclude={"revision"})
        changes["allowedRoutes"] = normalized_routes(changes["allowedRoutes"])
        if not any(route["role"] == "entry" and route_matches(before["entryUrl"], route) for route in changes["allowedRoutes"]):
            raise fail("TARGET_ENTRY_NOT_ALLOWED", "审核路由没有覆盖登记的入口")
        if payload.capabilities:
            markers = set(payload.evidence.markers)
            if payload.edition != "v2" or payload.evidence.edition != "v2" or payload.evidence.source != "admin-verified" or not payload.evidence.pageFingerprint or not {"amazon-v2", "seller-shipping-template"}.issubset(markers) or "amazon-v3" in markers or payload.adapterVersion != TEMPLATE_ADAPTER:
                raise fail("TARGET_EVIDENCE_REQUIRED", "只有经管理员核验的 V2 入口才能启用配送模板能力")
            if not any(route["role"] == "business" for route in changes["allowedRoutes"]):
                raise fail("TARGET_BUSINESS_ROUTE_REQUIRED", "启用工具必须登记明确的业务页面路由")
            fingerprints = payload.evidence.pageFingerprints
            if not fingerprints or not all((fingerprints.courseMap, fingerprints.templateList, fingerprints.templateEditor)):
                raise fail("TARGET_PAGE_EVIDENCE_REQUIRED", "启用模板创建需要课程地图、模板列表和编辑页分别核验的结构指纹")
            if not payload.executionScopes or len({scope.courseRef for scope in payload.executionScopes}) != len(payload.executionScopes):
                raise fail("TARGET_EXECUTION_SCOPE_REQUIRED", "请核验具体实训课程范围，不接受空范围或重复课程")
    else:
        # Rejection/disablement deliberately ignores all editable approval
        # fields.  The request may contain only revision + status, and the
        # last persisted profile remains the source of truth for its metadata.
        # Capabilities are revoked so no new execution can be granted.
        changes = {
            "reviewStatus": payload.reviewStatus,
            "capabilities": [],
            "adapterVersion": None,
            "executionScopes": [],
        }
    profile = TargetProfile.model_validate({**before, **changes, "revision": before["revision"] + 1}).model_dump()
    signature = None
    if payload.reviewStatus == "approved":
        try:
            signature = sign_manifest(profile)
            if not verify_manifest_signature(profile, signature, settings.TOOL_SIGNING_PUBLIC_KEY_B64):
                raise ValueError("signing key mismatch")
        except (ValueError, TypeError):
            raise fail("TARGET_SIGNING_UNAVAILABLE", "入口签名密钥不可用，未保存批准结果", 503) from None
    next_stored = {**stored, "profile": profile, "signature": signature, "signingKeyId": settings.TOOL_SIGNING_KEY_ID if signature else None}
    result = await db.execute(update(Setting).where(Setting.id == setting.id, Setting.value == setting.value).values(value=json.dumps(next_stored, ensure_ascii=False)).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await db.rollback()
        raise fail("TARGET_PROFILE_REVISION_CONFLICT", "入口已被其他管理员修改，请刷新后审核")
    await log_admin_action(db, user_id=actor.get("staff_id"), user_name=actor.get("username"), action="target_profile_review", target_type="target_profile", target_id=profile_id,
                           detail={"fromRevision": before["revision"], "toRevision": profile["revision"], "status": profile["reviewStatus"], "capabilities": profile["capabilities"]}, request=request)
    await db.commit()
    return _public(next_stored)


async def approved_profile(db: AsyncSession, profile_id: str, revision: int, capability: str) -> dict[str, Any]:
    setting = (await db.execute(select(Setting).where(Setting.key == PROFILE_PREFIX + profile_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not setting:
        raise fail("TARGET_PROFILE_MISSING", "选择的入口不存在")
    stored = _decode(setting)
    profile = stored["profile"]
    if profile["reviewStatus"] != "approved" or profile["revision"] != revision or capability not in profile["capabilities"] or not stored.get("signature"):
        raise fail("TARGET_PROFILE_NOT_APPROVED", "入口尚未获批、版本已变化或不支持当前能力，请重新核验")
    if capability == TEMPLATE_CAPABILITY and (profile["edition"] != "v2" or profile["adapterVersion"] != TEMPLATE_ADAPTER):
        raise fail("TARGET_ADAPTER_MISMATCH", "该入口不支持当前适配器")
    if capability == TEMPLATE_CAPABILITY and (not profile.get("executionScopes") or not all((profile.get("evidence", {}).get("pageFingerprints") or {}).get(key) for key in ("courseMap", "templateList", "templateEditor"))):
        raise fail("TARGET_REVIEW_UPGRADE_REQUIRED", "旧入口缺少课程范围或分页面证据，请重新审核后执行")
    if stored.get("signingKeyId") != settings.TOOL_SIGNING_KEY_ID or not verify_manifest_signature(profile, stored["signature"], settings.TOOL_SIGNING_PUBLIC_KEY_B64):
        raise fail("TARGET_SIGNATURE_INVALID", "入口签名无效或签名版本已变更，请重新审核")
    return _public(stored)


def binding_key(token: str) -> str:
    return BINDING_PREFIX + hashlib.sha256(token.encode()).hexdigest()


async def bind_launch(db: AsyncSession, token: str, binding: dict[str, Any]) -> None:
    key = binding_key(token)
    previous = (await db.execute(select(Setting).where(Setting.key == key).with_for_update())).scalar_one_or_none()
    encoded = json.dumps(binding, sort_keys=True, separators=(",", ":"))
    if previous:
        if previous.value != encoded:
            raise fail("TARGET_LAUNCH_CONFLICT", "已有启动授权绑定不同入口，请建立新尝试")
    else:
        db.add(Setting(key=key, value=encoded, description="启动授权的入口版本绑定，不含令牌或页面原文"))


async def read_launch_binding(db: AsyncSession, token: str) -> dict[str, Any] | None:
    row = (await db.execute(select(Setting).where(Setting.key == binding_key(token)).with_for_update())).scalar_one_or_none()
    return json.loads(row.value) if row else None
