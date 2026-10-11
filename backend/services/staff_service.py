"""Authentication helpers for internal staff accounts."""

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.capabilities import capabilities_for_role
from core.logging import get_logger
from core.security import (
    create_access_token,
    hash_password_async,
    verify_password_fallback_async,
)
from core.transaction_locks import acquire_transaction_guard
from models import Agency, Setting, StaffRole, StaffStatus, StaffUser
from schemas.staff import (
    StaffAccountCreate,
    StaffAccountResponse,
    StaffAccountUpdate,
    StaffPasswordChange,
    StaffPasswordReset,
)

logger = get_logger(__name__)


def staff_to_dict(staff: StaffUser) -> dict[str, object]:
    return {
        "staff_id": staff.id,
        "user_id": staff.id,
        "username": staff.username,
        "name": staff.display_name,
        "display_name": staff.display_name,
        "role": staff.role,
        "capabilities": sorted(capabilities_for_role(staff.role)),
        "agency_id": staff.agency_id,
        "status": staff.status,
        "token_version": staff.token_version,
        "force_password_reset": bool(staff.force_password_reset),
        "auth_code_id": None,
        "device_id": None,
    }


def create_staff_access_token(staff: StaffUser) -> str:
    return create_access_token(
        data={
            "token_type": "staff",
            "staff_id": staff.id,
            "user_id": staff.id,
            "role": staff.role,
            "token_version": staff.token_version,
            "auth_code_id": None,
        },
        expires_delta=timedelta(hours=8),
    )


def account_snapshot(staff: StaffUser) -> dict[str, object]:
    return {
        "id": staff.id,
        "username": staff.username,
        "display_name": staff.display_name,
        "role": staff.role,
        "agency_id": staff.agency_id,
        "status": staff.status,
        "token_version": staff.token_version,
        "force_password_reset": bool(staff.force_password_reset),
    }


async def _active_super_admin_count(db: AsyncSession) -> int:
    result = await db.execute(
        select(StaffUser.id).where(
            StaffUser.role == StaffRole.SUPER_ADMIN,
            StaffUser.status == StaffStatus.ACTIVE,
        ).with_for_update()
    )
    return len(result.scalars().all())


async def change_password(
    db: AsyncSession,
    data: StaffPasswordChange,
    *,
    actor: dict[str, Any],
    request: Request,
) -> StaffUser:
    staff = (
        await db.execute(
            select(StaffUser).where(StaffUser.id == actor["staff_id"]).with_for_update()
        )
    ).scalar_one()
    before = account_snapshot(staff)
    valid, _ = await verify_password_fallback_async(data.current_password, staff.password_hash)
    if not valid:
        raise HTTPException(status_code=422, detail="当前密码不正确")
    if data.current_password == data.new_password:
        raise HTTPException(status_code=422, detail="新密码不能与当前密码相同")
    staff.password_hash = await hash_password_async(data.new_password)
    staff.force_password_reset = False
    staff.token_version += 1
    await log_admin_action(
        db,
        user_id=staff.id,
        user_name=staff.username,
        action="staff_change_password",
        target_type="staff_user",
        target_id=staff.id,
        detail={
            "role": staff.role,
            "before": before,
            "after": account_snapshot(staff),
            "reason": "self_password_change",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(staff)
    return staff


async def logout_staff(
    db: AsyncSession,
    *,
    actor: dict[str, Any],
    request: Request,
) -> None:
    staff = (
        await db.execute(
            select(StaffUser).where(StaffUser.id == actor["staff_id"]).with_for_update()
        )
    ).scalar_one()
    before = account_snapshot(staff)
    staff.token_version += 1
    await log_admin_action(
        db,
        user_id=staff.id,
        user_name=staff.username,
        action="staff_logout",
        target_type="staff_user",
        target_id=staff.id,
        detail={
            "role": staff.role,
            "before": before,
            "after": account_snapshot(staff),
            "reason": "explicit_logout",
        },
        request=request,
    )
    await db.commit()


async def list_accounts(
    db: AsyncSession,
    *,
    page: int,
    page_size: int,
    keyword: str = "",
) -> tuple[list[StaffAccountResponse], int]:
    filters = []
    if keyword.strip():
        filters.append(StaffUser.username.contains(keyword.strip(), autoescape=True) | StaffUser.display_name.contains(keyword.strip(), autoescape=True))
    total = int((await db.execute(select(func.count(StaffUser.id)).where(*filters))).scalar() or 0)
    accounts = (
        await db.execute(
            select(StaffUser)
            .where(*filters)
            .order_by(StaffUser.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    agency_ids = {account.agency_id for account in accounts if account.agency_id is not None}
    agency_names = dict((await db.execute(select(Agency.id, Agency.name).where(Agency.id.in_(agency_ids)))).all()) if agency_ids else {}
    return [StaffAccountResponse.model_validate(account).model_copy(update={"agency_name": agency_names.get(account.agency_id)}) for account in accounts], total


async def create_account(
    db: AsyncSession,
    data: StaffAccountCreate,
    *,
    actor: dict[str, Any],
    request: Request,
) -> StaffUser:
    await _validate_agency_assignment(db, data.role, data.agency_id)
    account = StaffUser(
        username=data.username,
        display_name=data.display_name,
        password_hash=await hash_password_async(data.password),
        role=data.role,
        agency_id=data.agency_id,
        status=StaffStatus.ACTIVE,
        token_version=1,
        force_password_reset=True,
        created_by_staff_id=actor["staff_id"],
    )
    db.add(account)
    try:
        await db.flush()
        await log_admin_action(
            db,
            user_id=actor["staff_id"],
            user_name=actor["username"],
            action="staff_create",
            target_type="staff_user",
            target_id=account.id,
            detail={
                "role": actor["role"],
                "before": None,
                "after": account_snapshot(account),
                "reason": "staff_account_create",
            },
            request=request,
        )
        await db.commit()
        await db.refresh(account)
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=409, detail="后台用户名已存在") from error
    return account


async def update_account(
    db: AsyncSession,
    staff_id: int,
    data: StaffAccountUpdate,
    *,
    actor: dict[str, Any],
    request: Request,
) -> StaffUser:
    await acquire_transaction_guard(db, "staff_roles")
    current_actor = (await db.execute(
        select(StaffUser).where(StaffUser.id == actor["staff_id"])
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if (
        not current_actor
        or current_actor.status != StaffStatus.ACTIVE
        or current_actor.role != StaffRole.SUPER_ADMIN
        or current_actor.force_password_reset
        or current_actor.token_version != actor.get("token_version")
    ):
        raise HTTPException(status_code=401, detail="后台账号凭证已失效，请重新登录")
    target = (
        await db.execute(select(StaffUser).where(StaffUser.id == staff_id).with_for_update().execution_options(populate_existing=True))
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="后台账号不存在")
    changes = data.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="没有可更新字段")
    if any(field in changes and changes[field] is None for field in ("display_name", "role", "status")):
        raise HTTPException(status_code=422, detail="姓名、角色和状态不能为空")
    if staff_id == actor["staff_id"] and (
        ("role" in changes and changes["role"] != target.role)
        or ("status" in changes and changes["status"] != StaffStatus.ACTIVE)
    ):
        raise HTTPException(status_code=409, detail="不能停用自己或修改自己的角色")
    removing_active_super = (
        target.role == StaffRole.SUPER_ADMIN
        and target.status == StaffStatus.ACTIVE
        and (
            changes.get("role", target.role) != StaffRole.SUPER_ADMIN
            or changes.get("status", target.status) != StaffStatus.ACTIVE
        )
    )
    if removing_active_super and await _active_super_admin_count(db) <= 1:
        raise HTTPException(status_code=409, detail="必须至少保留一个启用的超级管理员")
    before = account_snapshot(target)
    await _validate_agency_assignment(
        db, changes.get("role", target.role), changes.get("agency_id", target.agency_id),
    )
    invalidates_token = False
    for field, value in changes.items():
        if getattr(target, field) != value:
            setattr(target, field, value)
            if field in {"role", "status", "agency_id"}:
                invalidates_token = True
    if invalidates_token:
        target.token_version += 1
    await log_admin_action(
        db,
        user_id=actor["staff_id"],
        user_name=actor["username"],
        action="staff_update",
        target_type="staff_user",
        target_id=target.id,
        detail={
            "role": actor["role"],
            "before": before,
            "after": account_snapshot(target),
            "reason": "staff_account_update",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(target)
    return target


async def reset_password(
    db: AsyncSession,
    staff_id: int,
    data: StaffPasswordReset,
    *,
    actor: dict[str, Any],
    request: Request,
) -> None:
    if staff_id == actor["staff_id"]:
        raise HTTPException(status_code=409, detail="请使用修改密码接口更新自己的密码")
    target = (
        await db.execute(select(StaffUser).where(StaffUser.id == staff_id).with_for_update())
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="后台账号不存在")
    before = account_snapshot(target)
    target.password_hash = await hash_password_async(data.new_password)
    target.force_password_reset = True
    target.token_version += 1
    await log_admin_action(
        db,
        user_id=actor["staff_id"],
        user_name=actor["username"],
        action="staff_reset_password",
        target_type="staff_user",
        target_id=target.id,
        detail={
            "role": actor["role"],
            "before": before,
            "after": account_snapshot(target),
            "reason": "super_admin_password_reset",
        },
        request=request,
    )
    await db.commit()


async def authenticate_staff(
    db: AsyncSession,
    username: str,
    password: str,
    request: Request | None = None,
) -> StaffUser | None:
    result = await db.execute(
        select(StaffUser).where(StaffUser.username == username.strip().lower())
    )
    staff = result.scalar_one_or_none()
    if not staff or staff.status != StaffStatus.ACTIVE:
        return None
    if staff.role == StaffRole.AGENT:
        agency = await db.get(Agency, staff.agency_id) if staff.agency_id else None
        if not agency or agency.status != "active":
            return None

    is_valid, _ = await verify_password_fallback_async(password, staff.password_hash)
    if not is_valid:
        return None

    before_last_login = staff.last_login_at.isoformat() if staff.last_login_at else None
    staff.last_login_at = datetime.utcnow()
    if request is not None:
        await log_admin_action(
            db,
            user_id=staff.id,
            user_name=staff.username,
            action="staff_login",
            target_type="staff_user",
            target_id=staff.id,
            detail={
                "role": staff.role,
                "before": {"last_login_at": before_last_login},
                "after": {"last_login_at": staff.last_login_at.isoformat()},
                "reason": "credential_login",
            },
            request=request,
        )
    await db.commit()
    await db.refresh(staff)
    return staff


async def _validate_agency_assignment(db: AsyncSession, role: str, agency_id: int | None) -> None:
    if role != StaffRole.AGENT:
        if agency_id is not None:
            raise HTTPException(status_code=422, detail="内部员工不能关联代理主体")
        return
    agency = await db.get(Agency, agency_id) if agency_id else None
    if not agency or agency.status != "active":
        raise HTTPException(status_code=422, detail="代理账号必须关联启用中的代理主体")


async def migrate_legacy_admin_password(db: AsyncSession) -> bool:
    """Move the old bcrypt setting into a real super-admin account once.

    Invalid/plaintext legacy values are deliberately discarded. Recovery then
    goes through ``python -m scripts.bootstrap_staff`` instead of an implicit
    default password.
    """

    result = await db.execute(select(Setting).where(Setting.key == "admin_password"))
    legacy = result.scalar_one_or_none()
    if not legacy:
        return False

    migrated = False
    value = (legacy.value or "").strip()
    existing_result = await db.execute(
        select(StaffUser).where(StaffUser.username == "admin")
    )
    existing = existing_result.scalar_one_or_none()
    if not existing and value.startswith(("$2a$", "$2b$", "$2y$")):
        db.add(
            StaffUser(
                username="admin",
                display_name="超级管理员",
                password_hash=value,
                role=StaffRole.SUPER_ADMIN,
                status=StaffStatus.ACTIVE,
                token_version=1,
                force_password_reset=True,
            )
        )
        migrated = True
        logger.warning("旧管理员密码哈希已迁移到 staff_users；首次登录后必须修改密码")
    elif not existing:
        logger.warning("旧管理员密码不是有效 bcrypt 哈希，已弃用；请运行 staff bootstrap 命令")

    await db.delete(legacy)
    await db.commit()
    return migrated
