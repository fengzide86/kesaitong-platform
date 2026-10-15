"""Read models and transactions for administrator-managed catalog settings."""

from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.config import settings
from core.logging import get_logger
from models import Setting

from .tool_config import DEFAULT_CATEGORIES, force_demo_only_tool_configs, normalize_tool_configs

logger = get_logger(__name__)

DEFAULT_PLATFORMS: list[dict[str, Any]] = [
    {
        "key": "amazon",
        "name": "亚马逊",
        "short_name": "亚马逊",
        "status": "available",
        "sort_order": 1,
    },
    {
        "key": "aliexpress",
        "name": "速卖通",
        "short_name": "速卖通",
        "status": "available",
        "sort_order": 2,
    },
]


async def _get_setting(db: AsyncSession, key: str) -> Setting | None:
    result = await db.execute(select(Setting).where(Setting.key == key))
    return result.scalars().first()


async def _commit_or_rollback(db: AsyncSession) -> None:
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise


async def list_categories(db: AsyncSession) -> list[Any]:
    setting = await _get_setting(db, "tool_categories")
    if setting and setting.value:
        loaded = json.loads(setting.value)
        return loaded
    return DEFAULT_CATEGORIES


async def list_tools(
    db: AsyncSession,
    *,
    category: str | None,
    search: str | None,
    platform_key: str | None,
) -> list[dict[str, Any]]:
    setting = await _get_setting(db, "tool_configs")
    tools: list[dict[str, Any]] = []
    if setting and setting.value:
        tools = json.loads(setting.value)

    tools = normalize_tool_configs(tools)
    if settings.TOOL_EXECUTION_MODE == "demo":
        tools = force_demo_only_tool_configs(tools)
    if platform_key and platform_key != "all":
        tools = [tool for tool in tools if tool.get("platform_key") == platform_key]
    if category and category != "all":
        tools = [tool for tool in tools if tool.get("category") == category]
    if search:
        lowered = search.lower()
        tools = [
            tool
            for tool in tools
            if lowered in str(tool.get("name", "")).lower()
            or lowered in str(tool.get("module", "")).lower()
            or lowered in str(tool.get("description", "")).lower()
        ]
    return sorted(tools, key=lambda tool: tool.get("sort_order", 0))


async def update_tools(
    db: AsyncSession,
    tools: list[dict[str, Any]],
    *,
    actor: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    setting = await _get_setting(db, "tool_configs")
    before = json.loads(setting.value) if setting and setting.value else []
    normalized_tools = normalize_tool_configs(tools)
    if settings.TOOL_EXECUTION_MODE == "demo":
        normalized_tools = force_demo_only_tool_configs(normalized_tools)
    encoded = json.dumps(normalized_tools, ensure_ascii=False)
    if setting:
        setting.value = encoded
    else:
        db.add(Setting(key="tool_configs", value=encoded))

    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="demo_tool_config_update",
        target_type="tool_configs",
        target_id="all",
        detail={
            "role": actor.get("role"),
            "before": before,
            "after": normalized_tools,
            "reason": None,
        },
        request=request,
    )
    await _commit_or_rollback(db)
    logger.info("工具配置已更新")
    return {"success": True, "data": normalized_tools}


async def update_categories(
    db: AsyncSession,
    categories: list[Any],
    *,
    actor: dict[str, Any],
    request: Request,
) -> dict[str, bool]:
    setting = await _get_setting(db, "tool_categories")
    before = json.loads(setting.value) if setting and setting.value else DEFAULT_CATEGORIES
    encoded = json.dumps(categories, ensure_ascii=False)
    if setting:
        setting.value = encoded
    else:
        db.add(Setting(key="tool_categories", value=encoded))

    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="demo_tool_categories_update",
        target_type="tool_categories",
        target_id="all",
        detail={
            "role": actor.get("role"),
            "before": before,
            "after": categories,
            "reason": None,
        },
        request=request,
    )
    await _commit_or_rollback(db)
    logger.info("工具分类配置已更新")
    return {"success": True}


async def list_platforms(db: AsyncSession) -> list[Any]:
    setting = await _get_setting(db, "platform_configs")
    platforms = json.loads(setting.value) if setting and setting.value else DEFAULT_PLATFORMS
    return sorted(platforms, key=lambda platform: platform.get("sort_order", 0))


async def update_platforms(
    db: AsyncSession,
    platforms: list[Any],
    *,
    actor: dict[str, Any],
    request: Request,
) -> dict[str, bool]:
    setting = await _get_setting(db, "platform_configs")
    before = json.loads(setting.value) if setting and setting.value else DEFAULT_PLATFORMS
    encoded = json.dumps(platforms, ensure_ascii=False)
    if setting:
        setting.value = encoded
    else:
        db.add(Setting(key="platform_configs", value=encoded))

    await log_admin_action(
        db,
        user_id=actor.get("staff_id"),
        user_name=actor.get("username"),
        action="platform_config_update",
        target_type="platform_configs",
        target_id="all",
        detail={
            "role": actor.get("role"),
            "before": before,
            "after": platforms,
            "reason": None,
        },
        request=request,
    )
    await _commit_or_rollback(db)
    logger.info("平台配置已更新")
    return {"success": True}
