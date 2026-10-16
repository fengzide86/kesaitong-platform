"""Batch-read customer context through persisted foreign keys, never name matching."""

import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgencyCustomer, AuthCode, Order, Plan, User
from models.commercial import CommercialGrant

from .license_state import effective_license_status


async def authorization_context(db: AsyncSession, code_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not code_ids:
        return {}
    rows = (await db.execute(
        select(AuthCode, AgencyCustomer.name, Order.order_no, Order.responsible, Plan.name, CommercialGrant)
        .outerjoin(CommercialGrant, CommercialGrant.auth_code_id == AuthCode.id)
        .outerjoin(Order, Order.id == func.coalesce(AuthCode.order_id, CommercialGrant.order_id))
        .outerjoin(AgencyCustomer, AgencyCustomer.id == func.coalesce(AuthCode.customer_id, Order.customer_id))
        .outerjoin(Plan, Plan.id == AuthCode.plan_id)
        .where(AuthCode.id.in_(code_ids))
    )).all()
    users = (await db.execute(select(User.auth_code_id, User.id, User.name).where(
        User.auth_code_id.in_(code_ids),
    ).order_by(User.id))).all()
    labels: dict[int, list[str]] = {}
    for code_id, user_id, name in users:
        labels.setdefault(code_id, []).append(name or f"用户 #{user_id}")
    result = {}
    for code, customer, order_no, responsible, plan, grant in rows:
        if grant:
            snapshot = json.loads(grant.snapshot)
            plan = snapshot.get("definition", {}).get("name") or plan
        result[code.id] = {
            "customer_name": customer,
            "user_name": "、".join(labels.get(code.id, [])) or None,
            "project_id": grant.project_id if grant else None,
            "order_no": order_no,
            "responsible": responsible,
            "plan_name": plan,
            "status": effective_license_status(code),
            "expires_at": code.expires_at.isoformat() if code.expires_at else None,
        }
    return result
