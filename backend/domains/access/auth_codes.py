"""Authorization-code administration read models and transactions."""

from __future__ import annotations

import json
import secrets
import string
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.audit import log_admin_action
from core.exceptions import NotFoundException
from models import AuthCode, AuthSeat, Device, LaunchToken, Plan
from models.commercial import CommercialGrant
from schemas import AuthCodeGenerate, AuthCodeResponse, AuthCodeUpdate
from schemas.auth_code import AuthCodeExtend

from .entitlements import normalize_entitlements, resolve_product_access
from .license_state import effective_license_status, effective_license_status_sql
from .locking import lock_auth_code


def _parse_platform_scope(scope: str | None) -> list[str]:
    if not scope:
        return ["amazon"]
    return [part.strip() for part in scope.split(",") if part.strip()]


async def _seat_used(db: AsyncSession, auth_code_id: int) -> int:
    result = await db.execute(
        select(func.count(AuthSeat.id)).where(
            AuthSeat.auth_code_id == auth_code_id,
            AuthSeat.status == "active",
        )
    )
    return int(result.scalar() or 0)


async def _device_used(db: AsyncSession, auth_code_id: int) -> int:
    result = await db.execute(select(func.count(Device.id)).where(Device.auth_code_id == auth_code_id))
    return int(result.scalar() or 0)


async def build_response(db: AsyncSession, code: AuthCode) -> AuthCodeResponse:
    plan_row = (
        await db.execute(
            select(Plan.name, Plan.product_type, Plan.entitlements).where(Plan.id == code.plan_id)
        )
    ).first()
    plan_name = plan_row[0] if plan_row else "未关联套餐"
    product_type = (plan_row[1] if plan_row else None) or "consumer"
    access = await resolve_product_access(db, code.id)
    plan_name = access.get("plan_name", plan_name)
    return AuthCodeResponse(
        id=code.id,
        code=code.code,
        plan_id=code.plan_id,
        user_id=code.user_id,
        device_id=code.device_id,
        device_name=code.device_name,
        max_devices=code.max_devices,
        status=effective_license_status(code),
        expires_at=code.expires_at,
        created_at=code.created_at,
        devices=code.devices,
        platform_scope=_parse_platform_scope(code.platform_scope),
        scene_type=code.scene_type,
        seat_limit=code.seat_limit,
        seat_used=await _seat_used(db, code.id),
        device_used=await _device_used(db, code.id),
        plan_name=plan_name,
        product_type=product_type,
        entitlements=access["entitlements"],
    )


async def list_codes(
    db: AsyncSession,
    *,
    page: int,
    page_size: int,
    platform_key: str | None,
    include_deleted: bool,
    keyword: str | None = None,
    product_type: str | None = None,
    status: str | None = None,
) -> dict[str, object]:
    seat_subquery = (
        select(AuthSeat.auth_code_id, func.count(AuthSeat.id).label("seat_used"))
        .where(AuthSeat.status == "active")
        .group_by(AuthSeat.auth_code_id)
        .subquery()
    )
    device_subquery = (
        select(Device.auth_code_id, func.count(Device.id).label("device_used"))
        .group_by(Device.auth_code_id)
        .subquery()
    )
    query = (
        select(
            AuthCode,
            func.coalesce(seat_subquery.c.seat_used, 0).label("seat_used"),
            func.coalesce(device_subquery.c.device_used, 0).label("device_used"),
            Plan.name.label("plan_name"),
            Plan.product_type.label("product_type"),
            Plan.entitlements.label("plan_entitlements"),
        )
        .options(selectinload(AuthCode.devices))
        .outerjoin(seat_subquery, AuthCode.id == seat_subquery.c.auth_code_id)
        .outerjoin(device_subquery, AuthCode.id == device_subquery.c.auth_code_id)
        .outerjoin(Plan, AuthCode.plan_id == Plan.id)
    )
    count_query = select(func.count(AuthCode.id)).outerjoin(Plan, AuthCode.plan_id == Plan.id)
    filters = []
    if not include_deleted:
        filters.append(AuthCode.status != "deleted")
    if platform_key:
        filters.append(AuthCode.platform_scope.contains(platform_key))
    if product_type:
        filters.append(func.coalesce(Plan.product_type, "consumer") == product_type)
    if status:
        filters.append(effective_license_status_sql() == status)
    normalized_keyword = keyword.strip() if keyword else ""
    if normalized_keyword:
        device_match = select(Device.id).where(
            Device.auth_code_id == AuthCode.id,
            or_(Device.device_name.contains(normalized_keyword, autoescape=True), Device.device_id.contains(normalized_keyword, autoescape=True)),
        ).exists()
        filters.append(or_(
            AuthCode.code.contains(normalized_keyword, autoescape=True),
            AuthCode.device_name.contains(normalized_keyword, autoescape=True),
            AuthCode.device_id.contains(normalized_keyword, autoescape=True),
            device_match,
        ))
    query = query.where(*filters)
    count_query = count_query.where(*filters)
    count = int((await db.execute(count_query)).scalar() or 0)
    rows = (
        await db.execute(
            query.order_by(AuthCode.created_at.desc(), AuthCode.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    commercial_rows = (await db.scalars(select(CommercialGrant).where(
        CommercialGrant.auth_code_id.in_([row[0].id for row in rows]),
    ))).all() if rows else []
    commercial_by_code = {grant.auth_code_id: json.loads(grant.snapshot) for grant in commercial_rows}
    data = []
    for code, seat_used, device_used, plan_name, product_type, plan_entitlements in rows:
        if code.id in commercial_by_code:
            snapshot = commercial_by_code[code.id]
            plan_name = snapshot["definition"]["name"]
            product_type = "consumer"
            plan_entitlements = {"allowed_capabilities": snapshot["definition"]["allowed_capabilities"], "plan_code": snapshot["sku"]}
        resolved_product_type = product_type or "consumer"
        data.append(
            AuthCodeResponse(
                id=code.id,
                code=code.code,
                plan_id=code.plan_id,
                user_id=code.user_id,
                device_id=code.device_id,
                device_name=code.device_name,
                max_devices=code.max_devices,
                status=effective_license_status(code),
                expires_at=code.expires_at,
                created_at=code.created_at,
                devices=code.devices,
                platform_scope=_parse_platform_scope(code.platform_scope),
                scene_type=code.scene_type,
                seat_limit=code.seat_limit,
                seat_used=seat_used or 0,
                device_used=device_used or 0,
                plan_name=plan_name or "未关联套餐",
                product_type=resolved_product_type,
                entitlements=normalize_entitlements(plan_entitlements, resolved_product_type),
            )
        )
    return {"data": data, "page": page, "page_size": page_size, "total": count}


async def get_code(db: AsyncSession, code_id: int, *, platform_key: str | None = None) -> AuthCodeResponse:
    code = (
        await db.execute(
            select(AuthCode).options(selectinload(AuthCode.devices)).where(AuthCode.id == code_id)
        )
    ).scalars().first()
    if not code:
        raise NotFoundException("授权码不存在")
    if platform_key and platform_key not in _parse_platform_scope(code.platform_scope):
        raise HTTPException(status_code=403, detail="该授权不属于当前平台，请切换平台后查看")
    return await build_response(db, code)


def _random_code(length: int = 6) -> str:
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(length))


async def batch_generate(
    db: AsyncSession,
    request_data: AuthCodeGenerate,
    *,
    actor: dict[str, Any],
    request: Request,
) -> list[str]:
    plan_name = "UNKNOWN"
    code_prefix: str | None = None
    expires_at: datetime | None = None
    if request_data.plan_id:
        plan = (
            await db.execute(select(Plan).where(Plan.id == request_data.plan_id))
        ).scalars().first()
        if not plan:
            raise NotFoundException("套餐不存在")
        if plan.status != "active":
            raise HTTPException(status_code=409, detail="停用套餐不能生成新授权码")
        code_prefix = plan.code_prefix
        plan_name = plan.name.split()[0] if plan.name else "UNKNOWN"
        duration_days = request_data.duration_days or plan.duration_days
        expires_at = datetime.now() + timedelta(days=duration_days)
    elif request_data.duration_days:
        expires_at = datetime.now() + timedelta(days=request_data.duration_days)

    prefix = code_prefix or plan_name
    date_text = datetime.now().strftime("%m%d")
    codes: list[str] = []
    for _ in range(request_data.count):
        code_text = f"{prefix}-{date_text}-{_random_code()}"
        db.add(
            AuthCode(
                code=code_text,
                plan_id=request_data.plan_id,
                status="unused",
                expires_at=expires_at,
                max_devices=request_data.max_devices or 1,
                platform_scope=request_data.platform_scope or "amazon",
                scene_type=request_data.scene_type or "competition",
                seat_limit=request_data.seat_limit or request_data.max_devices or 1,
            )
        )
        codes.append(code_text)
    await db.flush()
    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="batch_create_auth_codes",
        target_type="auth_code",
        detail={
            "role": actor.get("role"),
            "before": None,
            "after": {"count": request_data.count, "prefix": prefix, "codes": codes[:5]},
            "reason": None,
        },
        request=request,
    )
    await db.commit()
    return codes


async def update_code(
    db: AsyncSession,
    code_id: int,
    request_data: AuthCodeUpdate,
    *,
    actor: dict[str, Any],
    request: Request,
) -> AuthCodeResponse:
    code = await lock_auth_code(db, code_id)
    if not code:
        raise NotFoundException("授权码不存在")
    if code.status == "deleted":
        raise HTTPException(status_code=409, detail="已删除的授权不能修改")
    if request_data.status == "deleted":
        raise HTTPException(status_code=409, detail="请使用删除授权操作，以同步撤销席位")
    if request_data.status == "active" and not code.user_id:
        raise HTTPException(status_code=409, detail="尚未激活的授权不能直接标记为已激活")
    if request_data.status == "unused" and code.user_id:
        raise HTTPException(status_code=409, detail="已绑定用户的授权不能恢复为未激活")
    before = {
        "code": code.code,
        "plan_id": code.plan_id,
        "status": code.status,
        "expires_at": code.expires_at,
        "max_devices": code.max_devices,
        "platform_scope": code.platform_scope,
        "scene_type": code.scene_type,
        "seat_limit": code.seat_limit,
    }
    changes = request_data.model_dump(exclude_none=True)
    commercial_id = await db.scalar(select(CommercialGrant.id).where(CommercialGrant.auth_code_id == code_id))
    if commercial_id and any(key in changes for key in ("expires_at", "max_devices")):
        raise HTTPException(status_code=409, detail="项目授权的期限和席位属于购买快照，不能从旧授权编辑入口改写")
    for key, value in changes.items():
        if key == "expires_at" and isinstance(value, str):
            value = datetime.fromisoformat(value)
        setattr(code, key, value)
    if effective_license_status(code) != "active":
        await db.execute(update(LaunchToken).where(
            LaunchToken.auth_code_id == code_id, LaunchToken.status == "pending",
        ).values(status="revoked"))
    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="update_auth_code",
        target_type="auth_code",
        target_id=code_id,
        detail={
            "role": actor.get("role"),
            "before": before,
            "after": {**before, **changes},
            "reason": None,
        },
        request=request,
    )
    await db.commit()
    return await build_response(db, code)


async def extend_code(
    db: AsyncSession, code_id: int, data: AuthCodeExtend, *, actor: dict[str, Any], request: Request,
) -> AuthCodeResponse:
    code = await lock_auth_code(db, code_id)
    if not code:
        raise NotFoundException("授权码不存在")
    if code.status == "deleted":
        raise HTTPException(status_code=409, detail="已删除的授权不能延期")
    if await db.scalar(select(CommercialGrant.id).where(CommercialGrant.auth_code_id == code_id)):
        raise HTTPException(status_code=409, detail="项目授权不能按固定天数续期，请确认新项目商品订单")
    before = {"status": code.status, "expires_at": code.expires_at}
    try:
        expiry = max(code.expires_at or datetime.now(), datetime.now()) + timedelta(days=data.days)
    except OverflowError as error:
        raise HTTPException(status_code=422, detail="延期后的日期超出支持范围") from error
    code.expires_at = expiry
    if code.status == "expired":
        code.status = "active" if code.user_id else "unused"
    await log_admin_action(
        db, user_id=actor.get("staff_id"), user_name=actor.get("username"),
        action="extend_auth_code", target_type="auth_code", target_id=code_id,
        detail={"role": actor.get("role"), "before": before,
                "after": {"status": code.status, "expires_at": code.expires_at}, "days": data.days},
        request=request,
    )
    await db.commit()
    return await build_response(db, code)


async def delete_code(
    db: AsyncSession,
    code_id: int,
    *,
    actor: dict[str, Any],
    request: Request,
) -> None:
    code = await lock_auth_code(db, code_id)
    if not code:
        raise NotFoundException("授权码不存在")
    if code.status == "deleted":
        return
    previous_status = code.status
    code.status = "deleted"
    await db.execute(update(LaunchToken).where(
        LaunchToken.auth_code_id == code_id, LaunchToken.status == "pending",
    ).values(status="revoked"))
    await db.execute(
        update(AuthSeat)
        .where(AuthSeat.auth_code_id == code_id, AuthSeat.status == "active")
        .values(status="inactive")
    )
    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="delete_auth_code",
        target_type="auth_code",
        target_id=code_id,
        detail={
            "role": actor.get("role"),
            "before": {"code": code.code, "status": previous_status},
            "after": {"deleted": True, "status": "deleted"},
            "reason": None,
        },
        request=request,
    )
    await db.commit()
