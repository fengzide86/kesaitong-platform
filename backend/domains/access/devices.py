"""Device queries and unbind transactions."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.audit import log_admin_action
from core.exceptions import ConflictException, NotFoundException
from core.timestamps import utc_iso
from models import AuthCode, AuthSeat, Device, LaunchToken, User

from .locking import lock_auth_code


async def _release_device_seat(db: AsyncSession, device: Device) -> None:
    await db.execute(update(LaunchToken).where(
        LaunchToken.auth_code_id == device.auth_code_id,
        LaunchToken.device_id == device.device_id, LaunchToken.status == "pending",
    ).values(status="revoked"))
    result = await db.execute(
        select(AuthSeat).where(
            AuthSeat.auth_code_id == device.auth_code_id,
            AuthSeat.device_id == device.device_id,
            AuthSeat.status == "active",
        )
    )
    for seat in result.scalars().all():
        seat.status = "inactive"
        seat.updated_at = datetime.utcnow()


async def list_admin(
    db: AsyncSession,
    *,
    auth_code_id: int | None,
    page: int,
    page_size: int,
) -> dict[str, object]:
    query = select(Device).options(selectinload(Device.auth_code))
    count_query = select(func.count(Device.id))
    if auth_code_id:
        query = query.where(Device.auth_code_id == auth_code_id)
        count_query = count_query.where(Device.auth_code_id == auth_code_id)
    count = int((await db.execute(count_query)).scalar() or 0)
    devices = (
        await db.execute(
            query.order_by(Device.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    data = [
        {
            "id": device.id,
            "auth_code_id": device.auth_code_id,
            "auth_code": device.auth_code.code if device.auth_code else "未知",
            "device_id": device.device_id,
            "device_name": device.device_name or "未知设备",
            "created_at": utc_iso(device.created_at),
        }
        for device in devices
    ]
    return {"data": data, "page": page, "page_size": page_size, "total": count}


async def list_for_user(db: AsyncSession, current_user: dict[str, Any]) -> list[dict[str, object]]:
    user_id = current_user.get("user_id")
    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    if not user or not user.auth_code_id:
        return []
    auth_code = (
        await db.execute(
            select(AuthCode)
            .options(selectinload(AuthCode.devices))
            .where(AuthCode.id == user.auth_code_id)
        )
    ).scalars().first()
    if not auth_code:
        return []
    return [
        {
            "id": device.id,
            "device_id": device.device_id,
            "device_name": device.device_name or "未知设备",
            "created_at": utc_iso(device.created_at),
            "is_current": False,
        }
        for device in auth_code.devices
    ]


async def unbind_admin(
    db: AsyncSession,
    device_id: int,
    reason: str,
    *,
    actor: dict[str, Any],
    request: Request,
) -> str:
    device = (await db.execute(select(Device).where(Device.id == device_id))).scalars().first()
    if not device:
        raise NotFoundException("设备不存在")
    await lock_auth_code(db, device.auth_code_id)
    device = (await db.execute(select(Device).where(Device.id == device_id)
                              .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not device:
        raise NotFoundException("设备不存在")
    device_name = device.device_name or "未知设备"
    before = {
        "device_name": device_name,
        "device_id": device.device_id,
        "auth_code_id": device.auth_code_id,
    }
    await _release_device_seat(db, device)
    await db.delete(device)
    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="device_unbind",
        target_type="device",
        target_id=device_id,
        detail={
            "role": actor.get("role"),
            "before": before,
            "after": {"unbound": True},
            "reason": reason,
        },
        request=request,
    )
    await db.commit()
    return device_name


async def unbind_user(
    db: AsyncSession,
    device_id: int,
    current_user: dict[str, Any],
) -> str:
    user_id = current_user.get("user_id")
    auth_code = (
        await db.execute(select(AuthCode).where(AuthCode.user_id == user_id))
    ).scalars().first()
    if not auth_code:
        raise NotFoundException("未找到授权信息")
    await lock_auth_code(db, auth_code.id)
    device = (
        await db.execute(
            select(Device).where(Device.id == device_id, Device.auth_code_id == auth_code.id)
            .with_for_update().execution_options(populate_existing=True)
        )
    ).scalars().first()
    if not device:
        raise NotFoundException("设备不存在或不属于您")
    device_count = len((await db.execute(
        select(Device.id).where(Device.auth_code_id == auth_code.id).with_for_update()
    )).scalars().all())
    if device_count <= 1:
        raise ConflictException("至少需要保留一个设备")
    device_name = device.device_name or "未知设备"
    await _release_device_seat(db, device)
    await db.delete(device)
    await db.commit()
    return device_name
