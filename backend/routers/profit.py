"""Read-only profit ledger plus versioned policy management."""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_commerce_operator, require_super_admin
from database import get_db
from schemas.profit import (
    ProfitPolicyEnvelope,
    ProfitPolicyUpdate,
    ProfitRecordPageResponse,
    ProfitSummaryResponse,
)
from services.profit_service import ProfitService, _serialize_ratios

router = APIRouter()


@router.get("", response_model=ProfitRecordPageResponse, response_model_exclude_unset=True)
async def get_profit_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    platform_key: str | None = None,
    ledger_status: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _staff: dict[str, object] = Depends(require_commerce_operator),
) -> object:
    return await ProfitService(db).list_records(
        page,
        page_size,
        platform_key,
        ledger_status,
    )


@router.get("/summary", response_model=ProfitSummaryResponse)
async def get_profit_summary(
    platform_key: str | None = None,
    db: AsyncSession = Depends(get_db),
    _staff: dict[str, object] = Depends(require_commerce_operator),
) -> object:
    return await ProfitService(db).summary(platform_key)


@router.get("/policy", response_model=ProfitPolicyEnvelope, response_model_exclude_unset=True)
async def get_profit_policy(
    db: AsyncSession = Depends(get_db),
    _staff: dict[str, object] = Depends(require_commerce_operator),
) -> object:
    version, ratios = await ProfitService(db).get_policy()
    return {
        "success": True,
        "message": "ok",
        "data": {"version": version, "ratios": _serialize_ratios(ratios)},
    }


@router.put("/policy", response_model=ProfitPolicyEnvelope, response_model_exclude_unset=True)
async def update_profit_policy(
    req: ProfitPolicyUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, object] = Depends(require_super_admin),
) -> object:
    policy = await ProfitService(db).update_policy(req.ratios, actor, request, req.expected_version)
    return {"success": True, "message": "分润策略已更新", "data": policy}
