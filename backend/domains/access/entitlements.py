"""C/B 产品权限解析，所有 B 端接口统一从数据库实时校验。"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from database import get_db
from models import AuthCode, Order, Plan, Setting
from models.commercial import CommercialGrant, CommercialRefundEntitlementReview, TrialQuota

from .plan_identity import fixed_plan_entitlements

DEFAULT_ENTITLEMENTS = {
    "batch_execution": False,
    "multi_account_workspace": False,
    "desktop_notification": True,
    "usage_metering": False,
    "max_batch_rows": 50,
    "max_open_sessions": 6,
}


def normalize_entitlements(value: Any, product_type: str = "consumer") -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value or "{}")
        except (TypeError, ValueError):
            value = {}
    source = value if isinstance(value, dict) else {}
    normalized = {**DEFAULT_ENTITLEMENTS, **source}
    normalized["batch_execution"] = bool(normalized.get("batch_execution"))
    normalized["multi_account_workspace"] = bool(normalized.get("multi_account_workspace"))
    normalized["desktop_notification"] = bool(normalized.get("desktop_notification", True))
    normalized["usage_metering"] = bool(normalized.get("usage_metering"))
    normalized["max_batch_rows"] = min(max(int(normalized.get("max_batch_rows") or 50), 1), 1000)
    normalized["max_open_sessions"] = min(max(int(normalized.get("max_open_sessions") or 6), 2), 10)
    if product_type != "business":
        normalized["batch_execution"] = False
        normalized["multi_account_workspace"] = False
    return normalized


def serialize_entitlements(value: Any, product_type: str) -> str:
    return json.dumps(normalize_entitlements(value, product_type), ensure_ascii=False)


async def _global_business_enabled(db: AsyncSession) -> bool:
    result = await db.execute(select(Setting.value).where(Setting.key == "business_workspace_enabled"))
    value = result.scalar()
    return str(value or "false").strip().lower() in {"1", "true", "yes", "on"}


async def resolve_product_access(db: AsyncSession, auth_code_id: int | None) -> dict:
    if not auth_code_id:
        return {"product_type": "consumer", "entitlements": normalize_entitlements({}, "consumer"), "enabled": False}
    result = await db.execute(
        select(AuthCode, Plan).outerjoin(Plan, AuthCode.plan_id == Plan.id).where(AuthCode.id == auth_code_id)
    )
    row = result.first()
    if not row:
        return {"product_type": "consumer", "entitlements": normalize_entitlements({}, "consumer"), "enabled": False}
    auth_code, plan = row
    commercial = await db.scalar(select(CommercialGrant).where(CommercialGrant.auth_code_id == auth_code.id))
    if commercial:
        snapshot = json.loads(commercial.snapshot)
        allowed = snapshot["definition"]["allowed_capabilities"]
        if commercial.status != "active" or commercial.ends_at <= datetime.utcnow():
            allowed = []
        if commercial.order_id:
            order = await db.get(Order, commercial.order_id)
            if not order or order.status != "paid":
                allowed = []
            elif order.refund_amount:
                review = await db.scalar(select(CommercialRefundEntitlementReview).where(
                    CommercialRefundEntitlementReview.order_id == order.id,
                    CommercialRefundEntitlementReview.refund_amount_snapshot == order.refund_amount,
                ))
                retained = json.loads(review.retained_capabilities) if review else []
                allowed = [capability for capability in allowed if capability in retained]
        quotas = (await db.scalars(select(TrialQuota).where(TrialQuota.grant_id == commercial.id))).all()
        unavailable = {quota.capability for quota in quotas if quota.available == 0}
        allowed = [capability for capability in allowed if capability not in unavailable]
        return {
            "auth_code": auth_code, "plan": plan, "product_type": "consumer", "enabled": False,
            "plan_name": snapshot["definition"]["name"],
            "entitlements": normalize_entitlements({"allowed_capabilities": allowed,
                                                     "commercial_grant_id": commercial.id, "plan_code": snapshot["sku"],
                                                     "trial_quotas": {quota.capability: {"available": quota.available, "consumed": quota.consumed} for quota in quotas}}, "consumer"),
        }
    product_type = (getattr(plan, "product_type", None) or "consumer").lower()
    entitlements = normalize_entitlements(
        fixed_plan_entitlements(getattr(plan, "name", None), getattr(plan, "entitlements", None)),
        product_type,
    )
    enabled = await _global_business_enabled(db)
    return {
        "auth_code": auth_code,
        "plan": plan,
        "product_type": product_type,
        "entitlements": entitlements,
        "enabled": enabled,
    }


async def require_business_access(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    context = await resolve_product_access(db, current_user.get("auth_code_id"))
    entitlements = context["entitlements"]
    if (
        not context.get("enabled")
        or context.get("product_type") != "business"
        or not entitlements.get("batch_execution")
        or not entitlements.get("multi_account_workspace")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前授权不包含专业批量工作台")
    return {**current_user, **context}
