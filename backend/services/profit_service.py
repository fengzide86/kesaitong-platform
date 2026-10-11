"""Versioned profit policy and reversible ledger operations."""

import json
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.config import settings
from core.exceptions import ConflictException, ValidationException
from core.transaction_locks import acquire_transaction_guard
from models import Order, ProfitRecord, ProfitStatus, Setting
from schemas.profit import PROFIT_KEYS, ProfitRatios

CENT = Decimal("0.01")


def _decimal(value: object) -> Decimal:
    return Decimal(str(value))


def _serialize_ratios(ratios: ProfitRatios) -> dict[str, str]:
    return {key: str(getattr(ratios, key)) for key in PROFIT_KEYS}


class ProfitService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_policy(self, *, locked: bool = False) -> tuple[int, ProfitRatios]:
        query = select(Setting).where(Setting.key == "profit_ratios")
        if locked:
            query = query.with_for_update().execution_options(populate_existing=True)
        result = await self.db.execute(
            query
        )
        setting = result.scalar_one_or_none()
        if not setting or not setting.value:
            document: dict = {"version": 1, "ratios": settings.DEFAULT_PROFIT_RATIOS}
        else:
            try:
                document = json.loads(setting.value)
            except (json.JSONDecodeError, TypeError) as error:
                raise ConflictException("当前分润策略损坏，请先由超级管理员修复") from error
            if "ratios" not in document:
                document = {"version": 1, "ratios": document}
        try:
            version = max(int(document.get("version", 1)), 1)
            ratios = ProfitRatios.model_validate(document.get("ratios", {}))
        except (TypeError, ValueError) as error:
            raise ConflictException("当前分润策略无效，请先由超级管理员修复") from error
        return version, ratios

    async def update_policy(
        self,
        ratios: ProfitRatios,
        actor: dict,
        request: Request,
        expected_version: int | None = None,
    ) -> dict:
        await acquire_transaction_guard(self.db, "profit_policy")
        current_version, current_ratios = await self.get_policy(locked=True)
        if expected_version is not None and expected_version != current_version:
            raise ConflictException("分润策略已被其他管理员更新，请刷新后重试")
        new_version = current_version + 1
        document = {"version": new_version, "ratios": _serialize_ratios(ratios)}
        result = await self.db.execute(
            select(Setting).where(Setting.key == "profit_ratios").with_for_update()
        )
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = json.dumps(document, ensure_ascii=False)
            setting.description = "带版本的分润比例策略"
        else:
            self.db.add(
                Setting(
                    key="profit_ratios",
                    value=json.dumps(document, ensure_ascii=False),
                    description="带版本的分润比例策略",
                )
            )
        await log_admin_action(
            self.db,
            user_id=actor["staff_id"],
            user_name=actor["username"],
            action="profit_policy_update",
            target_type="profit_policy",
            target_id=str(new_version),
            detail={
                "role": actor["role"],
                "before": {
                    "version": current_version,
                    "ratios": _serialize_ratios(current_ratios),
                },
                "after": document,
            },
            request=request,
        )
        await self.db.commit()
        return document

    async def create_for_paid_order(self, order: Order, actor: dict) -> ProfitRecord:
        existing_result = await self.db.execute(
            select(ProfitRecord).where(ProfitRecord.order_id == order.id)
        )
        if existing_result.scalar_one_or_none():
            raise ConflictException("该订单已存在分润记录")

        version, ratios = await self.get_policy()
        amount = _decimal(order.amount).quantize(CENT, rounding=ROUND_HALF_UP)
        shares: dict[str, Decimal] = {}
        allocated = Decimal("0")
        for key in PROFIT_KEYS[:-1]:
            share = (amount * getattr(ratios, key)).quantize(CENT, rounding=ROUND_HALF_UP)
            shares[key] = share
            allocated += share
        shares[PROFIT_KEYS[-1]] = amount - allocated
        if shares[PROFIT_KEYS[-1]] < 0:
            raise ValidationException("分润舍入结果无效")

        record = ProfitRecord(
            order_id=order.id,
            status=ProfitStatus.ACTIVE,
            policy_version=version,
            ratios_snapshot=json.dumps(_serialize_ratios(ratios), ensure_ascii=False),
            order_amount_snapshot=amount,
            tech_share=shares["tech"],
            market_share=shares["market"],
            product_share=shares["product"],
            service_share=shares["service"],
            coordination_share=shares["coordination"],
            record_share=shares["record"],
            created_by_staff_id=actor["staff_id"],
        )
        self.db.add(record)
        await self.db.flush()
        return record

    async def reverse_for_refund(self, order: Order, reason: str) -> ProfitRecord:
        result = await self.db.execute(
            select(ProfitRecord)
            .where(ProfitRecord.order_id == order.id)
            .with_for_update()
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ConflictException("订单缺少分润记录，请先修复内部账本后再退款")
        if record.status != ProfitStatus.ACTIVE:
            raise ConflictException("订单分润已经冲正")
        record.status = ProfitStatus.REVERSED
        record.reversed_at = datetime.utcnow()
        record.reversal_reason = reason
        return record

    async def list_records(
        self,
        page: int,
        page_size: int,
        platform_key: str | None,
        ledger_status: str | None,
    ) -> dict:
        filters = []
        if platform_key:
            filters.append(or_(Order.platform_key == platform_key, Order.platform_key.is_(None)))
        if ledger_status:
            if ledger_status not in ProfitStatus.ALL:
                raise ValidationException("分润状态无效")
            filters.append(ProfitRecord.status == ledger_status)
        base = select(ProfitRecord).join(Order, ProfitRecord.order_id == Order.id).where(*filters)
        count_result = await self.db.execute(
            select(func.count()).select_from(base.order_by(None).subquery())
        )
        result = await self.db.execute(
            base.order_by(ProfitRecord.created_at.desc(), ProfitRecord.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = [self.serialize_record(item) for item in result.scalars().all()]
        return {
            "success": True,
            "message": "ok",
            "data": items,
            "page": page,
            "page_size": page_size,
            "total": int(count_result.scalar() or 0),
        }

    async def summary(self, platform_key: str | None) -> dict:
        async def totals(ledger_status: str) -> tuple[Decimal, ...]:
            query = (
                select(
                    func.coalesce(func.sum(ProfitRecord.tech_share), 0),
                    func.coalesce(func.sum(ProfitRecord.market_share), 0),
                    func.coalesce(func.sum(ProfitRecord.product_share), 0),
                    func.coalesce(func.sum(ProfitRecord.service_share), 0),
                    func.coalesce(func.sum(ProfitRecord.coordination_share), 0),
                    func.coalesce(func.sum(ProfitRecord.record_share), 0),
                )
                .join(Order, ProfitRecord.order_id == Order.id)
                .where(ProfitRecord.status == ledger_status)
            )
            if platform_key:
                query = query.where(
                    or_(Order.platform_key == platform_key, Order.platform_key.is_(None))
                )
            row = (await self.db.execute(query)).one()
            return tuple(_decimal(value) for value in row)

        active = await totals(ProfitStatus.ACTIVE)
        reversed_values = await totals(ProfitStatus.REVERSED)
        active_total = sum(active, Decimal("0"))
        reversed_total = sum(reversed_values, Decimal("0"))

        def breakdown(values: tuple[Decimal, ...], grand_total: Decimal) -> dict:
            return {
                key: float(value)
                for key, value in zip(PROFIT_KEYS, values, strict=True)
            } | {"grand_total": float(grand_total)}

        return {
            # Structured ledgers are the canonical representation.  Keep the
            # flat fields below for existing dashboard consumers.
            "active": breakdown(active, active_total),
            "reversed": breakdown(reversed_values, reversed_total),
            "total_tech": float(active[0]),
            "total_market": float(active[1]),
            "total_product": float(active[2]),
            "total_service": float(active[3]),
            "total_coordination": float(active[4]),
            "total_record": float(active[5]),
            "grand_total": float(active_total),
            "reversed_total": float(reversed_total),
            "gross_total": float(active_total + reversed_total),
        }

    @staticmethod
    def serialize_record(record: ProfitRecord) -> dict:
        return {
            "id": record.id,
            "order_id": record.order_id,
            "status": record.status,
            "policy_version": record.policy_version,
            "ratios_snapshot": record.ratios_snapshot,
            "order_amount_snapshot": float(record.order_amount_snapshot),
            "tech_share": float(record.tech_share),
            "market_share": float(record.market_share),
            "product_share": float(record.product_share),
            "service_share": float(record.service_share),
            "coordination_share": float(record.coordination_share),
            "record_share": float(record.record_share),
            "reversed_at": record.reversed_at.isoformat() if record.reversed_at else None,
            "reversal_reason": record.reversal_reason,
            "created_by_staff_id": record.created_by_staff_id,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }
