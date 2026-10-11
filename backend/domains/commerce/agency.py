"""Partner delivery service. All reads and mutations share the same agency scope."""

from __future__ import annotations

import json
import secrets
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.cache import cache
from core.csv_export import csv_row
from core.response import paginated_response
from domains.access import effective_license_status, effective_license_status_sql
from domains.commerce.agency_commission import AgencyCommissionService
from models import Agency, AgencyCustomer, AgencyRequest, AuthCode, Order, Plan, StaffRole
from schemas.agency import (
    AgencyOrderCreate,
    AgencyOrderView,
    AgencyRequestCreate,
    AgencyRequestResolve,
    AgencyRequestView,
    AgencyUpdate,
    AgencyView,
    AgencyWrite,
    CustomerCreate,
    CustomerUpdate,
    CustomerView,
)
from services.order_service import OrderService
from services.profit_service import ProfitService


class AgencyService:
    def __init__(self, db: AsyncSession, actor: dict[str, Any]) -> None:
        self.db = db
        self.actor = actor

    def _scope(self, model: Any, agency_id: int | None = None) -> Any:
        if self.actor["role"] == StaffRole.AGENT:
            if agency_id is not None and agency_id != self.actor["agency_id"]:
                raise HTTPException(403, "不能查询其他代理的数据")
            agency_id = self.actor["agency_id"]
        elif self.actor["role"] != StaffRole.SUPER_ADMIN:
            raise HTTPException(403, "当前账号无代理工作台权限")
        query = select(model)
        # Historical unassigned rows must not be adopted by an agency implicitly.
        return query.where(model.agency_id == agency_id) if agency_id else query.where(model.agency_id.is_not(None))

    def _owner(self) -> None:
        if self.actor["role"] != StaffRole.SUPER_ADMIN:
            raise HTTPException(403, "该操作仅平台负责人可执行")

    async def _agency(self, agency_id: int, *, active: bool = True) -> Agency:
        agency = await self.db.get(Agency, agency_id)
        if not agency or (active and agency.status != "active"):
            raise HTTPException(422, "请选择启用中的代理主体")
        return agency

    async def _get(self, model: Any, item_id: int, *, lock: bool = False) -> Any:
        query = self._scope(model).where(model.id == item_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        item = (await self.db.execute(query)).scalar_one_or_none()
        if item is None:
            raise HTTPException(404, "记录不存在或不属于当前代理")
        return item

    async def _save(self, item: Any, action: str, request: Request, detail: dict[str, Any] | None = None) -> None:
        try:
            await self.db.flush()
            await log_admin_action(
                self.db, user_id=self.actor["staff_id"], user_name=self.actor["username"],
                action=action, target_type=item.__tablename__, target_id=item.id,
                detail={"actor_role": self.actor["role"], "agency_id": getattr(item, "agency_id", None), **(detail or {})},
                request=request,
            )
            await self.db.commit()
            await self.db.refresh(item)
        except Exception:
            await self.db.rollback()
            raise

    async def _page(self, query: Any, page: int, page_size: int, schema: Any) -> dict[str, Any]:
        total = int((await self.db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        items = (await self.db.execute(query.order_by(query.column_descriptions[0]["entity"].id.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
        agency_ids = {getattr(item, "agency_id", None) for item in items} - {None}
        agency_names = dict((await self.db.execute(select(Agency.id, Agency.name).where(Agency.id.in_(agency_ids)))).all()) if agency_ids else {}
        customer_ids = {getattr(item, "customer_id", None) for item in items} - {None}
        customer_names = dict((await self.db.execute(select(AgencyCustomer.id, AgencyCustomer.name).where(AgencyCustomer.id.in_(customer_ids)))).all()) if customer_ids else {}
        data = [schema.model_validate(item).model_copy(update={
            "agency_name": agency_names.get(getattr(item, "agency_id", None), ""),
            "customer_name": customer_names.get(getattr(item, "customer_id", None), ""),
        }) for item in items]
        return paginated_response(data, total, page, page_size)

    async def list_agencies(self, page: int, page_size: int, q: str | None = None, status: str | None = None) -> dict[str, Any]:
        self._owner()
        query = select(Agency)
        if q:
            query = query.where(or_(Agency.name.contains(q, autoescape=True), Agency.contact.contains(q, autoescape=True)))
        if status:
            query = query.where(Agency.status == status)
        return await self._page(query, page, page_size, AgencyView)

    async def create_agency(self, data: AgencyWrite, request: Request) -> Agency:
        self._owner()
        item = Agency(**data.model_dump())
        self.db.add(item)
        await self._save(item, "agency_create", request)
        return item

    async def update_agency(self, item_id: int, data: AgencyUpdate, request: Request) -> Agency:
        self._owner()
        item = await self._agency(item_id, active=False)
        for key, value in data.model_dump(exclude_unset=True).items():
            if key in {"name", "status"} and value is None:
                raise HTTPException(422, "名称和状态不能为空")
            setattr(item, key, value)
        await self._save(item, "agency_update", request, data.model_dump(exclude_unset=True))
        return item

    async def customers(self, page: int, page_size: int, q: str | None, agency_id: int | None) -> dict[str, Any]:
        query = self._scope(AgencyCustomer, agency_id)
        if q:
            query = query.where(or_(AgencyCustomer.name.contains(q, autoescape=True), AgencyCustomer.contact.contains(q, autoescape=True)))
        return await self._page(query, page, page_size, CustomerView)

    async def customer(self, item_id: int) -> CustomerView:
        item = await self._get(AgencyCustomer, item_id)
        agency = await self._agency(item.agency_id, active=False)
        return CustomerView.model_validate(item).model_copy(update={"agency_name": agency.name})

    async def create_customer(self, data: CustomerCreate, request: Request) -> AgencyCustomer:
        agency_id = data.agency_id
        if self.actor["role"] == StaffRole.AGENT:
            if agency_id is not None and agency_id != self.actor["agency_id"]:
                raise HTTPException(403, "不能为其他代理建档")
            agency_id = self.actor["agency_id"]
        if not agency_id:
            raise HTTPException(422, "请指定客户归属代理")
        await self._agency(agency_id)
        item = AgencyCustomer(**data.model_dump(exclude={"agency_id"}), agency_id=agency_id, created_by_staff_id=self.actor["staff_id"])
        self.db.add(item)
        await self._save(item, "agency_customer_create", request)
        return item

    async def update_customer(self, item_id: int, data: CustomerUpdate, request: Request) -> AgencyCustomer:
        item = await self._get(AgencyCustomer, item_id, lock=True)
        changes = data.model_dump(exclude_unset=True)
        before_agency_id = item.agency_id
        if "agency_id" in changes:
            self._owner()
            if not changes["agency_id"]:
                raise HTTPException(422, "客户必须归属一个代理")
            await self._agency(changes["agency_id"])
            # A transfer moves the entire delivery/support chain, not just its list label.
            for model in (Order, AuthCode, AgencyRequest):
                await self.db.execute(update(model).where(model.customer_id == item.id).values(agency_id=changes["agency_id"]))
        if "name" in changes and changes["name"] is None:
            raise HTTPException(422, "客户名称不能为空")
        for key, value in changes.items():
            setattr(item, key, value)
        await self._save(item, "agency_customer_update", request, {"before_agency_id": before_agency_id, "after_agency_id": item.agency_id})
        return item

    async def plans(self) -> list[dict[str, Any]]:
        rows = (await self.db.execute(select(Plan).where(Plan.status == "active").order_by(Plan.sort_order, Plan.id))).scalars().all()
        return [{"id": p.id, "name": p.name, "price": float(p.price), "duration_days": p.duration_days, "product_type": p.product_type} for p in rows]

    def _orders_query(self, agency_id: int | None, status: str | None, q: str | None, customer_id: int | None = None) -> Any:
        query = self._scope(Order, agency_id)
        delivered = select(AuthCode.id).where(AuthCode.order_id == Order.id).exists()
        if status == "delivered":
            query = query.where(Order.status == "paid", delivered)
        elif status == "paid":
            query = query.where(Order.status == "paid", ~delivered)
        elif status:
            query = query.where(Order.status == status)
        if customer_id:
            query = query.where(Order.customer_id == customer_id)
        if q:
            query = query.where(or_(Order.order_no.contains(q, autoescape=True), Order.customer_id.in_(select(AgencyCustomer.id).where(AgencyCustomer.name.contains(q, autoescape=True)))))
        return query

    async def orders(self, page: int, page_size: int, agency_id: int | None, status: str | None, q: str | None, customer_id: int | None = None) -> dict[str, Any]:
        query = self._orders_query(agency_id, status, q, customer_id)
        total = int((await self.db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        orders = (await self.db.execute(query.order_by(Order.id.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
        return paginated_response(await self._order_views(orders), total, page, page_size)

    async def _order_views(self, orders: Any) -> list[AgencyOrderView]:
        if not orders:
            return []
        ids = [order.id for order in orders]
        customers = (await self.db.execute(select(AgencyCustomer).where(AgencyCustomer.id.in_({o.customer_id for o in orders})))).scalars().all()
        names = {customer.id: customer.name for customer in customers}
        agencies = dict((await self.db.execute(select(Agency.id, Agency.name).where(Agency.id.in_({o.agency_id for o in orders})))).all())
        codes = (await self.db.execute(self._scope(AuthCode).where(AuthCode.order_id.in_(ids)))).scalars().all()
        code_map = {code.order_id: code for code in codes}
        return [AgencyOrderView(
            id=o.id, agency_id=o.agency_id, agency_name=agencies.get(o.agency_id, ""), customer_id=o.customer_id, customer_name=names.get(o.customer_id, ""),
            order_no=o.order_no, plan_id=o.plan_id, plan_name=o.plan_name_snapshot, amount=float(o.amount),
            platform_key=o.platform_key, note=o.agency_note, status=o.status, created_at=o.created_at, paid_at=o.paid_at,
            auth_code={**self._license_view(code_map[o.id], o.plan_name_snapshot), "agency_name": agencies.get(o.agency_id, ""), "customer_name": names.get(o.customer_id, "")} if o.id in code_map else None,
        ) for o in orders]

    async def order(self, item_id: int) -> AgencyOrderView:
        return (await self._order_views([await self._get(Order, item_id)]))[0]

    async def create_order(self, data: AgencyOrderCreate, request: Request) -> AgencyOrderView:
        customer = await self._get(AgencyCustomer, data.customer_id, lock=True)
        await self._agency(customer.agency_id)
        plan = await self.db.get(Plan, data.plan_id)
        if not plan or plan.status != "active":
            raise HTTPException(422, "请选择启用中的套餐")
        order = Order(
            order_no=OrderService._new_order_no(), plan_id=plan.id, plan_name_snapshot=plan.name,
            plan_price_snapshot=plan.price, plan_duration_days_snapshot=plan.duration_days, amount=plan.price,
            delivery_entitlements_snapshot=plan.entitlements, agency_note=data.note,
            agency_id=customer.agency_id, customer_id=customer.id, channel="代理", responsible=None,
            platform_key=data.platform_key, status="pending", created_by_staff_id=self.actor["staff_id"], updated_by_staff_id=self.actor["staff_id"],
        )
        self.db.add(order)
        await self._save(order, "agency_order_create", request)
        return await self.order(order.id)

    async def mark_paid(self, order_id: int, request: Request) -> AgencyOrderView:
        self._owner()
        order = await self._locked_customer_order(order_id)
        if order.status == "paid":
            return await self.order(order.id)
        if order.status != "pending":
            raise HTTPException(409, "仅待收款订单可确认收款")
        order.status = "paid"
        order.paid_at = datetime.utcnow()
        order.updated_by_staff_id = self.actor["staff_id"]
        try:
            await ProfitService(self.db).create_for_paid_order(order, self.actor)
            await AgencyCommissionService(self.db, self.actor).record_accrual(order, self.actor.get("staff_id"))
            await self._save(order, "agency_order_paid", request)
        except Exception:
            await self.db.rollback()
            raise
        await cache.delete_pattern("dashboard:*")
        return await self.order(order.id)

    async def deliver(self, order_id: int, request: Request) -> AgencyOrderView:
        self._owner()
        order = await self._locked_customer_order(order_id)
        if order.status != "paid":
            raise HTTPException(409, "未确认收款的订单不能发放授权")
        existing = (await self.db.execute(select(AuthCode).where(AuthCode.order_id == order.id))).scalar_one_or_none()
        if existing:
            return await self.order(order.id)
        await self._agency(order.agency_id)
        try:
            entitlements = json.loads(order.delivery_entitlements_snapshot or "{}")
            max_devices = max(1, min(50, int(entitlements.get("max_devices", 1))))
            seat_limit = max(1, min(50, int(entitlements.get("seat_limit", max_devices))))
        except (ValueError, TypeError, AttributeError) as error:
            raise HTTPException(409, "订单套餐快照异常，请由负责人核对") from error
        code = AuthCode(
            code=f"KST-{secrets.token_hex(12).upper()}", plan_id=order.plan_id, status="unused",
            agency_id=order.agency_id, customer_id=order.customer_id, order_id=order.id,
            expires_at=datetime.now() + timedelta(days=order.plan_duration_days_snapshot),
            max_devices=max_devices, seat_limit=seat_limit, platform_scope=order.platform_key, scene_type="competition",
        )
        self.db.add(code)
        try:
            await self._save(code, "agency_order_deliver", request, {"order_id": order_id})
        except IntegrityError:
            # Unique(order_id) is the final guard, also when the engine ignores FOR UPDATE.
            existing = (await self.db.execute(select(AuthCode).where(AuthCode.order_id == order_id))).scalar_one_or_none()
            if existing is None:
                raise
        return await self.order(order_id)

    async def _locked_customer_order(self, order_id: int) -> Order:
        # Reassignment locks Customer -> Order -> AuthCode. Use the same order
        # before issuing an AuthCode: its customer FK also acquires a parent-row
        # lock in InnoDB, even though delivery does not update the customer itself.
        initial = await self._get(Order, order_id)
        customer_id = initial.customer_id
        if customer_id is None:
            raise HTTPException(409, "代理订单缺少客户归属，请先核对")
        customer = await self._get(AgencyCustomer, customer_id, lock=True)
        order = await self._get(Order, order_id, lock=True)
        # Locking reads refresh stale identity maps and recheck the complete
        # association after a concurrent transfer has committed.
        if order.customer_id != customer.id or order.agency_id != customer.agency_id:
            raise HTTPException(409, "客户与订单归属不一致，请刷新后重试")
        return order

    @staticmethod
    def _license_view(code: AuthCode, plan_name: str) -> dict[str, Any]:
        return {
            "id": code.id, "agency_id": code.agency_id, "customer_id": code.customer_id, "order_id": code.order_id,
            "code": code.code, "plan_name": plan_name, "status": effective_license_status(code), "expires_at": code.expires_at,
            "activated": code.user_id is not None, "created_at": code.created_at,
        }

    async def licenses(self, page: int, page_size: int, agency_id: int | None, status: str | None, q: str | None = None, customer_id: int | None = None) -> dict[str, Any]:
        query = self._scope(AuthCode, agency_id).where(AuthCode.order_id.is_not(None))
        if customer_id is not None:
            query = query.where(AuthCode.customer_id == customer_id)
        effective_status = effective_license_status_sql()
        if status == "pending_activation":
            query = query.where(effective_status == "unused", AuthCode.user_id.is_(None), AuthCode.order_id.in_(select(Order.id).where(Order.status == "paid")))
        elif status:
            query = query.where(effective_status == status)
        if q:
            query = query.where(or_(AuthCode.code.contains(q, autoescape=True), AuthCode.customer_id.in_(select(AgencyCustomer.id).where(AgencyCustomer.name.contains(q, autoescape=True)))))
        total = int((await self.db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        codes = (await self.db.execute(query.order_by(AuthCode.id.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
        orders = (await self.db.execute(select(Order).where(Order.id.in_([code.order_id for code in codes])))).scalars().all()
        names = {order.id: order.plan_name_snapshot for order in orders}
        agencies = dict((await self.db.execute(select(Agency.id, Agency.name).where(Agency.id.in_({c.agency_id for c in codes})))).all())
        customers = dict((await self.db.execute(select(AgencyCustomer.id, AgencyCustomer.name).where(AgencyCustomer.id.in_({c.customer_id for c in codes})))).all())
        return paginated_response([{**self._license_view(code, names.get(code.order_id, "")), "agency_name": agencies.get(code.agency_id, ""), "customer_name": customers.get(code.customer_id, "")} for code in codes], total, page, page_size)

    async def license(self, item_id: int) -> dict[str, Any]:
        code = await self._get(AuthCode, item_id)
        if not code.order_id:
            raise HTTPException(404, "授权没有代理订单关联")
        order = await self._get(Order, code.order_id)
        customer = await self.customer(code.customer_id)
        return {**self._license_view(code, order.plan_name_snapshot), "customer_name": customer.name, "agency_name": customer.agency_name}

    async def requests(self, page: int, page_size: int, agency_id: int | None, status: str | None, q: str | None = None, customer_id: int | None = None) -> dict[str, Any]:
        query = self._scope(AgencyRequest, agency_id)
        if customer_id is not None:
            query = query.where(AgencyRequest.customer_id == customer_id)
        if status:
            query = query.where(AgencyRequest.status == status)
        if q:
            query = query.where(or_(AgencyRequest.content.contains(q, autoescape=True), AgencyRequest.customer_id.in_(select(AgencyCustomer.id).where(AgencyCustomer.name.contains(q, autoescape=True)))))
        return await self._page(query, page, page_size, AgencyRequestView)

    async def support_request(self, item_id: int) -> AgencyRequestView:
        item = await self._get(AgencyRequest, item_id)
        customer = await self.customer(item.customer_id)
        return AgencyRequestView.model_validate(item).model_copy(update={"customer_name": customer.name, "agency_name": customer.agency_name})

    async def create_request(self, data: AgencyRequestCreate, request: Request) -> AgencyRequest:
        customer = await self._get(AgencyCustomer, data.customer_id, lock=True)
        if data.kind in {"refund", "extension"} and not data.order_id:
            raise HTTPException(422, "退款或延期申请必须关联订单")
        if data.order_id:
            order = await self._get(Order, data.order_id)
            if order.customer_id != customer.id:
                raise HTTPException(422, "订单与客户不匹配")
        item = AgencyRequest(**data.model_dump(), agency_id=customer.agency_id, created_by_staff_id=self.actor["staff_id"])
        self.db.add(item)
        await self._save(item, "agency_request_create", request)
        return item

    async def resolve_request(self, item_id: int, data: AgencyRequestResolve, request: Request) -> AgencyRequestView:
        self._owner()
        item = await self._get(AgencyRequest, item_id, lock=True)
        before = {"status": item.status, "response": item.response}
        item.status = data.status
        item.response = data.response
        item.resolved_at = datetime.utcnow() if data.status != "open" else None
        item.resolved_by_staff_id = self.actor["staff_id"] if data.status != "open" else None
        # Resolving a service request is not a financial refund or a silent license extension.
        await self._save(item, "agency_request_reply", request, {"before": before, "after": data.model_dump()})
        return await self.support_request(item_id)

    async def summary(self, agency_id: int | None) -> dict[str, int]:
        queries = {
            "customers": self._scope(AgencyCustomer, agency_id),
            "orders": self._scope(Order, agency_id),
            "pending_orders": self._scope(Order, agency_id).where(Order.status == "pending"),
            "delivered_orders": self._orders_query(agency_id, "delivered", None),
            "open_requests": self._scope(AgencyRequest, agency_id).where(AgencyRequest.status == "open"),
        }
        result = {}
        for key, query in queries.items():
            result[key] = int((await self.db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        return result

    async def delivery_tasks(self) -> list[dict[str, Any]]:
        """Owner-only read model; counts are not capped by the list preview."""
        self._owner()
        pending_activation = self._scope(AuthCode).where(
            AuthCode.order_id.is_not(None), effective_license_status_sql() == "unused",
            AuthCode.user_id.is_(None),
            AuthCode.order_id.in_(select(Order.id).where(Order.status == "paid")),
        )
        entries = (
            ("pending_orders", "待确认收款", self._orders_query(None, "pending", None), "orders", "pending"),
            ("paid_orders", "已收款待发码", self._orders_query(None, "paid", None), "orders", "paid"),
            ("pending_activation", "已交付待激活", pending_activation, "licenses", "pending_activation"),
            ("open_requests", "待处理代理售后", self._scope(AgencyRequest).where(AgencyRequest.status == "open"), "requests", "open"),
        )
        tasks = []
        for key, label, query, section, state in entries:
            count = int((await self.db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
            tasks.append({"key": key, "label": label, "count": count, "section": section, "status": state})
        return tasks

    def export_orders(self, agency_id: int | None, status: str | None, q: str | None, customer_id: int | None = None) -> AsyncIterator[str]:
        # Validate before StreamingResponse sends a 200 header, not inside its generator.
        self._orders_query(agency_id, status, q, customer_id)
        return self.orders_csv(agency_id, status, q, customer_id)

    async def orders_csv(self, agency_id: int | None, status: str | None, q: str | None, customer_id: int | None = None) -> AsyncIterator[str]:
        # FastAPI can finalize request dependencies before consuming a streamed body.
        async with AsyncSession(bind=self.db.bind, expire_on_commit=False) as session:
            scoped = AgencyService(session, self.actor)
            async for chunk in scoped._csv_rows(agency_id, status, q, customer_id):
                yield chunk

    async def _csv_rows(self, agency_id: int | None, status: str | None, q: str | None, customer_id: int | None) -> AsyncIterator[str]:
        query = self._orders_query(agency_id, status, q, customer_id)
        yield "\ufeff" + csv_row(["订单号", "客户", "套餐", "金额", "状态", "授权交付"])
        cursor = 0
        while True:
            rows = (await self.db.execute(query.where(Order.id > cursor).order_by(Order.id).limit(500))).scalars().all()
            if not rows:
                break
            for order in await self._order_views(rows):
                yield csv_row([order.order_no, order.customer_name, order.plan_name, order.amount, order.status, "已交付" if order.auth_code else "待交付"])
            cursor = rows[-1].id
