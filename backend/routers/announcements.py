"""公告管理与用户消息中心路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_admin, get_current_user
from core.deprecation import log_deprecated_api_call
from core.response import success_response
from database import get_db
from domains.announcements import service
from domains.announcements.schemas import (
    AnnouncementCreate,
    AnnouncementDeleteResponse,
    AnnouncementEnvelope,
    AnnouncementListResponse,
    AnnouncementReceiptEnvelope,
    AnnouncementUpdate,
    LegacyAnnouncementListResponse,
    ReceiptAction,
)

router = APIRouter()


@router.get("", response_model=AnnouncementListResponse)
async def list_announcements(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, object] = Depends(get_current_admin),
) -> object:
    return success_response(data=await service.list_admin(db, status))


@router.get("/active", response_model=LegacyAnnouncementListResponse)
async def get_active_announcements(request: Request, db: AsyncSession = Depends(get_db)) -> object:
    """兼容旧客户端：只返回面向所有人的有效公告。"""
    log_deprecated_api_call(request, "/api/announcements/active")
    return success_response(data=await service.list_legacy_active(db))


@router.get("/feed", response_model=AnnouncementListResponse)
async def get_announcement_feed(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, object] = Depends(get_current_user),
) -> object:
    return success_response(data=await service.feed(db, current_user))


@router.get("/release-notes/{version}", response_model=AnnouncementListResponse)
async def get_release_notes(
    version: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, object] = Depends(get_current_user),
) -> object:
    return success_response(data=await service.release_notes(db, version, current_user))


@router.post("/{announcement_id}/read", response_model=AnnouncementReceiptEnvelope)
async def mark_announcement_read(
    announcement_id: int,
    data: ReceiptAction | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, object] = Depends(get_current_user),
) -> object:
    return success_response(data=await service.record_receipt(db, announcement_id, current_user, "read", data.revision if data else None))


@router.post("/{announcement_id}/dismiss", response_model=AnnouncementReceiptEnvelope)
async def dismiss_announcement(
    announcement_id: int,
    data: ReceiptAction | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, object] = Depends(get_current_user),
) -> object:
    return success_response(data=await service.record_receipt(db, announcement_id, current_user, "dismiss", data.revision if data else None))


@router.post("", response_model=AnnouncementEnvelope)
async def create_announcement(
    data: AnnouncementCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, object] = Depends(get_current_admin),
) -> object:
    announcement = await service.create(db, data, actor=actor, request=request)
    return success_response(data=service.serialize(announcement), message="公告已创建")


@router.put("/{announcement_id}", response_model=AnnouncementEnvelope)
async def update_announcement(
    announcement_id: int,
    data: AnnouncementUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, object] = Depends(get_current_admin),
) -> object:
    announcement = await service.update(
        db,
        announcement_id,
        data,
        actor=actor,
        request=request,
    )
    return success_response(data=service.serialize(announcement), message="公告已更新")


@router.delete("/{announcement_id}", response_model=AnnouncementDeleteResponse)
async def delete_announcement(
    announcement_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, object] = Depends(get_current_admin),
) -> object:
    await service.delete(db, announcement_id, actor=actor, request=request)
    return success_response(message="公告已删除")
