"""Transactional team ledger with explicit distribution bases and audit trails."""

import hashlib
import json
from datetime import date, datetime
from decimal import ROUND_FLOOR, Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.exceptions import ConflictException, NotFoundException, ValidationException
from core.transaction_locks import acquire_transaction_guard
from domains.commercial import service_fulfillment_requirement
from models import Order, OrderStatus
from models.commercial import CommercialOrderSnapshot, ServiceFulfillment
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
from schemas.commercial import IncludedService
from schemas.team_ledger import (
    AdjustmentInput,
    AllocationInput,
    ConfirmInput,
    MemberInput,
    MemberUpdate,
    OwnershipInput,
    OwnershipUpdate,
    PartialRefundInput,
    PaymentInput,
    PolicyInput,
    PolicyUpdate,
    PreviewInput,
    RefundResolveInput,
    ReleaseInput,
    ServiceDeliveryInput,
)

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def document(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def money(value: object) -> Decimal:
    return Decimal(str(value)).quantize(CENT)


def largest_remainder(amount: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Split integer cents deterministically without float arithmetic."""
    if not amount.is_finite() or amount < 0 or amount != amount.quantize(CENT):
        raise ValidationException("分配金额必须为非负整分金额")
    if not weights or any(not value.is_finite() or value < 0 for value in weights) or sum(weights) <= 0:
        raise ValidationException("分配权重无效")
    cents = int(amount * 100)
    total = sum(weights)
    exact = [Decimal(cents) * value / total for value in weights]
    floor = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in exact]
    indexes = sorted(range(len(weights)), key=lambda index: (-(exact[index] - floor[index]), index))
    for index in indexes[:cents - sum(floor)]:
        floor[index] += 1
    return [Decimal(value) / 100 for value in floor]


def row_data(row: Any) -> dict[str, Any]:
    result = {}
    json_fields = {"product_skus", "items", "members", "snapshot", "inputs_snapshot", "lines_snapshot", "resolution_snapshot", "request_snapshot"}
    for column in row.__table__.columns:
        value = getattr(row, column.name)
        if column.name in json_fields and value is not None:
            value = json.loads(value)
        elif isinstance(value, Decimal):
            value = format(value, "f")
        elif isinstance(value, date):
            value = value.isoformat()
        result[column.name] = value
    return result


class TeamLedgerService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _guard(self) -> None:
        await acquire_transaction_guard(self.db, "team_ledger")

    async def _get(self, model: type[Any], identity: int, *, locked: bool = True) -> Any:
        query = select(model).where(model.id == identity).execution_options(populate_existing=True)
        if locked:
            query = query.with_for_update()
        row = (await self.db.execute(query)).scalar_one_or_none()
        if row is None:
            raise NotFoundException("记录不存在")
        return row

    @staticmethod
    def _version(row: Any, expected: int) -> None:
        if row.version != expected:
            raise ConflictException("记录已被其他管理员修改，请刷新后重试")

    async def _finish(self, actor: dict[str, Any], action: str, row: Any,
                      detail: dict[str, Any] | None = None) -> dict[str, Any]:
        await self.db.flush()
        await self.db.refresh(row)
        await log_admin_action(
            self.db, user_id=actor["staff_id"], user_name=actor["username"],
            action=f"team_{action}", target_type=row.__tablename__, target_id=row.id,
            detail=detail if detail is not None else row_data(row),
        )
        await self.db.commit()
        return row_data(row)

    async def list_rows(self, model: type[Any], *, limit: int = 200,
                        **filters: str | int | None) -> list[dict[str, Any]]:
        query = select(model).order_by(model.id.desc()).limit(limit)
        for key, value in filters.items():
            if value is not None:
                query = query.where(getattr(model, key) == value)
        rows = (await self.db.execute(query)).scalars().all()
        return [row_data(row) for row in rows]

    async def create_policy(self, data: PolicyInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        row = TeamPolicy(
            name=data.name, status="draft", version=1,
            product_skus=document(data.product_skus), items=document(data.model_dump(mode="json")["items"]),
            created_by_staff_id=actor["staff_id"],
        )
        self.db.add(row)
        return await self._finish(actor, "policy_import_draft", row)

    async def update_policy(self, identity: int, data: PolicyUpdate, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        row = await self._get(TeamPolicy, identity)
        self._version(row, data.expected_version)
        if row.status != "draft":
            raise ConflictException("已启用策略不可覆盖；请导入新草稿，历史快照保持不变")
        row.name = data.name
        row.product_skus = document(data.product_skus)
        row.items = document(data.model_dump(mode="json")["items"])
        row.version += 1
        return await self._finish(actor, "policy_update_draft", row)

    async def activate_policy(self, identity: int, expected_version: int, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        row = await self._get(TeamPolicy, identity)
        self._version(row, expected_version)
        if row.status != "draft":
            raise ConflictException("该策略已经启用")
        PolicyInput(name=row.name, product_skus=json.loads(row.product_skus), items=json.loads(row.items))
        row.status = "active"
        row.version += 1
        return await self._finish(actor, "policy_activate", row)

    async def create_member(self, data: MemberInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        row = TeamMember(name=data.name, active=True, version=1, ledger_version=1)
        self.db.add(row)
        return await self._finish(actor, "member_create", row)

    async def update_member(self, identity: int, data: MemberUpdate, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        row = await self._get(TeamMember, identity)
        self._version(row, data.expected_version)
        row.name, row.active = data.name, data.active
        row.version += 1
        return await self._finish(actor, "member_update", row)

    async def _active_member(self, identity: int) -> TeamMember:
        member = await self._get(TeamMember, identity)
        if not member.active:
            raise ConflictException("成员已停用")
        return member

    async def save_ownership(self, data: OwnershipInput, actor: dict[str, Any],
                             identity: int | None = None) -> dict[str, Any]:
        await self._guard()
        policy = await self._get(TeamPolicy, data.policy_id)
        if data.product_sku not in json.loads(policy.product_skus):
            raise ValidationException("策略不适用于该商品")
        items = {item["code"]: item for item in json.loads(policy.items)}
        if data.item_code not in items or items[data.item_code]["method"] != "fixed":
            raise ValidationException("仅固定职责子项配置承担人；获客/成交使用订单归因")
        for item in data.members:
            await self._active_member(item.member_id)
        overlap = select(TeamOwnership).where(
            TeamOwnership.policy_id == data.policy_id,
            TeamOwnership.item_code == data.item_code,
            TeamOwnership.product_sku == data.product_sku,
            or_(TeamOwnership.ends_on.is_(None), TeamOwnership.ends_on >= data.starts_on),
        )
        if data.ends_on:
            overlap = overlap.where(TeamOwnership.starts_on <= data.ends_on)
        if identity:
            overlap = overlap.where(TeamOwnership.id != identity)
        if (await self.db.execute(overlap.with_for_update())).scalars().first():
            raise ConflictException("同一商品子项的承担期间不能重叠")
        if identity:
            row = await self._get(TeamOwnership, identity)
            if not isinstance(data, OwnershipUpdate):
                raise ValidationException("更新需要版本")
            self._version(row, data.expected_version)
            row.version += 1
        else:
            row = TeamOwnership(version=1)
            self.db.add(row)
        for field in ("policy_id", "item_code", "product_sku", "starts_on", "ends_on", "disputed"):
            setattr(row, field, getattr(data, field))
        row.members = document(data.model_dump(mode="json")["members"])
        return await self._finish(actor, "ownership_save", row)

    async def set_allocation(self, order_id: int, data: AllocationInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        order = await self._get(Order, order_id)
        snapshot = (await self.db.execute(select(CommercialOrderSnapshot).where(
            CommercialOrderSnapshot.order_id == order_id,
        ).with_for_update())).scalar_one_or_none()
        if not snapshot or snapshot.settlement_mode != "manual":
            raise ConflictException("旧订单保留原账本，不可重复进入新版成员分成")
        if order.status not in (OrderStatus.PAID, OrderStatus.REFUNDED):
            raise ConflictException("只有已收款订单可填写分配金额")
        if data.amount > money(order.amount) - money(order.refund_amount):
            raise ValidationException("本次分配金额不能超过订单净实收")
        await self._ensure_period_open(snapshot.sku, data.period)
        for member_id in (data.acquisition_member_id, data.closing_member_id):
            if member_id is not None:
                await self._active_member(member_id)
        row = (await self.db.execute(select(TeamOrderAllocation).where(
            TeamOrderAllocation.order_id == order_id,
        ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if row:
            self._version(row, data.expected_version)
            if row.confirmed_settlement_id:
                raise ConflictException("已确认分配不可改写，请使用追加调整")
            row.version += 1
        else:
            if data.expected_version != 0:
                raise ConflictException("分配记录不存在，请刷新后重试")
            if order.status == OrderStatus.REFUNDED:
                raise ConflictException("已全额退款订单不能新建分配")
            row = TeamOrderAllocation(order_id=order_id, product_sku=snapshot.sku,
                                      version=1, created_by_staff_id=actor["staff_id"])
            self.db.add(row)
        for field in ("amount", "period", "note", "acquisition_member_id", "closing_member_id", "is_repeat_purchase"):
            setattr(row, field, getattr(data, field))
        row.updated_by_staff_id = actor["staff_id"]
        return await self._finish(actor, "allocation_set", row)

    async def _ensure_period_open(self, sku: str, period: str) -> None:
        confirmed = (await self.db.execute(select(TeamSettlement.id).where(
            TeamSettlement.product_sku == sku, TeamSettlement.period == period,
            TeamSettlement.status == "confirmed",
        ).with_for_update())).first()
        if confirmed:
            raise ConflictException("该商品结算期已确认，新增款项请计入开放结算期")

    async def _pending_refunds(self, order_ids: list[int]) -> bool:
        if not order_ids:
            return False
        return (await self.db.execute(select(TeamRefundReview.id).where(
            TeamRefundReview.order_id.in_(order_ids), TeamRefundReview.status == "pending",
        ).with_for_update())).first() is not None

    async def _snapshot(self, data: PreviewInput) -> dict[str, Any]:
        policy = await self._get(TeamPolicy, data.policy_id)
        if policy.status != "active" or data.product_sku not in json.loads(policy.product_skus):
            raise ConflictException("请先明确启用适用于该商品的分成策略")
        await self._ensure_period_open(data.product_sku, data.period)
        allocations = (await self.db.execute(select(TeamOrderAllocation).where(
            TeamOrderAllocation.product_sku == data.product_sku,
            TeamOrderAllocation.period == data.period,
            TeamOrderAllocation.confirmed_settlement_id.is_(None),
        ).order_by(TeamOrderAllocation.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        if not allocations:
            raise ConflictException("本期没有已填写分配金额的订单")
        if len(allocations) > 1000:
            raise ValidationException("单期订单超过 1000 笔，请拆分结算期后处理")
        if await self._pending_refunds([item.order_id for item in allocations]):
            raise ConflictException("请先核对本期订单退款")
        orders = []
        fulfillment: list[dict] = []
        internal_delivery: list[dict] = []
        linked_service_codes = {code for item in json.loads(policy.items)
                               for code in item.get("purchased_service_codes", [])}
        purchased_services: list[dict] = []
        for item in allocations:
            order = await self._get(Order, item.order_id)
            if order.status not in (OrderStatus.PAID, OrderStatus.REFUNDED) or order.paid_at is None:
                raise ConflictException("订单收款状态已变化")
            net = money(order.amount) - money(order.refund_amount)
            if money(item.amount) > net:
                raise ConflictException("退款后分配金额超过净实收，请重新确认金额")
            orders.append({"id": order.id, "amount": str(money(order.amount)), "refund_amount": str(money(order.refund_amount)),
                           "net": str(net), "paid_at": order.paid_at.isoformat(), "status": order.status})
            if linked_service_codes:
                purchased = await self._purchased_services(order.id)
                purchased_services.append({"order_id": order.id, "services": [
                    {"code": code, "count": purchased[code]} for code in sorted(linked_service_codes & purchased.keys())
                ]})
            rows = (await self.db.execute(select(ServiceFulfillment).where(
                ServiceFulfillment.order_id == order.id,
            ).order_by(ServiceFulfillment.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
            for row in rows:
                requirement = await service_fulfillment_requirement(self.db, order.id, row.service_code)
                fulfillment.append({"order_id": row.order_id, "service_code": row.service_code,
                                    "total_count": row.total_count, "completed_count": row.completed_count,
                                    "required_count": requirement.required_count if requirement else 0,
                                    "blocked": requirement.blocked if requirement else True,
                                    "revision": row.revision})
            delivery_rows = (await self.db.execute(select(TeamServiceDelivery).where(
                TeamServiceDelivery.order_id == order.id,
            ).order_by(TeamServiceDelivery.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
            internal_delivery.extend(row_data(row) for row in delivery_rows)
        if await self._pending_refunds([item.order_id for item in allocations]):
            raise ConflictException("订单发生退款，请先完成核对")
        ownerships = (await self.db.execute(select(TeamOwnership).where(
            TeamOwnership.policy_id == policy.id, TeamOwnership.product_sku == data.product_sku,
        ).order_by(TeamOwnership.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        members = (await self.db.execute(select(TeamMember).order_by(TeamMember.id).with_for_update()
                                        .execution_options(populate_existing=True))).scalars().all()
        # Ledger totals and unrelated name changes are not policy dependencies.
        member_states = [{"id": row.id, "name": row.name, "active": row.active, "version": row.version} for row in members]
        result = {"policy": row_data(policy), "allocations": [row_data(item) for item in allocations],
                  "orders": orders, "ownerships": [row_data(item) for item in ownerships],
                  "members": member_states, "fulfillment": fulfillment, "internal_delivery": internal_delivery}
        if linked_service_codes:
            result["purchased_services"] = purchased_services
        return result

    async def _purchased_services(self, order_id: int) -> dict[str, int]:
        """Read immutable purchase scope; never infer a purchase from a policy or proof."""
        snapshot = (await self.db.execute(select(CommercialOrderSnapshot).where(
            CommercialOrderSnapshot.order_id == order_id,
        ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        try:
            if snapshot is None:
                raise ValueError("missing purchase snapshot")
            definition = json.loads(snapshot.snapshot)["definition"]
            if not isinstance(definition, dict):
                raise ValueError("invalid purchase definition")
            services = definition["services"]
            if not isinstance(services, list):
                raise ValueError("invalid purchased services")
            parsed = [IncludedService.model_validate(item) for item in services]
            if len({item.code for item in parsed}) != len(parsed):
                raise ValueError("duplicate purchased services")
            return {item.code: item.count for item in parsed}
        except (ValueError, KeyError, TypeError) as cause:
            raise ConflictException("订单购买快照不完整，无法核对已购服务，请先核对订单") from cause

    @staticmethod
    def _purchased_service_complete(inputs: dict[str, Any], order_id: int, code: str, count: int) -> bool:
        row = next((item for item in inputs["fulfillment"]
                    if item["order_id"] == order_id and item["service_code"] == code), None)
        # Internal duty proofs can never substitute for purchased service counts.
        return (row is not None and row["total_count"] == count and not row["blocked"]
                and row["required_count"] > 0 and row["completed_count"] >= row["required_count"])

    async def _purchased_services_complete(self, order_id: int, codes: list[str]) -> bool:
        purchased = await self._purchased_services(order_id)
        for code in codes:
            if code not in purchased:
                return False
            await self.db.execute(select(ServiceFulfillment).where(
                ServiceFulfillment.order_id == order_id, ServiceFulfillment.service_code == code,
            ).with_for_update().execution_options(populate_existing=True))
            current = await service_fulfillment_requirement(self.db, order_id, code)
            if (current is None or current.purchased_count != purchased[code] or current.blocked
                    or current.required_count <= 0 or current.completed_count < current.required_count):
                return False
        return True

    @staticmethod
    def _service_complete(inputs: dict[str, Any], order_id: int, service_code: str) -> bool:
        commercial = next((row for row in inputs["fulfillment"]
                           if row["order_id"] == order_id and row["service_code"] == service_code), None)
        if commercial is not None:
            return (not commercial["blocked"] and commercial["required_count"] > 0
                    and commercial["completed_count"] >= commercial["required_count"])
        return any(row["order_id"] == order_id and row["service_code"] == service_code and row["completed"]
                   for row in inputs.get("internal_delivery", []))

    async def _is_service_complete(self, order_id: int, service_code: str) -> bool:
        commercial = await service_fulfillment_requirement(self.db, order_id, service_code)
        if commercial is not None:
            return (not commercial.blocked and commercial.required_count > 0
                    and commercial.completed_count >= commercial.required_count)
        internal = (await self.db.execute(select(TeamServiceDelivery).where(
            TeamServiceDelivery.order_id == order_id, TeamServiceDelivery.service_code == service_code,
        ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        return internal is not None and internal.completed

    async def service_delivery(self, order_id: int, service_code: str, data: ServiceDeliveryInput,
                               actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        order = await self._get(Order, order_id)
        if not order.paid_at:
            raise ConflictException("订单尚未确认收款")
        snapshot = (await self.db.execute(select(CommercialOrderSnapshot).where(
            CommercialOrderSnapshot.order_id == order_id,
        ).with_for_update())).scalar_one_or_none()
        if snapshot is None:
            raise ConflictException("旧订单不进入新版内部履约台账")
        commercial = (await self.db.execute(select(ServiceFulfillment.id).where(
            ServiceFulfillment.order_id == order_id, ServiceFulfillment.service_code == service_code,
        ).with_for_update())).first()
        if commercial:
            raise ConflictException("此项属于已购服务，请在商品履约记录中完成真实次数，不能使用内部职责证明代替")
        policies = (await self.db.execute(select(TeamPolicy).where(TeamPolicy.status == "active").with_for_update())).scalars().all()
        if not any(snapshot.sku in json.loads(policy.product_skus)
                   and any(item.get("service_code") == service_code for item in json.loads(policy.items))
                   for policy in policies):
            raise ValidationException("内部履约项目必须对应该商品已启用分成策略中的职责，不创建客户购买权益")
        row = (await self.db.execute(select(TeamServiceDelivery).where(
            TeamServiceDelivery.order_id == order_id, TeamServiceDelivery.service_code == service_code,
        ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if row:
            self._version(row, data.expected_version)
            row.version += 1
        else:
            if data.expected_version != 0:
                raise ConflictException("履约记录不存在，请刷新后重试")
            row = TeamServiceDelivery(order_id=order_id, service_code=service_code, version=1)
            self.db.add(row)
        row.completed, row.evidence, row.note = True, data.evidence, data.note
        row.completed_by_staff_id, row.completed_at = actor["staff_id"], datetime.utcnow()
        return await self._finish(actor, "internal_service_delivery", row)

    @staticmethod
    def _lines(inputs: dict[str, Any]) -> tuple[Decimal, list[dict[str, Any]]]:
        allocations = inputs["allocations"]
        orders = {row["id"]: row for row in inputs["orders"]}
        active_members = {row["id"] for row in inputs["members"] if row["active"]}
        total = sum((money(row["amount"]) for row in allocations), ZERO)
        if total <= 0:
            raise ValidationException("本期确认分配金额合计须大于零")
        items = inputs["policy"]["items"]
        item_amounts = largest_remainder(total, [Decimal(row["ratio"]) for row in items])
        remaining_orders = [money(row["amount"]) for row in allocations]
        lines = []
        for item, pool in zip(items, item_amounts, strict=True):
            # Keep both margins exact: each item receives its policy pool and
            # each order keeps its explicitly confirmed B. Reusing the original
            # weights for every pool would award the same order every tied cent.
            order_amounts = largest_remainder(pool, remaining_orders) if pool else [ZERO] * len(allocations)
            remaining_orders = [remaining - amount for remaining, amount in zip(remaining_orders, order_amounts, strict=True)]
            attribution: dict[int | None, Decimal] = {}
            if item["method"] in ("acquisition", "closing"):
                for allocation in allocations:
                    member_id = allocation[f'{item["method"]}_member_id']
                    if item["method"] == "acquisition" and allocation["is_repeat_purchase"]:
                        continue
                    if member_id not in active_members:
                        member_id = None
                    attribution[member_id] = attribution.get(member_id, ZERO) + money(orders[allocation["order_id"]]["net"])
                attribution = {key: value for key, value in attribution.items() if value > 0}
            for allocation, amount in zip(allocations, order_amounts, strict=True):
                if not amount:
                    continue
                order_id = allocation["order_id"]
                reasons = []
                recipients = []
                service_code = item.get("service_code")
                declared: list[dict[str, Any]] = next((row["services"] for row in inputs.get("purchased_services", [])
                                                      if row["order_id"] == order_id), [])
                required_services = [row for row in declared if row["code"] in item.get("purchased_service_codes", [])]
                if ((service_code and not TeamLedgerService._service_complete(inputs, order_id, service_code))
                        or any(not TeamLedgerService._purchased_service_complete(inputs, order_id, row["code"], row["count"])
                               for row in required_services)):
                    reasons.append("service_unfulfilled")
                if item["method"] == "fixed":
                    paid_date = orders[order_id]["paid_at"][:10]
                    ownership = next((row for row in inputs["ownerships"] if row["item_code"] == item["code"]
                                      and row["starts_on"] <= paid_date
                                      and (not row["ends_on"] or row["ends_on"] >= paid_date)), None)
                    if ownership is None:
                        reasons.append("unassigned")
                    elif ownership["disputed"]:
                        reasons.append("disputed")
                    elif sum((Decimal(row["weight"]) for row in ownership["members"]), Decimal(0)) != 1:
                        reasons.append("incomplete_ownership")
                    elif any(row["member_id"] not in active_members for row in ownership["members"]):
                        reasons.append("inactive_member")
                    else:
                        recipients = [(row["member_id"], Decimal(row["weight"])) for row in ownership["members"]]
                else:
                    recipients = sorted(attribution.items(), key=lambda row: row[0] or 0)
                    if not recipients:
                        reasons.append("no_new_acquisition" if item["method"] == "acquisition"
                                       and all(row["is_repeat_purchase"] for row in allocations) else "missing_attribution")
                if not recipients or any(reason != "service_unfulfilled" for reason in reasons):
                    recipients = [(None, Decimal(1))]
                amounts = largest_remainder(amount, [weight for _, weight in recipients])
                for (member_id, _), part in zip(recipients, amounts, strict=True):
                    if not part:
                        continue
                    line_reasons = reasons.copy()
                    if member_id is None and item["method"] != "fixed" and "missing_attribution" not in line_reasons:
                        line_reasons.append("missing_attribution")
                    line = {"order_id": order_id, "item_code": item["code"], "label": item["label"],
                            "group": item["group"], "member_id": member_id, "amount": str(money(part)),
                            "bucket": "held" if line_reasons or member_id is None else "due",
                            "held_reasons": line_reasons, "service_code": service_code}
                    if item.get("purchased_service_codes"):
                        line["purchased_service_codes"] = [row["code"] for row in required_services]
                    lines.append(line)
        assert sum((money(line["amount"]) for line in lines), ZERO) == total
        assert all(remaining == ZERO for remaining in remaining_orders)
        return total, lines

    async def preview(self, data: PreviewInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        inputs = await self._snapshot(data)
        total, lines = self._lines(inputs)
        digest = hashlib.sha256(document(inputs).encode()).hexdigest()
        row = TeamSettlement(policy_id=data.policy_id, product_sku=data.product_sku, period=data.period,
                             status="preview", version=1, fingerprint=digest, inputs_snapshot=document(inputs),
                             lines_snapshot=document(lines), total_amount=total, created_by_staff_id=actor["staff_id"])
        self.db.add(row)
        return await self._finish(actor, "settlement_preview", row)

    async def confirm(self, identity: int, data: ConfirmInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        row = await self._get(TeamSettlement, identity)
        self._version(row, data.expected_version)
        if row.status != "preview" or row.fingerprint != data.fingerprint:
            raise ConflictException("预览状态或校验值已变化")
        current = await self._snapshot(PreviewInput(policy_id=row.policy_id, product_sku=row.product_sku, period=row.period))
        if hashlib.sha256(document(current).encode()).hexdigest() != row.fingerprint:
            raise ConflictException("金额、归因、归属或履约已改变，请重新预览")
        lines = json.loads(row.lines_snapshot)
        total, recalculated = self._lines(current)
        if money(row.total_amount) != total or lines != recalculated:
            raise ConflictException("分配计算已变化，请重新预览后确认")
        for line in lines:
            self.db.add(TeamLedgerEntry(
                settlement_id=row.id, order_id=line["order_id"], member_id=line["member_id"],
                item_code=line["item_code"], bucket=line["bucket"], kind="allocation", amount=money(line["amount"]),
                note="人工确认结算", snapshot=document(line), created_by_staff_id=actor["staff_id"],
            ))
        for member_id in sorted({line["member_id"] for line in lines if line["member_id"]}):
            member = await self._get(TeamMember, member_id)
            member.ledger_version += 1
        for allocation in current["allocations"]:
            allocation_row = await self._get(TeamOrderAllocation, allocation["id"])
            allocation_row.confirmed_settlement_id = row.id
            allocation_row.version += 1
        row.status, row.version = "confirmed", row.version + 1
        row.confirmed_at, row.confirmed_by_staff_id = datetime.utcnow(), actor["staff_id"]
        return await self._finish(actor, "settlement_confirm", row)

    async def _entry_remaining(self, entry: TeamLedgerEntry) -> Decimal:
        adjustments = (await self.db.execute(select(TeamLedgerEntry.amount).where(
            TeamLedgerEntry.source_entry_id == entry.id, TeamLedgerEntry.bucket == entry.bucket,
            TeamLedgerEntry.amount < 0,
        ).with_for_update())).scalars().all()
        return money(entry.amount) + sum((money(value) for value in adjustments), ZERO)

    async def entry_balance(self, identity: int) -> dict[str, Any]:
        entry = await self._get(TeamLedgerEntry, identity)
        return {"entry": row_data(entry), "remaining": str(await self._entry_remaining(entry))}

    async def summary(self) -> dict[str, Any]:
        rows = (await self.db.execute(select(TeamLedgerEntry))).scalars().all()
        members = (await self.db.execute(select(TeamMember).order_by(TeamMember.id))).scalars().all()
        totals = {"due": ZERO, "held": ZERO, "paid": ZERO}
        balances = {row.id: {"due": ZERO, "held": ZERO, "paid": ZERO} for row in members}
        for entry in rows:
            totals[entry.bucket] += money(entry.amount)
            if entry.member_id in balances:
                balances[entry.member_id][entry.bucket] += money(entry.amount)
        def amounts(values: dict[str, Decimal]) -> dict[str, str]:
            return {key: str(value) for key, value in values.items()} | {"unpaid": str(values["due"] - values["paid"])}
        return {"totals": amounts(totals), "members": [row_data(row) | amounts(balances[row.id]) for row in members]}

    async def payment(self, data: PaymentInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        existing = (await self.db.execute(select(TeamLedgerEntry).where(
            TeamLedgerEntry.idempotency_key == data.idempotency_key,
        ).with_for_update())).scalar_one_or_none()
        if existing:
            if existing.kind == "payment" and json.loads(existing.snapshot) == data.model_dump(mode="json"):
                return row_data(existing)
            raise ConflictException("幂等键已用于不同操作")
        member = await self._active_member(data.member_id)
        if member.ledger_version != data.expected_ledger_version:
            raise ConflictException("成员余额已更新，请刷新后登记付款")
        entries = (await self.db.execute(select(TeamLedgerEntry).where(
            TeamLedgerEntry.member_id == member.id,
        ).with_for_update())).scalars().all()
        order_ids = sorted({entry.order_id for entry in entries if entry.order_id})
        for order_id in order_ids:
            # Share the real order lock with the existing refund state machine.
            await self._get(Order, order_id)
        if await self._pending_refunds(order_ids):
            raise ConflictException("成员关联订单存在待核对退款，暂停新增付款登记")
        balance = sum((money(entry.amount) * (1 if entry.bucket == "due" else -1 if entry.bucket == "paid" else 0)
                       for entry in entries), ZERO)
        if data.amount <= 0 or data.amount > balance:
            raise ValidationException("付款金额必须大于零且不超过已确认未付余额")
        row = TeamLedgerEntry(member_id=member.id, bucket="paid", kind="payment", amount=data.amount,
                              note=data.note, evidence=data.evidence, idempotency_key=data.idempotency_key,
                              snapshot=document(data.model_dump(mode="json")), created_by_staff_id=actor["staff_id"])
        self.db.add(row)
        member.ledger_version += 1
        return await self._finish(actor, "payment_record", row)

    async def release_held(self, entry_id: int, data: ReleaseInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        existing = (await self.db.execute(select(TeamLedgerEntry).where(
            TeamLedgerEntry.idempotency_key == data.idempotency_key,
        ).with_for_update())).scalar_one_or_none()
        expected_snapshot = data.model_dump(mode="json") | {"source_entry_id": entry_id}
        if existing:
            if existing.kind == "release" and json.loads(existing.snapshot).get("request") == expected_snapshot:
                return row_data(existing)
            raise ConflictException("幂等键已用于不同操作")
        entry = await self._get(TeamLedgerEntry, entry_id)
        if entry.bucket != "held" or entry.amount <= 0 or entry.kind not in ("allocation", "adjustment"):
            raise ValidationException("只能释放尚有余额的原始暂留明细")
        await self._get(Order, entry.order_id)
        if await self._pending_refunds([entry.order_id]):
            raise ConflictException("该订单退款待核对，不能释放暂留")
        remaining = await self._entry_remaining(entry)
        if remaining != data.expected_remaining:
            raise ConflictException("暂留余额已更新，请刷新")
        if data.amount <= 0 or data.amount > remaining:
            raise ValidationException("释放金额超过暂留余额")
        original = json.loads(entry.snapshot)
        if original.get("service_code"):
            if not await self._is_service_complete(entry.order_id, original["service_code"]):
                raise ConflictException("对应服务尚未全部履约，请先登记真实履约证据")
        if original.get("purchased_service_codes"):
            if not await self._purchased_services_complete(entry.order_id, original["purchased_service_codes"]):
                raise ConflictException("对应已购服务尚未完成有效次数，不能用内部职责证明代替")
        member = await self._active_member(data.member_id)
        if entry.member_id and entry.member_id != member.id:
            raise ConflictException("已有明确承担人的暂留不可直接转给其他成员")
        origin = await self._held_release_origin(entry)
        if origin.member_id and origin.member_id != member.id:
            raise ConflictException("已有明确承担人的暂留不可通过调账转给其他成员")
        if origin.member_id is None:
            await self._validate_release_ownership(origin, member.id, data.amount)
        for bucket, amount, target_member in (("held", -data.amount, entry.member_id), ("due", data.amount, member.id)):
            row = TeamLedgerEntry(settlement_id=entry.settlement_id, order_id=entry.order_id,
                                  member_id=target_member, item_code=entry.item_code, bucket=bucket, kind="release",
                                  amount=amount, source_entry_id=entry.id, note=data.note, evidence=data.evidence,
                                  idempotency_key=data.idempotency_key if bucket == "due" else None,
                                  snapshot=document(original | {"request": expected_snapshot}),
                                  created_by_staff_id=actor["staff_id"])
            self.db.add(row)
        member.ledger_version += 1
        return await self._finish(actor, "held_release", row)

    async def _held_release_origin(self, entry: TeamLedgerEntry) -> TeamLedgerEntry:
        """Held-to-held adjustments retain the original release restrictions."""
        while entry.kind == "adjustment" and entry.source_entry_id:
            source = await self._get(TeamLedgerEntry, entry.source_entry_id)
            if source.bucket != "held":
                break
            entry = source
        return entry

    async def _validate_release_ownership(self, entry: TeamLedgerEntry, member_id: int, amount: Decimal) -> None:
        if "no_new_acquisition" in json.loads(entry.snapshot).get("held_reasons", []):
            raise ConflictException("本期仅有复购，不能将其确认为新增获客报酬")
        settlement = await self._get(TeamSettlement, entry.settlement_id)
        item = next(item for item in json.loads(settlement.inputs_snapshot)["policy"]["items"]
                    if item["code"] == entry.item_code)
        if item["method"] != "fixed":
            # Missing attribution is resolved by this explicit member, evidence
            # and append-only release; it never rewrites the period snapshot.
            return
        order = await self._get(Order, entry.order_id)
        paid_date = order.paid_at.date()
        ownership = (await self.db.execute(select(TeamOwnership).where(
            TeamOwnership.policy_id == settlement.policy_id,
            TeamOwnership.product_sku == settlement.product_sku,
            TeamOwnership.item_code == entry.item_code,
            TeamOwnership.starts_on <= paid_date,
            or_(TeamOwnership.ends_on.is_(None), TeamOwnership.ends_on >= paid_date),
        ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        weights = json.loads(ownership.members) if ownership else []
        if not ownership or ownership.disputed or sum((Decimal(row["weight"]) for row in weights), Decimal(0)) != 1:
            raise ConflictException("请先补齐该职责承担人和比例并解决争议，再释放暂留")
        for row in weights:
            await self._active_member(row["member_id"])
        shares = largest_remainder(money(entry.amount), [Decimal(row["weight"]) for row in weights])
        allowance = sum((share for row, share in zip(weights, shares, strict=True) if row["member_id"] == member_id), ZERO)
        # Moving/splitting held money cannot create a fresh per-member allowance.
        branches = (await self.db.execute(select(TeamLedgerEntry.id, TeamLedgerEntry.source_entry_id).where(
            TeamLedgerEntry.settlement_id == entry.settlement_id,
            TeamLedgerEntry.order_id == entry.order_id, TeamLedgerEntry.item_code == entry.item_code,
            TeamLedgerEntry.kind == "adjustment", TeamLedgerEntry.bucket == "held", TeamLedgerEntry.amount > 0,
        ).with_for_update())).all()
        source_ids = {entry.id}
        while descendants := {identity for identity, parent_id in branches if parent_id in source_ids} - source_ids:
            source_ids.update(descendants)
        released = (await self.db.execute(select(TeamLedgerEntry.amount).where(
            TeamLedgerEntry.source_entry_id.in_(source_ids), TeamLedgerEntry.member_id == member_id,
            TeamLedgerEntry.kind == "release", TeamLedgerEntry.bucket == "due", TeamLedgerEntry.amount > 0,
        ).with_for_update())).scalars().all()
        if amount + sum((money(value) for value in released), ZERO) > allowance:
            raise ValidationException("释放金额超过该成员在当前完整职责归属中的份额")

    async def adjustment(self, entry_id: int, data: AdjustmentInput, actor: dict[str, Any]) -> dict[str, Any]:
        """Reassign or hold an existing allocation with an equal counter-entry."""
        await self._guard()
        expected_snapshot = data.model_dump(mode="json") | {"source_entry_id": entry_id}
        existing = (await self.db.execute(select(TeamLedgerEntry).where(
            TeamLedgerEntry.idempotency_key == data.idempotency_key,
        ).with_for_update())).scalar_one_or_none()
        if existing:
            if existing.kind == "adjustment" and json.loads(existing.snapshot).get("request") == expected_snapshot:
                return row_data(existing)
            raise ConflictException("幂等键已用于不同操作")
        entry = await self._get(TeamLedgerEntry, entry_id)
        if entry.bucket not in ("due", "held") or entry.amount <= 0:
            raise ValidationException("只能调整正向应分或暂留明细")
        await self._get(Order, entry.order_id)
        if await self._pending_refunds([entry.order_id]):
            raise ConflictException("退款核对期间不能改变归属，请先完成退款调整")
        remaining = await self._entry_remaining(entry)
        if remaining != data.expected_remaining:
            raise ConflictException("明细余额已变化，请刷新")
        if data.amount <= 0 or data.amount > remaining:
            raise ValidationException("调账金额超过对应明细余额")
        if data.target_bucket == entry.bucket and data.target_member_id == entry.member_id:
            raise ValidationException("调整前后成员和状态相同")
        original = json.loads(entry.snapshot)
        if data.target_bucket == "due" and entry.bucket == "held":
            raise ValidationException("暂留转应分请使用履约与归属核对后的释放入口")
        for member_id in sorted({value for value in (entry.member_id, data.target_member_id) if value}):
            member = await self._get(TeamMember, member_id)
            if member_id == data.target_member_id and not member.active:
                raise ConflictException("目标成员已停用")
            member.ledger_version += 1
        for bucket, amount, member_id in ((entry.bucket, -data.amount, entry.member_id),
                                         (data.target_bucket, data.amount, data.target_member_id)):
            row = TeamLedgerEntry(settlement_id=entry.settlement_id, order_id=entry.order_id, member_id=member_id,
                                  item_code=entry.item_code, bucket=bucket, kind="adjustment", amount=amount,
                                  source_entry_id=entry.id, note=data.note, evidence=data.evidence,
                                  idempotency_key=data.idempotency_key if amount > 0 else None,
                                  snapshot=document(original | {"request": expected_snapshot}), created_by_staff_id=actor["staff_id"])
            self.db.add(row)
        return await self._finish(actor, "balanced_adjustment", row)

    async def partial_refund(self, order_id: int, data: PartialRefundInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        request_snapshot = data.model_dump(mode="json") | {"order_id": order_id}
        existing = (await self.db.execute(select(TeamRefundReview).where(
            TeamRefundReview.idempotency_key == data.idempotency_key,
        ).with_for_update())).scalar_one_or_none()
        if existing:
            if json.loads(existing.request_snapshot or "{}") == request_snapshot:
                return row_data(existing)
            raise ConflictException("幂等键已用于不同退款请求")
        order = await self._get(Order, order_id)
        snapshot = (await self.db.execute(select(CommercialOrderSnapshot).where(
            CommercialOrderSnapshot.order_id == order_id,
        ).with_for_update())).scalar_one_or_none()
        if not snapshot or snapshot.settlement_mode != "manual":
            raise ConflictException("旧订单继续使用原退款流程")
        if order.agency_id is not None:
            raise ConflictException("代理订单部分退款需先核对独立佣金；当前接口不自动冲减代理佣金")
        if order.status != OrderStatus.PAID:
            raise ConflictException("订单不处于可退款状态")
        if money(order.refund_amount) != data.expected_refunded_total:
            raise ConflictException("累计退款金额已变化，请刷新后重试")
        new_total = money(order.refund_amount) + data.amount
        if data.amount <= 0 or new_total > money(order.amount):
            raise ValidationException("退款金额须大于零且累计不能超过实收")
        order.refund_amount = new_total
        order.refund_reason = data.reason
        order.refunded_at = datetime.utcnow()
        order.updated_by_staff_id = actor["staff_id"]
        if new_total == money(order.amount):
            order.status = OrderStatus.REFUNDED
        review = await self.record_refund(order, data.reason, actor)
        review.idempotency_key = data.idempotency_key
        review.request_snapshot = document(request_snapshot)
        return await self._finish(actor, "partial_refund_record", review)

    async def record_refund(self, order: Order, reason: str, actor: dict[str, Any]) -> TeamRefundReview:
        """Order-service hook: caller owns the order lock and commits atomically.

        Never auto-pro-rate completed services or rewrite prior entries. A pending
        review blocks new payments until explicit, item-specific adjustments.
        """
        existing = (await self.db.execute(select(TeamRefundReview).where(
            TeamRefundReview.order_id == order.id, TeamRefundReview.refunded_total == order.refund_amount,
        ))).scalar_one_or_none()
        if existing:
            return existing
        review = TeamRefundReview(order_id=order.id, refunded_total=order.refund_amount, status="pending", version=1,
                                  reason=reason, created_by_staff_id=actor["staff_id"])
        self.db.add(review)
        await self.db.flush()
        return review

    async def resolve_refund(self, identity: int, data: RefundResolveInput, actor: dict[str, Any]) -> dict[str, Any]:
        await self._guard()
        review = await self._get(TeamRefundReview, identity)
        self._version(review, data.expected_version)
        if review.status != "pending":
            raise ConflictException("退款核对已经完成")
        order = await self._get(Order, review.order_id)
        if money(order.refund_amount) != money(review.refunded_total):
            raise ConflictException("退款金额已再次改变，请先处理最新核对记录")
        reductions = []
        for reduction in data.reductions:
            entry = await self._get(TeamLedgerEntry, reduction.entry_id)
            if entry.order_id != order.id or entry.bucket not in ("due", "held") or entry.amount <= 0:
                raise ValidationException("只能调整该订单的正向应分或暂留明细")
            remaining = await self._entry_remaining(entry)
            if reduction.expected_remaining != remaining:
                raise ConflictException("退款明细余额已改变，请刷新后重新核对")
            if reduction.amount <= 0 or reduction.amount > remaining:
                raise ValidationException("冲减金额不能超过对应明细剩余额度")
            reductions.append((entry, reduction.amount))
        allocation = (await self.db.execute(select(TeamOrderAllocation).where(
            TeamOrderAllocation.order_id == order.id,
        ).with_for_update())).scalar_one_or_none()
        previous = (await self.db.execute(select(TeamLedgerEntry.amount).where(
            TeamLedgerEntry.order_id == order.id, TeamLedgerEntry.kind == "refund",
        ).with_for_update())).scalars().all()
        net = money(order.amount) - money(order.refund_amount)
        if allocation and allocation.confirmed_settlement_id:
            base = money(allocation.amount) + sum((money(value) for value in previous), ZERO)
            if base - sum((amount for _, amount in reductions), ZERO) > net:
                raise ValidationException("调整后分配总额仍超过订单净实收，请按对应项目补充冲减")
        elif reductions:
            raise ValidationException("未确认结算的订单没有可冲减成员明细")
        elif allocation and money(allocation.amount) > net:
            raise ConflictException("请先将未结算订单的分配金额调至退款后的净实收以内")
        for entry, amount in reductions:
            self.db.add(TeamLedgerEntry(
                settlement_id=entry.settlement_id, order_id=order.id, member_id=entry.member_id,
                item_code=entry.item_code, bucket=entry.bucket, kind="refund", amount=-amount,
                source_entry_id=entry.id, note=data.note, evidence=data.evidence,
                snapshot=document({"review_id": review.id, "refunded_total": str(review.refunded_total),
                                   "source": json.loads(entry.snapshot)}), created_by_staff_id=actor["staff_id"],
            ))
        for member_id in sorted({entry.member_id for entry, _ in reductions if entry.member_id}):
            member = await self._get(TeamMember, member_id)
            member.ledger_version += 1
        review.status, review.version = "resolved", review.version + 1
        review.resolved_at, review.resolved_by_staff_id = datetime.utcnow(), actor["staff_id"]
        review.resolution_snapshot = document(data.model_dump(mode="json"))
        # Older cumulative reviews become resolved by the latest explicit snapshot.
        old_reviews = (await self.db.execute(select(TeamRefundReview).where(
            TeamRefundReview.order_id == order.id, TeamRefundReview.status == "pending", TeamRefundReview.id != review.id,
        ).with_for_update())).scalars().all()
        for old in old_reviews:
            old.status, old.version = "resolved", old.version + 1
            old.resolved_at, old.resolved_by_staff_id = review.resolved_at, actor["staff_id"]
            old.resolution_snapshot = document({"superseded_by_review_id": review.id})
        return await self._finish(actor, "refund_resolve", review)
