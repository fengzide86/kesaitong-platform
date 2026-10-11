"""管理端行动中心。"""

from datetime import datetime, timedelta
from typing import Any, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_admin
from core.response import success_response
from core.timestamps import utc_iso
from database import get_db
from domains.access import effective_license_status_sql
from domains.commerce import ExpenseService
from domains.commerce.agency import AgencyService
from domains.platform.action_center_schemas import (
    ActionCenterResponse,
    FeatureDisabledResponse,
)
from models import AuthCode, AuthSeat, Device, Feedback

router = APIRouter()


@router.get("/action-center", response_model=ActionCenterResponse)
async def get_action_center(
    _admin: dict[str, Any] = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Existing authorization expiry fields use server-local wall time; keep
    # this business rule until historical authorization dates are reconciled.
    now = datetime.now()
    expiry_limit = now + timedelta(days=7)
    expiring_conditions = (
        effective_license_status_sql(now=now).in_(["active", "unused"]),
        AuthCode.expires_at.is_not(None),
        AuthCode.expires_at > now,
        AuthCode.expires_at <= expiry_limit,
    )
    expiring_count = int((await db.execute(select(func.count(AuthCode.id)).where(*expiring_conditions))).scalar() or 0)
    expiring_result = await db.execute(
        select(AuthCode).where(*expiring_conditions).order_by(AuthCode.expires_at).limit(20)
    )
    expiring = expiring_result.scalars().all()

    seat_counts = (
        select(AuthSeat.auth_code_id, func.count(AuthSeat.id).label("used"))
        .where(AuthSeat.status == "active")
        .group_by(AuthSeat.auth_code_id)
        .subquery()
    )
    device_counts = (
        select(Device.auth_code_id, func.count(Device.id).label("used")).group_by(Device.auth_code_id).subquery()
    )
    anomaly_result = await db.execute(
        select(AuthCode, func.coalesce(seat_counts.c.used, 0), func.coalesce(device_counts.c.used, 0))
        .outerjoin(seat_counts, AuthCode.id == seat_counts.c.auth_code_id)
        .outerjoin(device_counts, AuthCode.id == device_counts.c.auth_code_id)
        .where(or_(seat_counts.c.used > AuthCode.seat_limit, device_counts.c.used > AuthCode.max_devices))
        .limit(20)
    )
    anomalies = anomaly_result.all()
    anomaly_count = int(
        (
            await db.execute(
                select(func.count(AuthCode.id))
                .outerjoin(seat_counts, AuthCode.id == seat_counts.c.auth_code_id)
                .outerjoin(device_counts, AuthCode.id == device_counts.c.auth_code_id)
                .where(or_(seat_counts.c.used > AuthCode.seat_limit, device_counts.c.used > AuthCode.max_devices))
            )
        ).scalar()
        or 0
    )

    pending_ticket_count = int(
        (await db.execute(select(func.count(Feedback.id)).where(Feedback.status == "pending"))).scalar() or 0
    )
    feedback_result = await db.execute(
        select(Feedback).where(Feedback.status == "pending").order_by(Feedback.created_at).limit(20)
    )
    tickets = feedback_result.scalars().all()
    expense_service = ExpenseService(db)
    renewal_items = await expense_service.due_items() if _admin.get("role") in {"super_admin", "operator"} else []
    renewal_count = await expense_service.due_count() if _admin.get("role") in {"super_admin", "operator"} else 0
    delivery_tasks = await AgencyService(db, _admin).delivery_tasks() if _admin.get("role") == "super_admin" else []

    return success_response(
        {
            "summary": {
                "expiring_authorizations": expiring_count,
                "device_anomalies": anomaly_count,
                "pending_tickets": pending_ticket_count,
                "waiting_interventions": 0,
                "stale_batches": 0,
                "expense_renewals_due": renewal_count,
            },
            "expiring_authorizations": [
                {
                    "id": item.id,
                    "code_masked": f"{item.code[:4]}***{item.code[-3:]}",
                    "expires_at": item.expires_at.astimezone().isoformat() if item.expires_at else None,
                }
                for item in expiring
            ],
            "device_anomalies": [
                {
                    "auth_code_id": code.id,
                    "code_masked": f"{code.code[:4]}***{code.code[-3:]}",
                    "seat_used": int(seat_used or 0),
                    "seat_limit": code.seat_limit or 1,
                    "device_used": int(device_used or 0),
                    "device_limit": code.max_devices or 1,
                }
                for code, seat_used, device_used in anomalies
            ],
            "pending_tickets": [
                {
                    "id": item.id,
                    "title": item.title or "用户反馈",
                    "priority": item.priority,
                    "created_at": utc_iso(item.created_at),
                }
                for item in tickets
            ],
            # Legacy Runner batches are intentionally excluded. Demo metrics live
            # under /api/demo and never masquerade as operational execution alerts.
            "waiting_interventions": [],
            "stale_batches": [],
            "expense_renewals": renewal_items,
            "agency_delivery_tasks": delivery_tasks,
        }
    )


@router.get(
    "/business-batches/{batch_id}",
    response_model=FeatureDisabledResponse,
    responses={status.HTTP_409_CONFLICT: {"model": FeatureDisabledResponse}},
)
async def get_business_batch(
    batch_id: int,
    _admin: dict[str, Any] = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> NoReturn:
    del batch_id, _admin, db
    raise HTTPException(
        status_code=409,
        detail={
            "code": "FEATURE_DISABLED",
            "message": "内部演示版不开放旧 Runner 批次详情",
        },
    )
