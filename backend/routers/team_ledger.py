"""Restricted private team-accounting endpoints, with no automatic transfers."""

from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_commerce_operator, require_super_admin
from core.response import APIResponse
from database import get_db
from domains.team_ledger.policy_template import latest_policy_template
from domains.team_ledger.service import TeamLedgerService
from models.team_ledger import (
    TeamLedgerEntry,
    TeamMember,
    TeamOrderAllocation,
    TeamOwnership,
    TeamPolicy,
    TeamRefundReview,
    TeamServiceDelivery,
    TeamSettlement,
)
from schemas.team_ledger import (
    AdjustmentInput,
    AllocationInput,
    AllocationResponse,
    ConfirmInput,
    EntryBalanceResponse,
    EntryResponse,
    MemberInput,
    MemberResponse,
    MemberUpdate,
    OwnershipInput,
    OwnershipResponse,
    OwnershipUpdate,
    PartialRefundInput,
    PaymentInput,
    PolicyInput,
    PolicyResponse,
    PolicyUpdate,
    PreviewInput,
    RefundResolveInput,
    RefundResponse,
    ReleaseInput,
    ServiceDeliveryInput,
    ServiceDeliveryResponse,
    SettlementResponse,
    SummaryResponse,
    VersionInput,
)

router = APIRouter()


def envelope(data: object) -> dict[str, Any]:
    return {"success": True, "message": "ok", "data": data}


@router.get("/policy-template", response_model=APIResponse[PolicyInput], response_model_exclude_unset=True)
async def policy_template(response: Response, _actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    """Preview only: no import, activation, ownership, or historical mutation."""
    response.headers["Cache-Control"] = "private, no-store"
    return envelope(latest_policy_template().model_dump(mode="json"))


@router.get("/policies", response_model=APIResponse[list[PolicyResponse]], response_model_exclude_unset=True)
async def policies(db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamPolicy))


@router.post("/policies", response_model=APIResponse[PolicyResponse], response_model_exclude_unset=True)
async def create_policy(data: PolicyInput, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).create_policy(data, actor))


@router.put("/policies/{identity}", response_model=APIResponse[PolicyResponse], response_model_exclude_unset=True)
async def update_policy(identity: int, data: PolicyUpdate, db: AsyncSession = Depends(get_db),
                        actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).update_policy(identity, data, actor))


@router.post("/policies/{identity}/activate", response_model=APIResponse[PolicyResponse], response_model_exclude_unset=True)
async def activate_policy(identity: int, data: VersionInput, db: AsyncSession = Depends(get_db),
                          actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).activate_policy(identity, data.expected_version, actor))


@router.get("/members", response_model=APIResponse[list[MemberResponse]], response_model_exclude_unset=True)
async def members(db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamMember))


@router.post("/members", response_model=APIResponse[MemberResponse], response_model_exclude_unset=True)
async def create_member(data: MemberInput, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).create_member(data, actor))


@router.put("/members/{identity}", response_model=APIResponse[MemberResponse], response_model_exclude_unset=True)
async def update_member(identity: int, data: MemberUpdate, db: AsyncSession = Depends(get_db),
                        actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).update_member(identity, data, actor))


@router.get("/ownerships", response_model=APIResponse[list[OwnershipResponse]], response_model_exclude_unset=True)
async def ownerships(policy_id: int | None = None, product_sku: str | None = None,
                     db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamOwnership, policy_id=policy_id, product_sku=product_sku))


@router.post("/ownerships", response_model=APIResponse[OwnershipResponse], response_model_exclude_unset=True)
async def create_ownership(data: OwnershipInput, db: AsyncSession = Depends(get_db),
                           actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).save_ownership(data, actor))


@router.put("/ownerships/{identity}", response_model=APIResponse[OwnershipResponse], response_model_exclude_unset=True)
async def update_ownership(identity: int, data: OwnershipUpdate, db: AsyncSession = Depends(get_db),
                           actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).save_ownership(data, actor, identity))


@router.get("/allocations", response_model=APIResponse[list[AllocationResponse]], response_model_exclude_unset=True)
async def allocations(product_sku: str | None = None, period: str | None = None,
                       db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamOrderAllocation, product_sku=product_sku, period=period))


@router.put("/orders/{order_id}/allocation", response_model=APIResponse[AllocationResponse], response_model_exclude_unset=True)
async def set_allocation(order_id: int, data: AllocationInput, db: AsyncSession = Depends(get_db),
                         actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).set_allocation(order_id, data, actor))


@router.get("/settlements", response_model=APIResponse[list[SettlementResponse]], response_model_exclude_unset=True)
async def settlements(product_sku: str | None = None, period: str | None = None,
                       db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamSettlement, product_sku=product_sku, period=period))


@router.post("/settlements/preview", response_model=APIResponse[SettlementResponse], response_model_exclude_unset=True)
async def preview(data: PreviewInput, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).preview(data, actor))


@router.post("/settlements/{identity}/confirm", response_model=APIResponse[SettlementResponse], response_model_exclude_unset=True)
async def confirm(identity: int, data: ConfirmInput, db: AsyncSession = Depends(get_db),
                   actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).confirm(identity, data, actor))


@router.get("/summary", response_model=APIResponse[SummaryResponse], response_model_exclude_unset=True)
async def summary(db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).summary())


@router.get("/entries", response_model=APIResponse[list[EntryResponse]], response_model_exclude_unset=True)
async def entries(member_id: int | None = None, order_id: int | None = None, settlement_id: int | None = None,
                   limit: int = Query(default=200, ge=1, le=1000),
                   db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamLedgerEntry, member_id=member_id,
                                                         order_id=order_id, settlement_id=settlement_id, limit=limit))


@router.get("/entries/{identity}/balance", response_model=APIResponse[EntryBalanceResponse], response_model_exclude_unset=True)
async def entry_balance(identity: int, db: AsyncSession = Depends(get_db),
                         _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).entry_balance(identity))


@router.post("/payments", response_model=APIResponse[EntryResponse], response_model_exclude_unset=True)
async def payment(data: PaymentInput, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).payment(data, actor))


@router.post("/entries/{identity}/release", response_model=APIResponse[EntryResponse], response_model_exclude_unset=True)
async def release(identity: int, data: ReleaseInput, db: AsyncSession = Depends(get_db),
                   actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).release_held(identity, data, actor))


@router.get("/refund-reviews", response_model=APIResponse[list[RefundResponse]], response_model_exclude_unset=True)
async def refund_reviews(status: str | None = None, db: AsyncSession = Depends(get_db),
                          _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamRefundReview, status=status))


@router.post("/orders/{order_id}/partial-refund", response_model=APIResponse[RefundResponse], response_model_exclude_unset=True)
async def partial_refund(order_id: int, data: PartialRefundInput, db: AsyncSession = Depends(get_db),
                         actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).partial_refund(order_id, data, actor))


@router.post("/entries/{identity}/adjust", response_model=APIResponse[EntryResponse], response_model_exclude_unset=True)
async def adjustment(identity: int, data: AdjustmentInput, db: AsyncSession = Depends(get_db),
                       actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).adjustment(identity, data, actor))


@router.get("/service-deliveries", response_model=APIResponse[list[ServiceDeliveryResponse]], response_model_exclude_unset=True)
async def service_deliveries(order_id: int | None = None, db: AsyncSession = Depends(get_db),
                             _actor: dict = Depends(require_commerce_operator)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).list_rows(TeamServiceDelivery, order_id=order_id))


@router.put("/orders/{order_id}/service-deliveries/{service_code}", response_model=APIResponse[ServiceDeliveryResponse], response_model_exclude_unset=True)
async def confirm_service_delivery(order_id: int, service_code: str, data: ServiceDeliveryInput,
                                   db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).service_delivery(order_id, service_code, data, actor))


@router.post("/refund-reviews/{identity}/resolve", response_model=APIResponse[RefundResponse], response_model_exclude_unset=True)
async def resolve_refund(identity: int, data: RefundResolveInput, db: AsyncSession = Depends(get_db),
                          actor: dict = Depends(require_super_admin)) -> dict[str, Any]:
    return envelope(await TeamLedgerService(db).resolve_refund(identity, data, actor))
