"""Administrator-controlled products; no unauthenticated business-data feed."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user, require_commerce_operator, require_super_admin
from core.response import APIResponse
from database import get_db
from domains.commercial import CommercialService
from schemas.commercial import (
    CommercialGrantResponse,
    CommercialOrderCreate,
    CommercialOrderResponse,
    FulfillmentComplete,
    FulfillmentCompleteResponse,
    OfferCreate,
    OfferResponse,
    OfferUpdate,
    PublicCatalogResponse,
    RefundEntitlementReviewRequest,
    RefundEntitlementReviewResponse,
    RevisionRequest,
    ServiceFulfillmentResponse,
    ToolOptionResponse,
    TrialGrantCreate,
)

router = APIRouter()


def envelope(data: object) -> dict[str, object]:
    return {"success": True, "data": data}


@router.get("/offers", response_model=APIResponse[list[OfferResponse]], response_model_exclude_unset=True)
async def list_offers(db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).offers())


@router.post("/offers/seed-drafts", response_model=APIResponse[list[OfferResponse]], response_model_exclude_unset=True)
async def seed_offers(request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).seed_drafts(actor, request))


@router.post("/offers", response_model=APIResponse[OfferResponse], response_model_exclude_unset=True)
async def create_offer(req: OfferCreate, request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).create_draft(req.sku, req.definition, actor, request))


@router.patch("/offers/{offer_id}", response_model=APIResponse[OfferResponse], response_model_exclude_unset=True)
async def edit_offer(offer_id: int, req: OfferUpdate, request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).update_draft(offer_id, req.expected_revision, req.definition, actor, request))


@router.post("/offers/{offer_id}/activate", response_model=APIResponse[OfferResponse], response_model_exclude_unset=True)
async def activate_offer(offer_id: int, req: RevisionRequest, request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).activate(offer_id, req.expected_revision, actor, request))


@router.get("/tool-options", response_model=APIResponse[list[ToolOptionResponse]], response_model_exclude_unset=True)
async def list_tool_options(db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).tool_options())


@router.get("/catalog-export", response_model=APIResponse[PublicCatalogResponse], response_model_exclude_unset=True)
async def export_catalog(db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).export_catalog())


@router.get("/catalog", response_model=APIResponse[PublicCatalogResponse], response_model_exclude_unset=True)
async def customer_catalog(db: AsyncSession = Depends(get_db), actor: dict = Depends(get_current_user)) -> dict[str, object]:
    # Same public whitelist as the static export, not the internal management records.
    return envelope(await CommercialService(db).export_catalog())


@router.get("/orders", response_model=APIResponse[list[CommercialOrderResponse]], response_model_exclude_unset=True)
async def list_orders(db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).orders())


@router.post("/orders", response_model=APIResponse[CommercialOrderResponse], response_model_exclude_unset=True)
async def create_order(req: CommercialOrderCreate, request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).create_order(req, actor, request))


@router.get("/orders/{order_id}", response_model=APIResponse[CommercialOrderResponse], response_model_exclude_unset=True)
async def order_detail(order_id: int, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).order_detail(order_id))


@router.post("/orders/{order_id}/grant", response_model=APIResponse[CommercialGrantResponse], response_model_exclude_unset=True)
async def issue_order_grant(order_id: int, request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).issue_order_grant(order_id, actor, request))


@router.get("/orders/{order_id}/fulfillments", response_model=APIResponse[list[ServiceFulfillmentResponse]], response_model_exclude_unset=True)
async def list_fulfillments(order_id: int, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).fulfillments(order_id))


@router.get("/orders/{order_id}/refund-entitlements", response_model=APIResponse[RefundEntitlementReviewResponse], response_model_exclude_unset=True)
async def refund_entitlements(order_id: int, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).refund_entitlements(order_id))


@router.post("/orders/{order_id}/refund-entitlements", response_model=APIResponse[RefundEntitlementReviewResponse], response_model_exclude_unset=True)
async def review_refund_entitlements(order_id: int, req: RefundEntitlementReviewRequest, request: Request,
                                    db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict[str, object]:
    return envelope(await CommercialService(db).review_refund_entitlements(order_id, req.model_dump(), actor, request))


@router.post("/fulfillments/{fulfillment_id}/complete", response_model=APIResponse[FulfillmentCompleteResponse], response_model_exclude_unset=True)
async def complete_fulfillment(fulfillment_id: int, req: FulfillmentComplete, request: Request,
                               db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).complete_service(fulfillment_id, req.model_dump(), actor, request))


@router.get("/grants", response_model=APIResponse[list[CommercialGrantResponse]], response_model_exclude_unset=True)
async def list_grants(db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).grants())


@router.post("/trial-grants", response_model=APIResponse[CommercialGrantResponse], response_model_exclude_unset=True)
async def issue_trial(req: TrialGrantCreate, request: Request, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_commerce_operator)) -> dict[str, object]:
    return envelope(await CommercialService(db).issue_trial(req, actor, request))
