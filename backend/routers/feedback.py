"""
工单反馈路由模块（优化版）
使用服务层 + 统一响应格式 + 分页
"""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_admin, get_current_user
from core.pagination import PaginationParams
from database import get_db
from schemas import FeedbackCreate, FeedbackUpdate
from schemas.feedback import (
    FeedbackDeleteEnvelope,
    FeedbackDetailEnvelope,
    FeedbackItemEnvelope,
    FeedbackListEnvelope,
    FeedbackStatsEnvelope,
)
from services.feedback_service import FeedbackService

router = APIRouter()


@router.get("", response_model=FeedbackListEnvelope, response_model_exclude_unset=True)
async def get_feedback_list(
    status: str | None = Query(None, description="状态过滤"),
    user_id: int | None = Query(None, ge=1),
    platform_key: str | None = Query(None, description="平台标识 (amazon/aliexpress)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取工单列表（管理员，带分页）"""
    service = FeedbackService(db)
    pagination = PaginationParams(page=page, page_size=page_size)
    return await service.get_feedback_list(status=status, user_id=user_id, platform_key=platform_key, pagination=pagination)


@router.get("/stats", response_model=FeedbackStatsEnvelope, response_model_exclude_unset=True)
async def get_feedback_stats(
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取工单统计"""
    service = FeedbackService(db)
    return await service.get_feedback_stats()


@router.get("/my", response_model=FeedbackListEnvelope, response_model_exclude_unset=True)
async def get_my_feedback(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """获取我的工单列表（用户）"""
    service = FeedbackService(db)
    pagination = PaginationParams(page=page, page_size=page_size)
    return await service.get_feedback_list(
        user_id=current_user.get("user_id"),
        pagination=pagination
    )


@router.get("/{feedback_id}", response_model=FeedbackDetailEnvelope, response_model_exclude_unset=True)
async def get_feedback(
    feedback_id: int,
    platform_key: str | None = Query(None, pattern="^(amazon|aliexpress)$"),
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """获取工单详情"""
    service = FeedbackService(db)
    return await service.get_feedback_by_id(feedback_id, platform_key=platform_key)


@router.post("", response_model=FeedbackItemEnvelope, response_model_exclude_unset=True)
async def create_feedback(
    req: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """创建工单"""
    service = FeedbackService(db)
    data = req.model_dump()
    data["user_id"] = current_user.get("user_id")
    return await service.create_feedback(data)


@router.put("/{feedback_id}", response_model=FeedbackItemEnvelope, response_model_exclude_unset=True)
async def update_feedback(
    feedback_id: int,
    req: FeedbackUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """更新工单（管理员回复等）"""
    service = FeedbackService(db)
    return await service.update_feedback(
        feedback_id,
        req.model_dump(exclude_none=True),
        actor=actor,
        request=request,
    )


@router.delete("/{feedback_id}", response_model=FeedbackDeleteEnvelope, response_model_exclude_unset=True)
async def delete_feedback(
    feedback_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """删除工单"""
    service = FeedbackService(db)
    return await service.delete_feedback(feedback_id, actor=actor, request=request)
