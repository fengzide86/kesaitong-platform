from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from fastapi import HTTPException, Request, status
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from domains.access import resolve_product_access
from domains.announcements.schemas import AnnouncementCreate, AnnouncementUpdate
from models import Announcement, AnnouncementReceipt

CATEGORY_DEFAULTS = {
    "system": ("important", "modal"),
    "maintenance": ("critical", "modal"),
    "update": ("info", "banner"),
    "activity": ("info", "banner"),
}


def serialize(announcement: Announcement, receipt: AnnouncementReceipt | None = None) -> dict[str, object]:
    return {
        "id": announcement.id,
        "title": announcement.title,
        "content": announcement.content,
        "type": announcement.category or announcement.type,
        "audience": announcement.audience,
        "category": announcement.category,
        "severity": announcement.severity,
        "presentation": announcement.presentation,
        "app_version": announcement.app_version,
        "status": announcement.status,
        "priority": announcement.priority,
        "starts_at": announcement.starts_at.isoformat() if announcement.starts_at else None,
        "expires_at": announcement.expires_at.isoformat() if announcement.expires_at else None,
        "published_at": announcement.published_at.isoformat() if announcement.published_at else None,
        "revision": announcement.revision,
        "created_at": announcement.created_at.isoformat() if announcement.created_at else None,
        "updated_at": announcement.updated_at.isoformat() if announcement.updated_at else None,
        "is_read": bool(receipt and receipt.read_at),
        "is_dismissed": bool(receipt and receipt.dismissed_at),
    }


def _normalized_values(data: AnnouncementCreate | AnnouncementUpdate, existing: Announcement | None = None) -> dict[str, object]:
    values = data.model_dump(exclude_unset=True)
    legacy_type = values.pop("type", None)
    if legacy_type and "category" not in values:
        values["category"] = legacy_type if legacy_type in CATEGORY_DEFAULTS else "system"
    category = str(values.get("category") or getattr(existing, "category", None) or "system")
    if existing is None:
        default_severity, default_presentation = CATEGORY_DEFAULTS.get(category, ("info", "banner"))
        values.setdefault("severity", default_severity)
        values.setdefault("presentation", default_presentation)
    if values.get("severity") == "critical":
        values["presentation"] = "modal"
    values["type"] = category
    if values.get("status") == "published" and not getattr(existing, "published_at", None):
        values["published_at"] = datetime.now()
    return values


async def list_admin(db: AsyncSession, status_filter: str | None = None) -> list[dict[str, object]]:
    query = select(Announcement).order_by(desc(Announcement.priority), desc(Announcement.created_at))
    if status_filter:
        query = query.where(Announcement.status == status_filter)
    result = await db.execute(query)
    return [serialize(item) for item in result.scalars().all()]


async def list_legacy_active(db: AsyncSession) -> list[dict[str, object]]:
    now = datetime.now()
    result = await db.execute(
        select(Announcement).where(
            Announcement.status == "published",
            Announcement.audience == "all",
            or_(Announcement.starts_at.is_(None), Announcement.starts_at <= now),
            or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
        ).order_by(desc(Announcement.priority), desc(Announcement.created_at))
    )
    return [{
        "id": item.id, "title": item.title, "content": item.content,
        "type": item.category or item.type,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    } for item in result.scalars().all()]


async def feed(db: AsyncSession, current_user: dict[str, object]) -> list[dict[str, object]]:
    auth_code_id = current_user.get("auth_code_id")
    device_id = current_user.get("device_id")
    if not auth_code_id or not device_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前设备身份不完整")
    access = await resolve_product_access(db, cast(int, auth_code_id))
    audience = "business" if access.get("product_type") == "business" else "consumer"
    now = datetime.now()
    result = await db.execute(
        select(Announcement, AnnouncementReceipt)
        .outerjoin(AnnouncementReceipt, (
            (AnnouncementReceipt.announcement_id == Announcement.id)
            & (AnnouncementReceipt.auth_code_id == auth_code_id)
            & (AnnouncementReceipt.device_id == device_id)
            & (AnnouncementReceipt.revision == Announcement.revision)
        ))
        .where(
            Announcement.status == "published",
            Announcement.audience.in_(["all", audience]),
            or_(Announcement.starts_at.is_(None), Announcement.starts_at <= now),
            or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
        )
        .order_by(desc(Announcement.priority), desc(Announcement.published_at), desc(Announcement.created_at))
    )
    return [serialize(announcement, receipt) for announcement, receipt in result.all()]


async def release_notes(
    db: AsyncSession,
    version: str,
    current_user: dict[str, object],
) -> list[dict[str, object]]:
    auth_code_id = current_user.get("auth_code_id")
    audiences = ["all"]
    if auth_code_id:
        access = await resolve_product_access(db, cast(int, auth_code_id))
        audiences.append("business" if access.get("product_type") == "business" else "consumer")
    now = datetime.now()
    result = await db.execute(
        select(Announcement).where(
            Announcement.status == "published",
            Announcement.category == "update",
            Announcement.app_version == version,
            Announcement.audience.in_(audiences),
            or_(Announcement.starts_at.is_(None), Announcement.starts_at <= now),
            or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
        ).order_by(desc(Announcement.priority), desc(Announcement.published_at))
    )
    return [serialize(item) for item in result.scalars().all()]


async def create(
    db: AsyncSession,
    data: AnnouncementCreate,
    actor: dict[str, Any] | None = None,
    request: Request | None = None,
) -> Announcement:
    announcement = Announcement(**_normalized_values(data))
    db.add(announcement)
    await db.flush()
    if actor:
        await log_admin_action(
            db,
            user_id=actor.get("staff_id"),
            user_name=actor.get("username"),
            action="announcement_create",
            target_type="announcement",
            target_id=announcement.id,
            detail={
                "role": actor.get("role"),
                "before": None,
                "after": serialize(announcement),
                "reason": None,
            },
            request=request,
        )
    await db.commit()
    await db.refresh(announcement)
    return announcement


async def update(
    db: AsyncSession,
    announcement_id: int,
    data: AnnouncementUpdate,
    actor: dict[str, Any] | None = None,
    request: Request | None = None,
) -> Announcement:
    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")
    before = serialize(announcement)
    values = _normalized_values(data, announcement)
    meaningful = {"title", "content", "audience", "category", "severity", "presentation", "app_version", "starts_at", "expires_at"}
    if any(key in values and values[key] != getattr(announcement, key) for key in meaningful):
        announcement.revision = (announcement.revision or 1) + 1
    for key, value in values.items():
        setattr(announcement, key, value)
    if actor:
        await log_admin_action(
            db,
            user_id=actor.get("staff_id"),
            user_name=actor.get("username"),
            action="announcement_update",
            target_type="announcement",
            target_id=announcement.id,
            detail={
                "role": actor.get("role"),
                "before": before,
                "after": serialize(announcement),
                "reason": None,
            },
            request=request,
        )
    await db.commit()
    await db.refresh(announcement)
    return announcement


async def delete(
    db: AsyncSession,
    announcement_id: int,
    *,
    actor: dict[str, Any],
    request: Request | None = None,
) -> None:
    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")
    before = serialize(announcement)
    await db.delete(announcement)
    await log_admin_action(
        db,
        user_id=cast(int | None, actor.get("staff_id")),
        user_name=cast(str | None, actor.get("username")),
        action="announcement_delete",
        target_type="announcement",
        target_id=announcement.id,
        detail={
            "role": actor.get("role"),
            "before": before,
            "after": {"deleted": True},
            "reason": None,
        },
        request=request,
    )
    await db.commit()


async def record_receipt(db: AsyncSession, announcement_id: int, current_user: dict[str, object], action: str, viewed_revision: int | None = None) -> dict[str, object]:
    auth_code_id = current_user.get("auth_code_id")
    device_id = current_user.get("device_id")
    if not auth_code_id or not device_id:
        raise HTTPException(status_code=403, detail="当前设备身份不完整")
    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")
    # Bodyless legacy clients cannot identify which revision they saw. Keep
    # their original (revision 1) receipt behavior, but never assume they saw
    # an edited announcement. New clients must send the displayed revision.
    receipt_revision = viewed_revision if viewed_revision is not None else 1
    if receipt_revision != announcement.revision:
        raise HTTPException(status_code=409, detail={
            "code": "ANNOUNCEMENT_REVISION_CONFLICT" if viewed_revision is not None else "ANNOUNCEMENT_REVISION_REQUIRED",
            "message": "公告内容已更新，请重新读取后确认" if viewed_revision is not None else "公告内容已更新，请更新客户端后重新读取并确认",
        })
    result = await db.execute(select(AnnouncementReceipt).where(
        AnnouncementReceipt.announcement_id == announcement_id,
        AnnouncementReceipt.auth_code_id == auth_code_id,
        AnnouncementReceipt.device_id == device_id,
        AnnouncementReceipt.revision == receipt_revision,
    ))
    receipt = result.scalar_one_or_none()
    if not receipt:
        receipt = AnnouncementReceipt(
            announcement_id=announcement_id, auth_code_id=auth_code_id,
            device_id=device_id, revision=receipt_revision,
        )
        db.add(receipt)
    now = datetime.now()
    receipt.read_at = receipt.read_at or now
    if action == "dismiss":
        receipt.dismissed_at = now
    await db.commit()
    # A publication racing the write must not change the receipt target or
    # response: this acknowledgement belongs only to the version just checked.
    return {"announcement_id": announcement_id, "revision": receipt_revision, "action": action}
