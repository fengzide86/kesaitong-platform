"""Settings read/write service for the platform control plane."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from models import Setting
from schemas import SettingResponse, SettingUpdate

PUBLIC_SETTING_KEYS = (
    "system_name",
    "logo_url",
    "service_wechat",
    "wechat_id",
    "terms_of_service",
    "default_announcement",
    "enable_ai_chat",
    "enable_auto_update",
)


def _response(setting: Setting) -> SettingResponse:
    return SettingResponse.model_validate(setting)


async def list_public(db: AsyncSession) -> list[SettingResponse]:
    result = await db.execute(
        select(Setting).where(Setting.key.in_(PUBLIC_SETTING_KEYS)).order_by(Setting.key)
    )
    return [_response(setting) for setting in result.scalars().all()]


async def list_admin(db: AsyncSession) -> list[SettingResponse]:
    result = await db.execute(
        select(Setting).where(
            Setting.key != "admin_password", ~Setting.key.startswith("transaction_guard:"),
        ).order_by(Setting.key)
    )
    return [_response(setting) for setting in result.scalars().all()]


async def update(
    db: AsyncSession,
    data: SettingUpdate,
    *,
    actor: dict[str, Any],
    request: Request,
) -> None:
    if data.key == "admin_password":
        raise HTTPException(status_code=422, detail="请使用后台账号密码接口")
    if data.key == "profit_ratios":
        raise HTTPException(status_code=422, detail="请使用带版本的分润策略接口")
    if data.key.startswith("transaction_guard:"):
        raise HTTPException(status_code=422, detail="内部事务保护配置不可修改")
    result = await db.execute(select(Setting).where(Setting.key == data.key).with_for_update())
    setting = result.scalars().first()
    before = (
        {"key": setting.key, "value": setting.value, "description": setting.description}
        if setting
        else None
    )
    if setting:
        setting.value = data.value
        if data.description:
            setting.description = data.description
    else:
        setting = Setting(key=data.key, value=data.value, description=data.description)
        db.add(setting)

    await db.flush()
    await log_admin_action(
        db,
        user_id=actor["staff_id"],
        user_name=actor["username"],
        action="setting_update",
        target_type="setting",
        target_id=data.key,
        detail={
            "role": actor["role"],
            "before": before,
            "after": {
                "key": setting.key,
                "value": setting.value,
                "description": setting.description,
            },
            "reason": None,
        },
        request=request,
    )
    await db.commit()
