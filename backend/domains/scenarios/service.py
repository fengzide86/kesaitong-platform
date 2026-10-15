"""Fail-closed restrictions intersect; no assignment preserves legacy training.

An expired/disabled assignment is not absence: it blocks new navigation/writes.
No browser password, Cookie or page contents are accepted by this domain.
"""

import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.security import create_access_token
from models import AuthCode, StaffStatus, StaffUser, User
from models.scenario import ProjectRuntimeScope, ScenarioAssignment, StaffRuntimePermission
from schemas.scenario import (
    ProjectRuntimeScopeWrite,
    ScenarioAssignmentWrite,
    StaffRuntimeLaunchRequest,
    StaffRuntimePermissionWrite,
    exact_origin,
)
from services import target_profile_service


def utc_naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def iso(value: datetime) -> str:
    return utc_naive(value).isoformat() + "Z"


def assignment_dict(row: ScenarioAssignment) -> dict:
    return {
        "id": row.id, "subject_type": row.subject_type, "subject_id": row.subject_id,
        "revision": row.revision, "mode": row.mode, "entry_url": row.entry_url,
        "allowed_origins": row.allowed_origins, "status": row.status,
        "expires_at": iso(row.expires_at),
    }


async def save_assignment(db: AsyncSession, kind: str, subject_id: int, req: ScenarioAssignmentWrite, actor_id: int) -> dict:
    subject = User if kind == "user" else AuthCode if kind == "auth_code" else None
    if subject is None or not await db.get(subject, subject_id):
        raise HTTPException(404, "指派对象不存在")
    values = req.model_dump(exclude={"expected_revision"})
    values["expires_at"] = utc_naive(req.expires_at)
    values["updated_by"] = actor_id
    if req.status == "active" and values["expires_at"] <= datetime.now(UTC).replace(tzinfo=None):
        raise HTTPException(422, "启用策略的结束时间必须晚于当前时间")
    if req.expected_revision == 0:
        row = ScenarioAssignment(subject_type=kind, subject_id=subject_id, revision=1, **values)
        db.add(row)
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(409, "场景策略已被其他管理员创建，请刷新") from exc
    else:
        result = await db.execute(update(ScenarioAssignment).where(
            ScenarioAssignment.subject_type == kind, ScenarioAssignment.subject_id == subject_id,
            ScenarioAssignment.revision == req.expected_revision,
        ).values(**values, revision=req.expected_revision + 1))
        if result.rowcount != 1:
            raise HTTPException(409, "场景策略版本已变化，请刷新后重试")
    await log_admin_action(db, user_id=actor_id, action="scenario.assign", target_type=kind, target_id=subject_id,
                           detail={"revision": req.expected_revision + 1, "mode": req.mode, "status": req.status})
    await db.commit()
    row = (await db.execute(select(ScenarioAssignment).where(
        ScenarioAssignment.subject_type == kind, ScenarioAssignment.subject_id == subject_id,
    ).execution_options(populate_existing=True))).scalar_one()
    return assignment_dict(row)


async def effective_policy(db: AsyncSession, user_id: int, *, now: datetime | None = None) -> dict:
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(403, "客户身份无效")
    now = utc_naive(now or datetime.now(UTC))
    conditions = [and_(ScenarioAssignment.subject_type == "user", ScenarioAssignment.subject_id == user.id)]
    if user.auth_code_id:
        conditions.append(and_(ScenarioAssignment.subject_type == "auth_code", ScenarioAssignment.subject_id == user.auth_code_id))
    rows = list((await db.execute(select(ScenarioAssignment).where(or_(*conditions)).order_by(ScenarioAssignment.id))).scalars())
    revision = sha256(json.dumps([[row.id, row.revision] for row in rows], separators=(",", ":")).encode()).hexdigest()
    base = {"schemaVersion": 1, "principal": {"kind": "customer", "id": str(user.id)},
            "revision": revision, "checkedAt": iso(now), "refreshAfterSeconds": 30, "maxScenes": 1}
    if not rows:
        return {**base, "status": "unassigned", "mode": "training", "entryUrl": None, "allowedOrigins": [], "expiresAt": None}
    mode = "competition" if any(row.mode == "competition" for row in rows) else "training"
    chosen = next((row for row in rows if row.mode == mode), rows[0])
    origins = set(rows[0].allowed_origins)
    for row in rows[1:]:
        origins.intersection_update(row.allowed_origins)
    expiry = min(utc_naive(row.expires_at) for row in rows)
    active = all(row.status == "active" for row in rows) and expiry > now and exact_origin(chosen.entry_url) in origins
    return {**base, "status": "active" if active else "blocked", "mode": mode,
            "entryUrl": chosen.entry_url, "allowedOrigins": sorted(origins), "expiresAt": iso(expiry)}


async def assert_customer_access(db: AsyncSession, user_id: int, url: str | None = None, *, mode: str | None = None) -> dict:
    policy = await effective_policy(db, user_id)
    if policy["status"] == "blocked":
        raise HTTPException(403, "场景策略已到期、停用或冲突，请联系管理员")
    if mode is not None and mode != policy["mode"]:
        raise HTTPException(403, "场景由管理端指定，不能自行切换")
    if policy["status"] == "active" and (not url or exact_origin(url) not in policy["allowedOrigins"]):
        raise HTTPException(403, "当前网站不在管理员指定的场景范围内")
    return policy


def permission_dict(row: StaffRuntimePermission) -> dict:
    return {"staff_id": row.staff_id, "revision": row.revision, "enabled": row.enabled,
            "max_scenes": row.max_scenes, "allowed_origins": row.allowed_origins,
            "allowed_capabilities": row.allowed_capabilities or [], "expires_at": iso(row.expires_at)}


async def save_staff_permission(db: AsyncSession, staff_id: int, req: StaffRuntimePermissionWrite, actor_id: int) -> dict:
    staff = await db.get(StaffUser, staff_id)
    if not staff or staff.status != StaffStatus.ACTIVE or staff.role not in {"super_admin", "operator", "support"}:
        raise HTTPException(404, "有效内部管理员不存在")
    values = req.model_dump(exclude={"expected_revision"})
    values.update(expires_at=utc_naive(req.expires_at), updated_by=actor_id)
    if req.enabled and values["expires_at"] <= datetime.now(UTC).replace(tzinfo=None):
        raise HTTPException(422, "权限结束时间必须晚于当前时间")
    if req.expected_revision == 0:
        db.add(StaffRuntimePermission(staff_id=staff_id, revision=1, **values))
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(409, "工作台权限已存在，请刷新") from exc
    else:
        result = await db.execute(update(StaffRuntimePermission).where(
            StaffRuntimePermission.staff_id == staff_id, StaffRuntimePermission.revision == req.expected_revision,
        ).values(**values, revision=req.expected_revision + 1))
        if result.rowcount != 1:
            raise HTTPException(409, "工作台权限已变化，请刷新")
    await log_admin_action(db, user_id=actor_id, action="scenario.staff_permission", target_type="staff", target_id=staff_id,
                           detail={"revision": req.expected_revision + 1, "enabled": req.enabled, "max_scenes": req.max_scenes})
    await db.commit()
    row = (await db.execute(select(StaffRuntimePermission).where(StaffRuntimePermission.staff_id == staff_id)
                           .execution_options(populate_existing=True))).scalar_one()
    return permission_dict(row)


async def staff_policy(db: AsyncSession, staff: dict) -> dict:
    if staff.get("force_password_reset") or staff.get("role") not in {"super_admin", "operator", "support"}:
        raise HTTPException(403, "当前后台身份不能使用本机工具运行权限")
    row = await db.get(StaffRuntimePermission, staff["user_id"])
    now = datetime.now(UTC).replace(tzinfo=None)
    if not row or not row.enabled or utc_naive(row.expires_at) <= now or not row.allowed_origins:
        raise HTTPException(403, "尚未授予独立的本机运行权限")
    return {"schemaVersion": 1, "principal": {"kind": "staff", "id": str(row.staff_id)},
            "revision": str(row.revision), "status": "active", "mode": "training", "entryUrl": None,
            "allowedOrigins": row.allowed_origins, "maxScenes": row.max_scenes,
            "checkedAt": iso(now), "expiresAt": iso(row.expires_at), "refreshAfterSeconds": 30}


async def issue_staff_grant(db: AsyncSession, staff: dict, req: StaffRuntimeLaunchRequest) -> dict:
    policy = await staff_policy(db, staff)
    if req.origin not in policy["allowedOrigins"]:
        raise HTTPException(403, "未批准该管理员打开此站点")
    # Browse-only token cannot be exchanged for a customer launch grant. A tool
    # grant still requires reviewed capabilities and a separate execution path.
    payload = {"token_type": "staff_runtime", "staff_id": staff["user_id"], "device_id": req.device_id,
               "account_slot": req.account_slot, "origin": req.origin, "policy_revision": policy["revision"],
               "permissions": ["scene.open"], "runner_api_version": 3}
    return {"policy": policy, "grant": {"token": create_access_token(payload, expires_delta=timedelta(seconds=60)),
            "expires_in": 60, "permissions": ["scene.open"], "runner_api_version": 3}}


def project_scope_dict(row: ProjectRuntimeScope) -> dict:
    return {"id": row.id, "project_id": row.project_id, "site_origin": row.site_origin, "mode": row.mode,
            "course_refs": row.course_refs, "revision": row.revision, "status": row.status}


async def save_project_scope(db: AsyncSession, req: ProjectRuntimeScopeWrite, actor_id: int) -> dict:
    if req.status == "active":
        profiles = await target_profile_service.list_profiles(db, {"user_id": actor_id, "staff_id": actor_id, "role": "super_admin"}, admin=True)
        reviewed_refs: set[str] = set()
        for item in profiles:
            profile = item["profile"]
            if profile["reviewStatus"] != "approved" or exact_origin(profile["entryUrl"]) != req.site_origin:
                continue
            verified = await target_profile_service.approved_profile(db, profile["id"], profile["revision"], target_profile_service.TEMPLATE_CAPABILITY)
            reviewed_refs.update(scope["courseRef"] for scope in verified["profile"].get("executionScopes", [])
                                 if scope.get("scenario") == req.mode and scope.get("source") == "admin-verified")
        if not set(req.course_refs).issubset(reviewed_refs):
            raise HTTPException(403, "项目只能绑定同站点、同场景且已经审核签名的课程引用")
    values = req.model_dump(exclude={"expected_revision", "project_id", "site_origin"})
    values["updated_by"] = actor_id
    if req.expected_revision == 0:
        db.add(ProjectRuntimeScope(project_id=req.project_id, site_origin=req.site_origin, revision=1, **values))
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(409, "项目现场映射已经存在，请刷新") from exc
    else:
        result = await db.execute(update(ProjectRuntimeScope).where(
            ProjectRuntimeScope.project_id == req.project_id, ProjectRuntimeScope.site_origin == req.site_origin,
            ProjectRuntimeScope.revision == req.expected_revision,
        ).values(**values, revision=req.expected_revision + 1))
        if result.rowcount != 1:
            raise HTTPException(409, "项目现场映射版本已变化，请刷新")
    await log_admin_action(db, user_id=actor_id, action="scenario.project_scope", target_type="project", target_id=req.project_id,
                           detail={"revision": req.expected_revision + 1, "status": req.status, "site_origin": req.site_origin})
    await db.commit()
    row = (await db.execute(select(ProjectRuntimeScope).where(ProjectRuntimeScope.project_id == req.project_id,
                 ProjectRuntimeScope.site_origin == req.site_origin).execution_options(populate_existing=True))).scalar_one()
    return project_scope_dict(row)


async def assert_project_scope(db: AsyncSession, project_id: str, origin: str, mode: str, course_ref: str | None) -> None:
    row = (await db.execute(select(ProjectRuntimeScope).where(ProjectRuntimeScope.project_id == project_id,
                 ProjectRuntimeScope.site_origin == origin).execution_options(populate_existing=True))).scalar_one_or_none()
    if not row or row.status != "active" or row.mode != mode or not course_ref or course_ref not in row.course_refs:
        raise HTTPException(403, "本次课程尚未绑定到订单约定项目的已审核现场，不允许执行")
