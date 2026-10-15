"""One-time launch-grant validation and state transitions."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import get_logger
from core.response import ErrorCodes, error_response, success_response
from domains.access import effective_license_status, lock_auth_code, resolve_plan_code, resolve_product_access
from domains.catalog import normalize_tool_config, resolve_tool_runtime
from domains.commercial import (
    CAPABILITY_ALIASES,
    TRIAL_CAPABILITIES,
    CommercialService,
    assert_commercial_tool_access,
    trial_operation_id,
)
from domains.scenarios import assert_customer_access, assert_project_scope
from models import AuthSeat, AutomationBatch, Device, LaunchToken, Plan, Setting, User
from models.commercial import CommercialGrant, TrialReservation
from schemas.scenario import exact_origin
from services import target_profile_service
from services.tool_release_service import build_manifest, resolve_release_for_launch, sign_manifest

logger = get_logger(__name__)


async def _assert_runtime_scope(db: AsyncSession, user_id: int, auth_code_id: int, tool: dict,
                                target_url: str, signed_target: dict | None, course_ref: str | None) -> CommercialGrant | None:
    policy = await assert_customer_access(db, user_id, target_url)
    # Existing executors have independently verified training scopes only.
    # Admin assigning competition never makes those legacy adapters competition-capable.
    if policy["mode"] == "competition":
        raise HTTPException(403, "当前比赛动作尚未验收，不能使用旧实训执行器")
    capability = str(tool.get("capability_key") or tool.get("target_capability") or "")
    commercial = await assert_commercial_tool_access(db, auth_code_id, capability, site_origin=exact_origin(target_url))
    if commercial is None:
        return None
    snapshot = json.loads(commercial.snapshot)
    mode = snapshot["scene_type"]
    if mode != policy["mode"] or not signed_target:
        raise HTTPException(403, "约定项目与管理员场景或已审核入口不匹配")
    scopes = signed_target["profile"].get("executionScopes", [])
    if not course_ref or not any(scope.get("courseRef") == course_ref and scope.get("scenario") == mode and scope.get("source") == "admin-verified" for scope in scopes):
        raise HTTPException(403, "当前课程不在入口已审核的场景范围内")
    await assert_project_scope(db, commercial.project_id, commercial.site_origin, mode, course_ref)
    return commercial


async def _release_unconsumed_trial(db: AsyncSession, launch: LaunchToken) -> None:
    """Only durable server proof of *no consume* can return a reserved quota."""
    if launch.used_at is not None or launch.status not in {"pending", "revoked", "expired"}:
        return
    if launch.status == "pending" and launch.expires_at > datetime.now():
        return
    operation_id = trial_operation_id(launch.token)
    reservation = await db.scalar(select(TrialReservation).where(TrialReservation.operation_id == operation_id))
    if reservation and reservation.status == "reserved":
        await CommercialService(db).finish_trial(operation_id, "not_submitted", f"launch-unconsumed:{launch.id}")
    if launch.status == "pending":
        launch.status = "expired"


async def _commit_or_rollback(db: AsyncSession) -> None:
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise


async def _error(
    db: AsyncSession,
    message: str,
    error_code: int,
    detail: Any = None,
) -> dict[str, Any]:
    await db.rollback()
    return error_response(message, error_code, detail)


async def _device_is_authorized(db: AsyncSession, auth_code_id: int, user_id: int | None, device_id: str | None) -> bool:
    if not user_id or not device_id:
        return False
    user = (await db.execute(select(User).where(
        User.id == user_id, User.auth_code_id == auth_code_id, User.is_active.is_(True),
    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    seat = await db.scalar(select(AuthSeat.id).where(
        AuthSeat.auth_code_id == auth_code_id, AuthSeat.user_id == user_id,
        AuthSeat.device_id == device_id, AuthSeat.status == "active",
    ).with_for_update())
    device = await db.scalar(select(Device.id).where(
        Device.auth_code_id == auth_code_id, Device.device_id == device_id,
    ).with_for_update())
    return user is not None and seat is not None and device is not None


async def create_launch_grant(
    db: AsyncSession,
    *,
    tool_id: str,
    platform_key: str,
    execution_mode: str,
    client_batch_id: str | None,
    client_item_id: str | None,
    idempotency_key: str | None,
    current_user: dict[str, Any],
    target_profile_id: str | None = None,
    target_profile_revision: int | None = None,
    client_runner_api_version: int = 1,
    course_ref: str | None = None,
) -> dict[str, Any]:
    """Validate access and create or reuse one short-lived launch grant."""
    if settings.TOOL_EXECUTION_MODE != "live":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "FEATURE_DISABLED",
                "message": "当前为演示模式，真实工具尚未接入",
                "reason": "demo_only",
            },
        )

    user_id = current_user.get("user_id")
    auth_code_id = current_user.get("auth_code_id")
    device_id = current_user.get("device_id")
    if not auth_code_id or not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        return await _error(db, "未找到授权信息", ErrorCodes.UNAUTHORIZED)

    auth_code = await lock_auth_code(db, auth_code_id)
    if not auth_code:
        return await _error(db, "授权码不存在", ErrorCodes.AUTH_CODE_INVALID)
    license_status = effective_license_status(auth_code)
    if license_status == "expired":
        return await _error(db, "授权码已过期", ErrorCodes.AUTH_CODE_EXPIRED)
    if license_status != "active":
        return await _error(db, "授权码状态异常", ErrorCodes.AUTH_CODE_FROZEN)

    batch: AutomationBatch | None = None
    if execution_mode == "batch":
        access = await resolve_product_access(db, auth_code_id)
        entitlements = access.get("entitlements") or {}
        if not (
            access.get("enabled")
            and access.get("product_type") == "business"
            and entitlements.get("batch_execution")
            and entitlements.get("multi_account_workspace")
        ):
            return await _error(db, "当前授权不包含专业批量工作台", ErrorCodes.PERMISSION_DENIED)
        if not client_batch_id or not client_item_id or not idempotency_key:
            return await _error(db, "批量启动上下文不完整", ErrorCodes.INVALID_PARAMS)
        batch = (
            await db.execute(
                select(AutomationBatch).where(
                    AutomationBatch.client_batch_id == client_batch_id,
                    AutomationBatch.auth_code_id == auth_code_id,
                    AutomationBatch.device_id == (device_id or ""),
                )
            )
        ).scalar_one_or_none()
        if not batch or batch.status != "running":
            return await _error(db, "批次不存在或已经结束", ErrorCodes.RESOURCE_NOT_FOUND)

    allowed_platforms = [item.strip() for item in (auth_code.platform_scope or "amazon").split(",")]
    if platform_key not in allowed_platforms:
        return await _error(
            db,
            f"当前授权暂未包含 {platform_key} 平台",
            ErrorCodes.PLATFORM_NOT_INCLUDED,
            {"reason": "platform_not_included", "platform_key": platform_key},
        )

    setting = (
        await db.execute(select(Setting).where(Setting.key == "tool_configs"))
    ).scalar_one_or_none()
    tools = json.loads(setting.value) if setting and setting.value else []
    raw_tool = next((tool for tool in tools if tool.get("id") == tool_id), None)
    if not raw_tool:
        return await _error(db, "工具不存在", 404)
    target_tool = normalize_tool_config(raw_tool)
    if target_tool.get("availability") not in {"live", "live_beta"}:
        return await _error(
            db,
            "该工具当前仅支持演示流程",
            ErrorCodes.TOOL_UNAVAILABLE,
            {"reason": "demo_only", "availability": target_tool.get("availability")},
        )
    if target_tool.get("script_status") != "script_ready":
        return await _error(
            db,
            "该工具的自动化脚本尚未就绪",
            ErrorCodes.TOOL_SCRIPT_NOT_READY,
            {
                "code": "TOOL_SCRIPT_NOT_READY",
                "reason": "script_not_ready",
                "script_status": target_tool.get("script_status", "script_not_ready"),
            },
        )
    if target_tool.get("platform_key") != platform_key:
        return await _error(db, "工具平台与请求平台不一致", 400)

    release_status = target_tool.get("release_status", "available")
    if release_status not in {"available", "beta"}:
        return await _error(
            db,
            "该工具暂时不可用，请稍后再试",
            ErrorCodes.TOOL_UNAVAILABLE,
            {"reason": "tool_unavailable", "release_status": release_status},
        )
    if execution_mode == "batch" and not target_tool.get("supports_batch"):
        return await _error(db, "该工具未开放批量执行", ErrorCodes.PERMISSION_DENIED)
    if batch and batch.tool_id != tool_id:
        return await _error(db, "批次工具与启动工具不一致", ErrorCodes.INVALID_PARAMS)

    if auth_code.plan_id:
        plan = (
            await db.execute(select(Plan).where(Plan.id == auth_code.plan_id))
        ).scalar_one_or_none()
        if plan:
            current_plan_code = resolve_plan_code(plan.name, plan.entitlements)
            available_plans = [
                str(item).upper() for item in target_tool.get("available_plans", [])
            ]
            if available_plans and current_plan_code not in available_plans:
                return await _error(
                    db,
                    "当前套餐暂未包含该工具",
                    ErrorCodes.PLAN_TOOL_NOT_INCLUDED,
                    {
                        "reason": "plan_not_included",
                        "tool_id": tool_id,
                        "plan_code": current_plan_code,
                        "available_plans": available_plans,
                    },
                )
        if plan and plan.features:
            try:
                plan_features = json.loads(plan.features)
                allowed_tools = (
                    plan_features.get("allowed_tools", [])
                    if isinstance(plan_features, dict)
                    else []
                )
                if allowed_tools and tool_id not in allowed_tools:
                    capability_key = target_tool.get("capability_key")
                    if capability_key and capability_key not in allowed_tools:
                        return await _error(
                            db,
                            "当前套餐暂未包含该工具",
                            ErrorCodes.PLAN_TOOL_NOT_INCLUDED,
                            {"reason": "plan_not_included", "tool_id": tool_id},
                        )
            except (json.JSONDecodeError, TypeError):
                pass

    if not await _device_is_authorized(db, auth_code_id, user_id, device_id):
        return await _error(db, "当前设备或席位已失效，请使用授权码重新登录", 403)

    script_key, target_url = resolve_tool_runtime(target_tool, platform_key)
    release = await resolve_release_for_launch(db, tool_id, device_id or str(user_id), client_runner_api_version)
    if release is None and await resolve_release_for_launch(db, tool_id, device_id or str(user_id), 2):
        raise target_profile_service.fail("RUNNER_VERSION_MISMATCH", "当前工具版本需要更新客户端，不能回退旧工具执行")
    if release:
        manifest = release["manifest"]
        signature = release["signature"]
        signing_key_id = release.get("signing_key_id", settings.TOOL_SIGNING_KEY_ID)
        signature_required = True
        script_key = manifest["scriptKey"]
        tool_version = manifest["version"]
        runner_api_version = manifest["runnerApiVersion"]
    else:
        tool_version = target_tool.get("tool_version", "1.0.0")
        runner_api_version = int(target_tool.get("runner_api_version", 1))
        manifest = build_manifest(
            {
                "tool_id": tool_id,
                "version": tool_version,
                "script_key": script_key,
                "runner_api_version": runner_api_version,
                "artifact_sha256": "embedded",
                "artifact_url": None,
            }
        )
        signature_required = bool(
            settings.TOOL_SIGNING_PRIVATE_KEY_B64 and settings.TOOL_SIGNING_PUBLIC_KEY_B64
        )
        signature = sign_manifest(manifest) if signature_required else None
        signing_key_id = settings.TOOL_SIGNING_KEY_ID if signature_required else None

    signed_target: dict[str, Any] | None = None
    capability = str(target_tool.get("target_capability") or manifest.get("requiredCapability") or "")
    if manifest.get("requiredCapability") and target_tool.get("target_capability") and manifest["requiredCapability"] != target_tool["target_capability"]:
        raise target_profile_service.fail("TARGET_CAPABILITY_MISMATCH", "工具配置与签名发行能力不一致")
    requires_profile = bool(target_tool.get("requires_target_profile") or capability or runner_api_version >= 2)
    if requires_profile:
        if client_runner_api_version != 2 or runner_api_version != 2:
            raise target_profile_service.fail("RUNNER_VERSION_MISMATCH", "该工具需要 Runner 协议 2，不支持旧客户端执行")
        if not target_profile_id or not target_profile_revision or capability != target_profile_service.TEMPLATE_CAPABILITY:
            raise target_profile_service.fail("TARGET_PROFILE_REQUIRED", "请选择已审核且支持当前工具的入口")
        signed_target = await target_profile_service.approved_profile(db, target_profile_id, target_profile_revision, capability)
        if signed_target["profile"]["productKey"] != platform_key:
            raise target_profile_service.fail("TARGET_PRODUCT_MISMATCH", "入口所属产品与当前工具不同")
        target_url = signed_target["profile"]["entryUrl"]
        # Bind permission-affecting context into the exact signed manifest, not
        # just renderer metadata. Existing release signatures remain unchanged.
        manifest = {**manifest, "schemaVersion": 2, "targetProfileId": target_profile_id,
                    "targetProfileRevision": target_profile_revision, "requiredCapability": capability}
        try:
            signature = sign_manifest(manifest)
        except (ValueError, TypeError):
            raise target_profile_service.fail("TARGET_SIGNING_UNAVAILABLE", "工具签名密钥不可用，未创建启动授权", 503) from None
        signing_key_id = settings.TOOL_SIGNING_KEY_ID
        signature_required = True
    elif target_profile_id is not None or target_profile_revision is not None:
        raise target_profile_service.fail("TARGET_PROFILE_NOT_SUPPORTED", "该旧工具没有目标入口能力，不能绑定新入口后执行")
    if runner_api_version > client_runner_api_version:
        raise target_profile_service.fail("RUNNER_VERSION_MISMATCH", "客户端 Runner 协议不支持当前工具")
    commercial = await _assert_runtime_scope(db, user_id, auth_code_id, target_tool, target_url, signed_target, course_ref)
    if commercial and json.loads(commercial.snapshot)["definition"]["business_line"] == "trial":
        # All rows are locked under the auth-code lock, matching consume's lock
        # order. Used/unknown operations are never released by a clock timeout.
        previous = (await db.execute(select(LaunchToken).where(
            LaunchToken.auth_code_id == auth_code_id, LaunchToken.used_at.is_(None),
            LaunchToken.status.in_(["pending", "revoked", "expired"]),
        ).with_for_update().execution_options(populate_existing=True))).scalars()
        for old in previous:
            await _release_unconsumed_trial(db, old)

    existing_launch: LaunchToken | None = None
    if execution_mode == "batch" and idempotency_key:
        existing_launch = (
            await db.execute(
                select(LaunchToken)
                .where(LaunchToken.idempotency_key == idempotency_key)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if existing_launch and (
            existing_launch.auth_code_id != auth_code_id
            or existing_launch.tool_id != tool_id
            or existing_launch.client_batch_id != client_batch_id
            or existing_launch.client_item_id != client_item_id
        ):
            return await _error(db, "启动幂等标识冲突", ErrorCodes.RESOURCE_ALREADY_EXISTS)
    if existing_launch and existing_launch.status == "used":
        return await _error(db, "该批次项已经启动，不能重复执行", ErrorCodes.RESOURCE_ALREADY_EXISTS)

    if (
        existing_launch
        and existing_launch.status == "pending"
        and existing_launch.expires_at > datetime.now()
    ):
        token = existing_launch.token
        expires_at = existing_launch.expires_at
    else:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now() + timedelta(minutes=5)
        if existing_launch:
            existing_launch.token = token
            existing_launch.expires_at = expires_at
            existing_launch.status = "pending"
        else:
            db.add(
                LaunchToken(
                    token=token,
                    user_id=user_id,
                    auth_code_id=auth_code_id,
                    platform_key=platform_key,
                    tool_id=tool_id,
                    script_key=script_key,
                    device_id=device_id,
                    expires_at=expires_at,
                    status="pending",
                    execution_mode=execution_mode,
                    client_batch_id=client_batch_id,
                    client_item_id=client_item_id,
                    idempotency_key=idempotency_key,
                )
            )
    if signed_target:
        await target_profile_service.bind_launch(db, token, {
            "profileId": target_profile_id, "revision": target_profile_revision, "capability": capability,
            "scriptKey": script_key, "toolVersion": tool_version, "runnerApiVersion": 2,
            **({"courseRef": course_ref} if course_ref else {}),
        })
    if commercial and json.loads(commercial.snapshot)["definition"]["business_line"] == "trial":
        quota_capability = CAPABILITY_ALIASES.get(str(target_tool.get("capability_key")), str(target_tool.get("capability_key")))
        if quota_capability in TRIAL_CAPABILITIES:
            try:
                await CommercialService(db).reserve_trial(commercial.id, quota_capability, trial_operation_id(token), current_user)
            except Exception:
                await db.rollback()
                raise
    await _commit_or_rollback(db)
    logger.info("创建 launch token: user=%s, tool=%s, platform=%s", user_id, tool_id, platform_key)

    return success_response(
        {
            "token": token,
            "expires_in": 300,
            "expires_at": expires_at.isoformat(),
            "launch_data": {
                "platform_key": platform_key,
                "tool_id": tool_id,
                "token": token,
                "script_key": script_key,
                "tool_name": target_tool.get("name"),
                "tool_module": target_tool.get("module"),
                "target_url": target_url,
                "category": target_tool.get("category", ""),
                "description": target_tool.get("description", ""),
                "expires_at": expires_at.isoformat(),
                "runner_api_version": runner_api_version,
                "tool_version": tool_version,
                "tool_manifest": manifest,
                "tool_signature": signature,
                "signing_key_id": signing_key_id,
                "signature_required": signature_required,
                "execution_mode": execution_mode,
                "client_batch_id": client_batch_id,
                "client_item_id": client_item_id,
                **({"target_profile": signed_target} if signed_target else {}),
            },
        }
    )


async def verify_launch_grant(db: AsyncSession, token: str) -> dict[str, Any]:
    """Consume one pending launch grant exactly once."""
    if settings.TOOL_EXECUTION_MODE != "live":
        raise HTTPException(
            status_code=409,
            detail={"code": "FEATURE_DISABLED", "message": "当前为演示模式"},
        )
    code_id = await db.scalar(select(LaunchToken.auth_code_id).where(LaunchToken.token == token))
    if code_id is None:
        return await _error(db, "Token 不存在", 404)
    # Always acquire in authorization -> launch -> batch order, matching create
    # and revocation. Token TTL is not permission to outlive revoked access.
    auth_code = await lock_auth_code(db, code_id)
    launch = (
        await db.execute(
            select(LaunchToken).where(LaunchToken.token == token).with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if not launch:
        return await _error(db, "Token 不存在", 404)
    if launch.status in {"used", "reported"}:
        return await _error(db, "Token 已使用", 403)
    if launch.status != "pending":
        return await _error(db, "Token 状态无效", 403)
    if launch.expires_at < datetime.now():
        await _release_unconsumed_trial(db, launch)
        await _commit_or_rollback(db)
        return error_response("Token 已过期", 403)
    if not auth_code or effective_license_status(auth_code) != "active":
        return await _error(db, "授权已经失效，请重新登录", 403)
    if not await _device_is_authorized(db, code_id, launch.user_id, launch.device_id):
        return await _error(db, "当前设备或席位已失效，请重新登录", 403)
    if launch.platform_key not in [part.strip() for part in (auth_code.platform_scope or "amazon").split(",")]:
        return await _error(db, "当前授权不再包含该平台", 403)
    setting = (await db.execute(select(Setting).where(Setting.key == "tool_configs")
                               .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    try:
        tools = json.loads(setting.value) if setting and setting.value else []
        raw_tool = next((item for item in tools if item.get("id") == launch.tool_id), None)
    except (TypeError, ValueError, AttributeError):
        raw_tool = None
    tool = normalize_tool_config(raw_tool) if raw_tool else None
    if not tool or (
        tool.get("availability") not in {"live", "live_beta"}
        or tool.get("script_status") != "script_ready"
        or tool.get("release_status", "available") not in {"available", "beta"}
        or tool.get("platform_key") != launch.platform_key
    ):
        return await _error(db, "工具当前不可执行", 403)
    target_binding = await target_profile_service.read_launch_binding(db, token)
    requires_profile = bool(tool.get("requires_target_profile") or tool.get("target_capability") or int(tool.get("runner_api_version", 1)) >= 2)
    if requires_profile and not target_binding:
        raise target_profile_service.fail("TARGET_PROFILE_REQUIRED", "启动授权缺少目标入口绑定，不能执行新工具")
    signed_target = None
    if target_binding:
        if target_binding["scriptKey"] != launch.script_key or target_binding["runnerApiVersion"] != 2:
            raise target_profile_service.fail("TARGET_LAUNCH_CONFLICT", "启动授权与入口适配器不匹配")
        current_capability = tool.get("target_capability")
        if current_capability and current_capability != target_binding["capability"]:
            raise target_profile_service.fail("TARGET_LAUNCH_CONFLICT", "工具能力已变化，请重新核验入口")
        signed_target = await target_profile_service.approved_profile(db, target_binding["profileId"], target_binding["revision"], target_binding["capability"])
    _, target_url = resolve_tool_runtime(tool, launch.platform_key)
    if signed_target:
        target_url = signed_target["profile"]["entryUrl"]
    await _assert_runtime_scope(db, launch.user_id, code_id, tool, target_url, signed_target, (target_binding or {}).get("courseRef"))
    if auth_code.plan_id:
        plan = (await db.execute(select(Plan).where(Plan.id == auth_code.plan_id)
                                 .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if not plan:
            return await _error(db, "授权套餐不存在", 403)
        allowed_plans = [str(item).upper() for item in tool.get("available_plans", [])]
        if allowed_plans and resolve_plan_code(plan.name, plan.entitlements) not in allowed_plans:
            return await _error(db, "当前套餐不再包含该工具", 403)
        try:
            features = json.loads(plan.features) if plan.features else {}
            allowed_tools = features.get("allowed_tools", []) if isinstance(features, dict) else []
        except (TypeError, ValueError):
            allowed_tools = []
        if allowed_tools and launch.tool_id not in allowed_tools and tool.get("capability_key") not in allowed_tools:
            return await _error(db, "当前套餐不再包含该工具", 403)
    if launch.execution_mode == "batch":
        batch = (await db.execute(select(AutomationBatch).where(
            AutomationBatch.client_batch_id == launch.client_batch_id,
            AutomationBatch.auth_code_id == code_id, AutomationBatch.device_id == launch.device_id,
        ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        access = await resolve_product_access(db, code_id)
        entitlements = access.get("entitlements") or {}
        if (
            not batch or batch.status != "running" or batch.tool_id != launch.tool_id
            or not tool.get("supports_batch") or not access.get("enabled")
            or access.get("product_type") != "business"
            or not entitlements.get("batch_execution") or not entitlements.get("multi_account_workspace")
        ):
            return await _error(db, "批次已经结束或批量权限已失效", 403)

    launch.status = "used"
    launch.used_at = datetime.now()
    await _commit_or_rollback(db)
    logger.info("验证 launch token: tool=%s, user=%s", launch.tool_id, launch.user_id)
    return success_response(
        {
            "valid": True,
            "user_id": launch.user_id,
            "auth_code_id": launch.auth_code_id,
            "platform_key": launch.platform_key,
            "tool_id": launch.tool_id,
            "script_key": launch.script_key,
            "device_id": launch.device_id,
            "execution_mode": launch.execution_mode,
            "client_batch_id": launch.client_batch_id,
            "client_item_id": launch.client_item_id,
            **({"target_profile_id": target_binding["profileId"], "target_profile_revision": target_binding["revision"],
                "required_capability": target_binding["capability"]} if target_binding else {}),
        }
    )
