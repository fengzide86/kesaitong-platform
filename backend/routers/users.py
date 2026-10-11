"""
用户管理路由模块（优化版）
使用服务层 + 统一响应格式 + 分页
"""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_admin
from core.pagination import PaginationParams
from database import get_db
from schemas import UserUpdate
from schemas.user import (
    UserDetailEnvelope,
    UserDevicesEnvelope,
    UserItemEnvelope,
    UserListEnvelope,
    UserStatsEnvelope,
)
from services.user_service import UserService

router = APIRouter()


@router.get("", response_model=UserListEnvelope, response_model_exclude_unset=True)
async def get_users(
    keyword: str | None = Query(None, description="关键词搜索"),
    platform_key: str | None = Query(None, pattern="^(amazon|aliexpress)$"),
    auth_code_id: int | None = Query(None, ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取用户列表（支持搜索和分页）"""
    service = UserService(db)
    pagination = PaginationParams(page=page, page_size=page_size)
    return await service.get_users_list(keyword=keyword, pagination=pagination, platform_key=platform_key, auth_code_id=auth_code_id)


@router.get("/stats", response_model=UserStatsEnvelope, response_model_exclude_unset=True)
async def get_user_stats(
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取用户统计"""
    service = UserService(db)
    return await service.get_user_stats()


@router.get("/{user_id}", response_model=UserDetailEnvelope, response_model_exclude_unset=True)
async def get_user(
    user_id: int,
    platform_key: str | None = Query(None, pattern="^(amazon|aliexpress)$"),
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取用户详情"""
    service = UserService(db)
    return await service.get_user_by_id(user_id, platform_key=platform_key)


@router.put("/{user_id}", response_model=UserItemEnvelope, response_model_exclude_unset=True)
async def update_user(
    user_id: int,
    req: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """更新用户信息"""
    service = UserService(db)
    return await service.update_user(
        user_id,
        req.model_dump(exclude_none=True),
        actor=actor,
        request=request,
    )


@router.get("/{user_id}/devices", response_model=UserDevicesEnvelope, response_model_exclude_unset=True)
async def get_user_devices(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取用户的设备列表"""
    service = UserService(db)
    return await service.get_user_devices(user_id)
