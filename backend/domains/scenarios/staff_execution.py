"""Staff-only one-use tool grants; never attach a customer/code/B-plan identity."""

import json
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from domains.catalog import normalize_tool_config, resolve_tool_runtime
from domains.scenarios.service import staff_policy, utc_naive
from models import Setting, StaffStatus, StaffUser
from models.scenario import StaffRuntimePermission, StaffToolGrant
from schemas.scenario import StaffToolGrantRequest, exact_origin
from services import target_profile_service
from services.tool_release_service import build_manifest, resolve_release_for_launch, sign_manifest


async def _permission(db: AsyncSession, staff_id: int) -> StaffRuntimePermission:
    permission = (await db.execute(select(StaffRuntimePermission).where(StaffRuntimePermission.staff_id == staff_id)
                                  .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not permission or not permission.enabled or utc_naive(permission.expires_at) <= datetime.now(UTC).replace(tzinfo=None):
        raise HTTPException(403, "管理员独立运行权限不存在、到期或已撤回")
    return permission


async def _tool(db: AsyncSession, tool_id: str) -> dict:
    setting = (await db.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one_or_none()
    try:
        tools = json.loads(setting.value) if setting and setting.value else []
        raw = next((tool for tool in tools if str(tool.get("id")) == tool_id), None)
    except (ValueError, TypeError, AttributeError):
        raw = None
    if not raw:
        raise HTTPException(404, "工具不存在")
    tool = normalize_tool_config(raw)
    if (tool.get("availability") not in {"live", "live_beta"} or tool.get("script_status") != "script_ready"
            or tool.get("release_status", "available") not in {"available", "beta"}):
        raise HTTPException(403, "该工具尚未开放真实运行")
    return tool


async def issue(db: AsyncSession, actor: dict, req: StaffToolGrantRequest) -> dict:
    if settings.TOOL_EXECUTION_MODE != "live":
        raise HTTPException(409, "当前未开放真实执行，不可使用管理员权限绕过")
    staff_id = actor["user_id"]
    permission = await _permission(db, staff_id)
    await staff_policy(db, actor)
    tool = await _tool(db, req.tool_id)
    capability = target_profile_service.TEMPLATE_CAPABILITY
    if capability not in (permission.allowed_capabilities or []) or tool.get("target_capability") != capability:
        raise HTTPException(403, "该管理员未获当前已审核工具的独立执行权限")
    signed = await target_profile_service.approved_profile(db, req.target_profile_id, req.target_profile_revision, capability)
    profile = signed["profile"]
    origin = exact_origin(profile["entryUrl"])
    if origin not in permission.allowed_origins or any(route["origin"] not in permission.allowed_origins for route in profile["allowedRoutes"]):
        raise HTTPException(403, "工具全部站点路径必须属于管理员已批准的 origin")
    if profile.get("productKey") != "amazon" or profile.get("edition") != "v2" or not profile.get("executionScopes"):
        raise HTTPException(403, "本工具仅允许已审核的 V2 实训现场")
    script_key, _ = resolve_tool_runtime(tool, "amazon")
    release = await resolve_release_for_launch(db, req.tool_id, f"staff:{staff_id}:{req.device_id}", 2)
    manifest = release["manifest"] if release else build_manifest({"tool_id": req.tool_id, "version": tool.get("tool_version", "1.0.0"),
                "script_key": script_key, "runner_api_version": int(tool.get("runner_api_version", 1)), "artifact_sha256": "embedded"})
    if manifest.get("runnerApiVersion") != 2:
        raise HTTPException(403, "管理员执行只支持经过审查的目标运行器协议 2")
    manifest = {**manifest, "schemaVersion": 2, "targetProfileId": req.target_profile_id,
                "targetProfileRevision": req.target_profile_revision, "requiredCapability": capability}
    try:
        signature = sign_manifest(manifest)
    except (TypeError, ValueError) as exc:
        raise HTTPException(503, "工具签名不可用，未授予启动权限") from exc
    token = "staff-tool." + secrets.token_urlsafe(32)
    expiry = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
    db.add(StaffToolGrant(token_hash=sha256(token.encode()).hexdigest(), staff_id=staff_id,
                         staff_token_version=actor["token_version"], policy_revision=permission.revision,
                         device_id=req.device_id, account_slot=req.account_slot, attempt_id=req.attempt_id,
                         tool_id=req.tool_id, target_profile_id=req.target_profile_id, target_profile_revision=req.target_profile_revision,
                         site_origin=origin, capability=capability, context_hash=req.context_hash, input_hash=req.input_hash,
                         status="pending", expires_at=expiry))
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "该管理员计划已有启动尝试，请检查原记录，不得重复执行") from exc
    return {"launch_data": {"token": token, "tool_id": req.tool_id, "platform_key": "amazon", "script_key": manifest["scriptKey"],
            "tool_version": manifest["version"], "runner_api_version": 2, "signature_required": True,
            "tool_signature": signature, "signing_key_id": settings.TOOL_SIGNING_KEY_ID, "tool_manifest": manifest,
            "target_profile": signed, "expires_at": expiry.isoformat() + "Z"}}


async def consume(db: AsyncSession, actor: dict, token: str) -> dict:
    permission = await _permission(db, actor["user_id"])
    row = (await db.execute(select(StaffToolGrant).where(StaffToolGrant.token_hash == sha256(token.encode()).hexdigest())
                           .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    staff = await db.get(StaffUser, actor["user_id"])
    if not row or row.staff_id != actor["user_id"] or row.staff_token_version != actor["token_version"]:
        raise HTTPException(403, "启动授权不属于当前管理员会话")
    if not staff or staff.status != StaffStatus.ACTIVE or staff.token_version != row.staff_token_version:
        raise HTTPException(403, "管理员账号已停用或凭证已变化")
    if row.status != "pending" or utc_naive(row.expires_at) <= datetime.now(UTC).replace(tzinfo=None):
        raise HTTPException(409, "启动授权已消费或过期")
    if row.policy_revision != permission.revision or row.site_origin not in permission.allowed_origins or row.capability not in permission.allowed_capabilities:
        raise HTTPException(403, "管理员独立权限已经变化")
    if settings.TOOL_EXECUTION_MODE != "live":
        raise HTTPException(409, "真实执行已经停用")
    tool = await _tool(db, row.tool_id)
    if tool.get("target_capability") != row.capability:
        raise HTTPException(403, "工具能力已经变化")
    signed = await target_profile_service.approved_profile(db, row.target_profile_id, row.target_profile_revision, row.capability)
    if exact_origin(signed["profile"]["entryUrl"]) != row.site_origin:
        raise HTTPException(403, "目标站点已经变化")
    row.status = "used"
    row.used_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()
    return {"valid": True, "principal_kind": "staff", "staff_id": row.staff_id, "device_id": row.device_id,
            "account_slot": row.account_slot, "context_hash": row.context_hash, "input_hash": row.input_hash,
            "tool_id": row.tool_id, "platform_key": "amazon", "target_profile_id": row.target_profile_id,
            "target_profile_revision": row.target_profile_revision, "required_capability": row.capability}


async def report(db: AsyncSession, receipt: dict) -> dict:
    token = receipt["token"]
    row = (await db.execute(select(StaffToolGrant).where(StaffToolGrant.token_hash == sha256(token.encode()).hexdigest())
                           .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not row or row.status not in {"used", "reported"}:
        raise HTTPException(403, "缺少本次已消费的管理员执行授权")
    safe = {key: value for key, value in receipt.items() if key != "token"}
    if row.status == "reported":
        original = {key: value for key, value in (row.report or {}).items() if key != "reconciliation"}
        if original != safe:
            raise HTTPException(409, "回执与原记录不一致，不能覆盖")
        return {"execution_id": row.id, "duplicate": True}
    row.report = safe
    row.status = "reported"
    await db.commit()
    return {"execution_id": row.id, "duplicate": False}


async def reconcile(db: AsyncSession, actor: dict, evidence: dict) -> dict:
    """Append same-object evidence to the owned staff receipt, not customer logs."""
    rows = list((await db.execute(select(StaffToolGrant).where(
        StaffToolGrant.staff_id == actor["user_id"], StaffToolGrant.device_id == evidence["device_id"],
        StaffToolGrant.account_slot == evidence["account_slot"], StaffToolGrant.context_hash == evidence["context_hash"],
        StaffToolGrant.input_hash == evidence["input_hash"], StaffToolGrant.status == "reported",
        StaffToolGrant.report["run_id"].as_string() == evidence["run_id"],
    ).with_for_update().execution_options(populate_existing=True))).scalars())
    if len(rows) != 1:
        raise HTTPException(404, "原管理员账号、设备及现场的执行记录不存在")
    row = rows[0]
    if not row.used_at or not row.report:
        raise HTTPException(409, "原记录不是已消费的真实执行")
    previous = row.report.get("reconciliation")
    if previous and previous != evidence:
        raise HTTPException(409, "核对证据与已记录结果不同，不能覆盖历史")
    if previous or row.report.get("status") == "succeeded":
        return {"accepted": True, "duplicate": True, "reconciled": True, "execution_id": row.id}
    # Keep the initial failed/unknown report byte-for-byte in its original
    # fields; the append-only supplement records the later successful readback.
    row.report = {**row.report, "reconciliation": evidence}
    await db.commit()
    return {"accepted": True, "duplicate": False, "reconciled": True, "execution_id": row.id}
