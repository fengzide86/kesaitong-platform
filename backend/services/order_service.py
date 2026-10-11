"""Transactional order state machine for the internal commerce loop."""

import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.cache import cache
from core.exceptions import ConflictException, NotFoundException, ValidationException
from domains.access.license_state import effective_license_status
from domains.commerce.agency_commission import AgencyCommissionService
from models import Agency, AgencyCustomer, AuthCode, Order, OrderStatus, Plan, PlanStatus
from services.profit_service import ProfitService

CENT = Decimal("0.01")


class OrderService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_orders(
        self,
        page: int,
        page_size: int,
        status_filter: str | None = None,
        plan_id: int | None = None,
        platform_key: str | None = None,
        source: str | None = None,
    ) -> dict:
        filters = []
        if source == "direct":
            filters.append(Order.agency_id.is_(None))
        elif source == "agency":
            filters.append(Order.agency_id.is_not(None))
        if status_filter:
            if status_filter not in OrderStatus.ALL:
                raise ValidationException("订单状态无效")
            filters.append(Order.status == status_filter)
        if plan_id:
            filters.append(Order.plan_id == plan_id)
        if platform_key:
            filters.append(or_(Order.platform_key == platform_key, Order.platform_key.is_(None)))
        base = select(Order).where(*filters)
        count_result = await self.db.execute(
            select(func.count()).select_from(base.order_by(None).subquery())
        )
        result = await self.db.execute(
            base.order_by(Order.created_at.desc(), Order.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return {
            "success": True,
            "message": "ok",
            "data": [self.serialize(item) for item in result.scalars().all()],
            "page": page,
            "page_size": page_size,
            "total": int(count_result.scalar() or 0),
        }

    async def get_order(self, order_id: int) -> Order:
        result = await self.db.execute(select(Order).where(Order.id == order_id))
        order = result.scalar_one_or_none()
        if not order:
            raise NotFoundException("订单不存在")
        return order

    async def detail(self, order_id: int, platform_key: str | None = None) -> dict:
        order = await self.get_order(order_id)
        if platform_key and order.platform_key not in (None, platform_key):
            raise NotFoundException("订单不属于当前平台")
        agency = await self.db.get(Agency, order.agency_id) if order.agency_id else None
        customer = await self.db.get(AgencyCustomer, order.customer_id) if order.customer_id else None
        code = (await self.db.execute(select(AuthCode).where(AuthCode.order_id == order.id))).scalar_one_or_none()
        # Only expose real foreign-key relationships, never infer identities from names.
        return {**self.serialize(order), "agency_name": agency.name if agency else None,
                "customer_name": customer.name if customer else None,
                "auth_code_id": code.id if code else None,
                "auth_code_status": effective_license_status(code) if code else None}

    async def create_order(self, data: dict, actor: dict, request: Request) -> Order:
        plan = await self._active_plan(data["plan_id"])
        amount = self._money(data.get("amount") if data.get("amount") is not None else plan.price)
        order = Order(
            order_no=self._new_order_no(),
            plan_id=plan.id,
            plan_name_snapshot=plan.name,
            plan_price_snapshot=self._money(plan.price),
            plan_duration_days_snapshot=plan.duration_days,
            amount=amount,
            channel=data.get("channel"),
            responsible=data.get("responsible"),
            platform_key=data.get("platform_key"),
            status=OrderStatus.PENDING,
            refund_amount=Decimal("0.00"),
            created_by_staff_id=actor["staff_id"],
            updated_by_staff_id=actor["staff_id"],
        )
        self.db.add(order)
        await self.db.flush()
        await self._audit(
            actor,
            request,
            "order_create",
            order,
            before=None,
            after=self.serialize(order),
        )
        await self.db.commit()
        await self.db.refresh(order)
        await self._invalidate_dashboard()
        return order

    async def update_pending(self, order_id: int, data: dict, actor: dict, request: Request) -> Order:
        order = await self._locked_order(order_id)
        self._require_agency_owner(order, actor)
        if order.status != OrderStatus.PENDING:
            raise ConflictException("只有待收款订单可以修改")
        if not data:
            raise ValidationException("没有可更新字段")
        before = self.serialize(order)
        if "plan_id" in data:
            plan = await self._active_plan(data["plan_id"])
            order.plan_id = plan.id
            order.plan_name_snapshot = plan.name
            order.plan_price_snapshot = self._money(plan.price)
            order.plan_duration_days_snapshot = plan.duration_days
            if order.agency_id is not None:
                order.delivery_entitlements_snapshot = plan.entitlements
            if "amount" not in data:
                order.amount = self._money(plan.price)
        if "amount" in data:
            order.amount = self._money(data["amount"])
        for field in ("channel", "responsible", "platform_key"):
            if field in data:
                setattr(order, field, data[field])
        order.updated_by_staff_id = actor["staff_id"]
        await self._audit(
            actor,
            request,
            "order_update_pending",
            order,
            before=before,
            after=self.serialize(order),
        )
        await self.db.commit()
        await self.db.refresh(order)
        await self._invalidate_dashboard()
        return order

    async def mark_paid(self, order_id: int, actor: dict, request: Request) -> Order:
        order = await self._locked_order(order_id)
        self._require_agency_owner(order, actor)
        if order.status != OrderStatus.PENDING:
            raise ConflictException(f"订单当前状态 {order.status}，不能标记为已收款")
        before = self.serialize(order)
        order.status = OrderStatus.PAID
        order.paid_at = datetime.utcnow()
        order.updated_by_staff_id = actor["staff_id"]
        try:
            profit = await ProfitService(self.db).create_for_paid_order(order, actor)
            await AgencyCommissionService(self.db, actor).record_accrual(order, actor.get("staff_id"))
            # The flush used to create the ledger row can expire server-managed
            # order timestamps. Refresh explicitly before synchronous serialization.
            await self.db.refresh(order)
            await self._audit(
                actor,
                request,
                "order_mark_paid",
                order,
                before=before,
                after={**self.serialize(order), "profit_record_id": profit.id},
            )
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("订单已被其他操作标记为已收款") from error
        await self.db.refresh(order)
        await self._invalidate_dashboard()
        return order

    async def cancel(self, order_id: int, reason: str, actor: dict, request: Request) -> Order:
        order = await self._locked_order(order_id)
        self._require_agency_owner(order, actor)
        if order.status != OrderStatus.PENDING:
            raise ConflictException("只有待收款订单可以取消")
        before = self.serialize(order)
        order.status = OrderStatus.CANCELLED
        order.cancel_reason = reason
        order.cancelled_at = datetime.utcnow()
        order.updated_by_staff_id = actor["staff_id"]
        await self._audit(
            actor,
            request,
            "order_cancel",
            order,
            before=before,
            after=self.serialize(order),
            reason=reason,
        )
        await self.db.commit()
        await self.db.refresh(order)
        await self._invalidate_dashboard()
        return order

    async def refund(self, order_id: int, reason: str, actor: dict, request: Request) -> Order:
        order = await self._locked_order(order_id)
        self._require_agency_owner(order, actor)
        if order.status != OrderStatus.PAID:
            raise ConflictException("只有已收款订单可以退款")
        before = self.serialize(order)
        order.status = OrderStatus.REFUNDED
        order.refund_amount = self._money(order.amount)
        order.refund_reason = reason
        order.refunded_at = datetime.utcnow()
        order.updated_by_staff_id = actor["staff_id"]
        reversed_record = await ProfitService(self.db).reverse_for_refund(order, reason)
        await AgencyCommissionService(self.db, actor).record_refund(order)
        # Production disables autoflush. A missing optional commission ledger
        # does not flush, so refreshing now would discard the pending refund.
        # Persist both ledger and order changes within this same transaction
        # before loading server-managed timestamps for synchronous serialization.
        await self.db.flush()
        await self.db.refresh(order)
        await self._audit(
            actor,
            request,
            "order_refund",
            order,
            before=before,
            after={
                **self.serialize(order),
                "profit_record_id": reversed_record.id,
                "profit_status": reversed_record.status,
            },
            reason=reason,
        )
        await self.db.commit()
        await self.db.refresh(order)
        await self._invalidate_dashboard()
        return order

    async def _locked_order(self, order_id: int) -> Order:
        result = await self.db.execute(
            select(Order).where(Order.id == order_id).with_for_update()
        )
        order = result.scalar_one_or_none()
        if not order:
            raise NotFoundException("订单不存在")
        return order

    @staticmethod
    def _require_agency_owner(order: Order, actor: dict) -> None:
        if order.agency_id is not None and actor.get("role") != "super_admin":
            raise HTTPException(403, "代理订单仅平台负责人可审批或修改")

    async def _active_plan(self, plan_id: int) -> Plan:
        result = await self.db.execute(select(Plan).where(Plan.id == plan_id))
        plan = result.scalar_one_or_none()
        if not plan:
            raise NotFoundException("套餐不存在")
        if plan.status != PlanStatus.ACTIVE:
            raise ConflictException("只能为启用中的套餐创建订单")
        return plan

    async def _audit(
        self,
        actor: dict,
        request: Request,
        action: str,
        order: Order,
        before: dict | None,
        after: dict,
        reason: str | None = None,
    ) -> None:
        await log_admin_action(
            self.db,
            user_id=actor["staff_id"],
            user_name=actor["username"],
            action=action,
            target_type="order",
            target_id=order.id,
            detail={
                "role": actor["role"],
                "before": before,
                "after": after,
                "reason": reason,
            },
            request=request,
        )

    @staticmethod
    def _money(value: object) -> Decimal:
        amount = Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)
        if amount <= 0:
            raise ValidationException("订单金额必须大于 0")
        return amount

    @staticmethod
    def _new_order_no() -> str:
        return f"ORD-{datetime.utcnow():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:8].upper()}"

    @staticmethod
    def serialize(order: Order) -> dict:
        return {
            "id": order.id,
            "order_no": order.order_no,
            "agency_id": order.agency_id,
            "customer_id": order.customer_id,
            "plan_id": order.plan_id,
            "plan_name_snapshot": order.plan_name_snapshot,
            "plan_price_snapshot": float(order.plan_price_snapshot or 0),
            "plan_duration_days_snapshot": order.plan_duration_days_snapshot or 0,
            "amount": float(order.amount),
            "channel": order.channel,
            "responsible": order.responsible,
            "status": order.status,
            "refund_amount": float(order.refund_amount or 0),
            "platform_key": order.platform_key,
            "refund_reason": order.refund_reason,
            "cancel_reason": order.cancel_reason,
            "created_by_staff_id": order.created_by_staff_id,
            "updated_by_staff_id": order.updated_by_staff_id,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "paid_at": order.paid_at.isoformat() if order.paid_at else None,
            "refunded_at": order.refunded_at.isoformat() if order.refunded_at else None,
            "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
            "updated_at": order.updated_at.isoformat() if order.updated_at else None,
        }

    @staticmethod
    async def _invalidate_dashboard() -> None:
        await cache.delete_pattern("dashboard:*")
