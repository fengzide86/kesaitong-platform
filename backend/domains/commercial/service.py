"""Transactional commerce. New snapshots never mutate historical plan rights."""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException, Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.exceptions import ConflictException, NotFoundException, ValidationException
from models import AuthCode, LaunchToken, Order, OrderStatus, Setting, StaffUser, User
from models.commercial import (
    CommercialGrant,
    CommercialOfferVersion,
    CommercialOrderSnapshot,
    CommercialRefundEntitlementReview,
    ServiceFulfillment,
    ServiceFulfillmentEvent,
    TrialQuota,
    TrialReservation,
)
from schemas.commercial import CommercialOrderCreate, OfferDefinition, TrialGrantCreate

from .catalog import CAPABILITY_ALIASES, TRIAL_CAPABILITIES, canonical_offer, draft_templates


def encode(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def utc_naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None)


def timestamp(value: datetime | None) -> str | None:
    return value.replace(tzinfo=UTC).isoformat() if value else None


def trial_operation_id(token: str) -> str:
    """Opaque binding without duplicating a live launch credential in quota records."""
    return "trial:launch:" + hashlib.sha256(token.encode()).hexdigest()


class CommercialService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def audit(self, actor: dict, action: str, target: int, detail: dict, request: Request | None = None) -> None:
        await log_admin_action(self.db, user_id=actor["staff_id"], user_name=actor["username"],
                               action=action, target_type="commercial", target_id=target,
                               detail=detail, request=request)

    async def offers(self) -> list[dict]:
        rows = (await self.db.scalars(select(CommercialOfferVersion).order_by(CommercialOfferVersion.sku, CommercialOfferVersion.version.desc()))).all()
        return [self.offer_dict(row) for row in rows]

    @staticmethod
    def offer_dict(row: CommercialOfferVersion) -> dict:
        return {"id": row.id, "sku": row.sku, "version": row.version, "revision": row.revision,
                "status": row.status, "definition": json.loads(row.definition), "activated_at": timestamp(row.activated_at)}

    async def offer(self, offer_id: int, *, active: bool = False) -> CommercialOfferVersion:
        row = await self.db.get(CommercialOfferVersion, offer_id, populate_existing=True)
        if not row:
            raise NotFoundException("商品版本不存在")
        if active and row.status != "active":
            raise ConflictException("只能使用人工确认启用的商品版本")
        return row

    async def create_draft(self, sku: str, definition: OfferDefinition, actor: dict, request: Request | None = None) -> dict:
        definition = canonical_offer(OfferDefinition.model_validate(definition))
        version = int(await self.db.scalar(select(func.max(CommercialOfferVersion.version)).where(CommercialOfferVersion.sku == sku)) or 0) + 1
        row = CommercialOfferVersion(sku=sku, version=version, revision=1, status="draft",
                                     definition=encode(definition.model_dump(mode="json")), created_by_staff_id=actor["staff_id"])
        self.db.add(row)
        try:
            await self.db.flush()
            await self.audit(actor, "commercial_offer_draft", row.id, {"sku": sku, "version": version}, request)
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("商品版本已被其他管理员更新，请刷新") from error
        return self.offer_dict(row)

    async def seed_drafts(self, actor: dict, request: Request | None = None) -> list[dict]:
        # Repeated requests do not create duplicate versions or activate prices.
        existing = set((await self.db.scalars(select(CommercialOfferVersion.sku))).all())
        for template in draft_templates():
            if template["sku"] not in existing:
                await self.create_draft(template["sku"], OfferDefinition.model_validate(template["definition"]), actor, request)
        return await self.offers()

    async def update_draft(self, offer_id: int, expected_revision: int, definition: OfferDefinition, actor: dict, request: Request | None = None) -> dict:
        definition = canonical_offer(OfferDefinition.model_validate(definition))
        result = await self.db.execute(update(CommercialOfferVersion).where(
            CommercialOfferVersion.id == offer_id, CommercialOfferVersion.status == "draft",
            CommercialOfferVersion.revision == expected_revision,
        ).values(definition=encode(definition.model_dump(mode="json")), revision=expected_revision + 1))
        if result.rowcount != 1:
            raise ConflictException("仅可修改当前版本草稿，请刷新后重试")
        await self.audit(actor, "commercial_offer_edit", offer_id, {"revision": expected_revision + 1}, request)
        await self.db.commit()
        return self.offer_dict(await self.offer(offer_id))

    async def activate(self, offer_id: int, expected_revision: int, actor: dict, request: Request | None = None) -> dict:
        row = await self.offer(offer_id)
        if row.status != "draft" or row.revision != expected_revision:
            raise ConflictException("商品草稿已变化或已启用，请刷新")
        spec = OfferDefinition.model_validate_json(row.definition)
        if spec.business_line == "single_tool":
            selectable = {item["capability"] for item in await self.tool_options() if item["selectable"]}
            if spec.price != Decimal("39") or len(spec.allowed_capabilities) != 1 or spec.allowed_capabilities[0] not in selectable or row.sku == "single-tool-39":
                raise ValidationException("39 元单工具需使用独立 SKU，且绑定一个已经审核开放的工具")
        # A nullable unique active slot is portable across SQLite/Postgres/MariaDB.
        await self.db.execute(update(CommercialOfferVersion).where(
            CommercialOfferVersion.sku == row.sku, CommercialOfferVersion.status == "active",
        ).values(status="retired", active_sku=None, revision=CommercialOfferVersion.revision + 1))
        result = await self.db.execute(update(CommercialOfferVersion).where(
            CommercialOfferVersion.id == offer_id, CommercialOfferVersion.status == "draft",
            CommercialOfferVersion.revision == expected_revision,
        ).values(status="active", active_sku=row.sku, revision=expected_revision + 1, activated_by_staff_id=actor["staff_id"], activated_at=datetime.utcnow()))
        if result.rowcount != 1:
            await self.db.rollback()
            raise ConflictException("商品确认存在版本冲突")
        await self.audit(actor, "commercial_offer_activate", offer_id, {"sku": row.sku, "version": row.version}, request)
        try:
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("商品启用发生并发冲突，请刷新") from error
        return self.offer_dict(await self.offer(offer_id))

    async def tool_options(self) -> list[dict]:
        setting = await self.db.scalar(select(Setting).where(Setting.key == "tool_configs"))
        try:
            tools = json.loads(setting.value) if setting else []
        except (TypeError, ValueError):
            tools = []
        if not isinstance(tools, list):
            return []
        options = []
        for item in tools:
            if not isinstance(item, dict):
                continue
            capability = item.get("capability_key")
            if not isinstance(capability, str) or not capability:
                continue
            options.append({"tool_id": item.get("id"), "name": item.get("name", ""),
                            "capability": CAPABILITY_ALIASES.get(capability, capability),
                            "selectable": item.get("availability") in {"live", "live_beta"}
                                          and item.get("script_status") == "script_ready"
                                          and item.get("release_status", "available") in {"available", "beta"}})
        return options

    async def export_catalog(self) -> dict:
        items = []
        for row in (await self.db.scalars(select(CommercialOfferVersion).where(CommercialOfferVersion.status == "active").order_by(CommercialOfferVersion.sku))).all():
            spec = OfferDefinition.model_validate_json(row.definition)
            # Explicit projection; no model __dict__, actor, internal policy, or source document.
            items.append({"sku": row.sku, "version": row.version, "name": spec.name,
                          "price": str(spec.price), "business_line": spec.business_line,
                          "term_type": spec.term_type, "description": spec.description,
                          "allowed_capabilities": spec.allowed_capabilities,
                          "services": [item.model_dump() for item in spec.services], "availability": spec.availability})
        return {"schema_version": 1, "catalog_version": hashlib.sha256(encode({"items": items}).encode()).hexdigest()[:16], "items": items}

    @staticmethod
    def scope(spec: OfferDefinition, req: CommercialOrderCreate | TrialGrantCreate) -> tuple[str | None, str | None, datetime | None]:
        if spec.term_type == "service_fulfillment":
            return None, None, None
        if not req.project_id or not req.site_origin or not req.ends_at:
            raise ValidationException("比赛和实训必须填写项目、准确站点及结束时间")
        end = utc_naive(req.ends_at)
        if end <= datetime.utcnow():
            raise ValidationException("项目结束时间必须晚于当前时间")
        if (spec.business_line == "competition" or (spec.business_line == "single_tool" and req.scene_type == "competition")) and req.site_origin != "https://www.idtrade.cn":
            raise ValidationException("比赛商品仅适用管理员指定的比赛官网")
        return req.project_id, req.site_origin, end

    async def create_order(self, req: CommercialOrderCreate, actor: dict, request: Request | None = None) -> dict:
        offer = await self.offer(req.offer_id, active=True)
        spec = OfferDefinition.model_validate_json(offer.definition)
        if spec.business_line == "trial":
            raise ValidationException("免费体验使用独立免费授权，不创建付款订单")
        project, origin, end = self.scope(spec, req)
        from services.order_service import OrderService
        order = Order(order_no=OrderService._new_order_no(), plan_id=None, amount=spec.price,
                      plan_name_snapshot=spec.name, plan_price_snapshot=spec.price, plan_duration_days_snapshot=0,
                      status=OrderStatus.PENDING, refund_amount=Decimal("0"), platform_key=req.platform_key,
                      channel=req.channel, responsible=req.responsible,
                      created_by_staff_id=actor["staff_id"], updated_by_staff_id=actor["staff_id"])
        self.db.add(order)
        await self.db.flush()
        snapshot = {"schema_version": 1, "sku": offer.sku, "offer_version": offer.version,
                    "definition": spec.model_dump(mode="json"), "project_id": project,
                    "site_origin": origin, "ends_at": timestamp(end), "platform_key": req.platform_key,
                    "scene_type": "competition" if spec.business_line == "competition" else req.scene_type if spec.business_line == "single_tool" else "training"}
        self.db.add(CommercialOrderSnapshot(order_id=order.id, offer_id=offer.id, sku=offer.sku,
                    offer_version=offer.version, settlement_mode="manual", snapshot=encode(snapshot),
                    project_id=project, site_origin=origin, ends_at=end))
        for service in spec.services:
            self.db.add(ServiceFulfillment(order_id=order.id, service_code=service.code, total_count=service.count,
                                          minutes_per_unit=service.minutes_per_unit, completed_count=0, revision=1))
        await self.audit(actor, "commercial_order_create", order.id, {"sku": offer.sku, "version": offer.version}, request)
        await self.db.commit()
        return await self.order_detail(order.id)

    async def orders(self) -> list[dict]:
        ids = (await self.db.scalars(select(CommercialOrderSnapshot.order_id).order_by(CommercialOrderSnapshot.id.desc()).limit(200))).all()
        return [await self.order_detail(order_id) for order_id in ids]

    async def order_detail(self, order_id: int) -> dict:
        from services.order_service import OrderService
        order = await self.db.get(Order, order_id)
        snapshot = await self.db.scalar(select(CommercialOrderSnapshot).where(CommercialOrderSnapshot.order_id == order_id))
        if not order or not snapshot:
            raise NotFoundException("版本化商品订单不存在")
        return {**OrderService.serialize(order), "commercial": json.loads(snapshot.snapshot), "settlement_mode": "manual"}

    async def issue_order_grant(self, order_id: int, actor: dict, request: Request | None = None) -> dict:
        order = await self.db.scalar(select(Order).where(Order.id == order_id).with_for_update())
        snapshot = await self.db.scalar(select(CommercialOrderSnapshot).where(CommercialOrderSnapshot.order_id == order_id))
        if not order or not snapshot:
            raise NotFoundException("商品订单不存在")
        if order.status != OrderStatus.PAID:
            raise ConflictException("收款后才可发放工具授权")
        if order.refund_amount and not await current_refund_review(self.db, order):
            raise ConflictException("退款后的剩余工具权益尚未核对，不能发放新授权")
        existing = await self.db.scalar(select(CommercialGrant).where(CommercialGrant.order_id == order_id))
        if existing:
            return await self.grant_dict(existing, include_code=True)
        if not snapshot.ends_at or snapshot.ends_at <= datetime.utcnow():
            raise ConflictException("单独服务不发工具授权，或项目已经结束")
        grant = await self._new_grant(snapshot.offer_id, json.loads(snapshot.snapshot), actor, order_id=order_id)
        await self.audit(actor, "commercial_grant_issue", grant.id, {"order_id": order_id}, request)
        try:
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("该订单已发放授权，请刷新") from error
        return await self.grant_dict(grant, include_code=True)

    async def issue_trial(self, req: TrialGrantCreate, actor: dict, request: Request | None = None) -> dict:
        user = await self.db.get(User, req.user_id)
        if not user or not user.is_active:
            raise NotFoundException("体验用户不存在或已停用")
        offer = await self.offer(req.offer_id, active=True)
        spec = OfferDefinition.model_validate_json(offer.definition)
        if spec.business_line != "trial":
            raise ValidationException("只能发放免费体验商品")
        if set(TRIAL_CAPABILITIES) - set(spec.allowed_capabilities):
            raise ValidationException("免费体验必须包含注册、上品、物流模板三项")
        project, origin, end = self.scope(spec, req)
        claim_key = f"trial:user:{req.user_id}"
        existing = await self.db.scalar(select(CommercialGrant).where(CommercialGrant.claim_key == claim_key))
        if existing:
            return await self.grant_dict(existing, include_code=True)
        snapshot = {"schema_version": 1, "sku": offer.sku, "offer_version": offer.version,
                    "definition": spec.model_dump(mode="json"), "project_id": project,
                    "site_origin": origin, "ends_at": timestamp(end), "platform_key": req.platform_key, "scene_type": "training"}
        grant = await self._new_grant(offer.id, snapshot, actor, claim_key=claim_key)
        for capability in TRIAL_CAPABILITIES:
            self.db.add(TrialQuota(grant_id=grant.id, capability=capability, available=1, consumed=0))
        await self.audit(actor, "commercial_trial_issue", grant.id, {"user_id": req.user_id}, request)
        try:
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("该用户已领取体验授权，请刷新") from error
        return await self.grant_dict(grant, include_code=True)

    async def _new_grant(self, offer_id: int, snapshot: dict, actor: dict, *, order_id: int | None = None, claim_key: str | None = None) -> CommercialGrant:
        end = utc_naive(datetime.fromisoformat(snapshot["ends_at"]))
        # Legacy AuthCode stores server-local wall time; the new grant is UTC.
        # Convert, never copy UTC-naive into the old local-time expiry field.
        legacy_end = end.replace(tzinfo=UTC).astimezone().replace(tzinfo=None)
        code = AuthCode(code="KST-" + secrets.token_hex(12).upper(), plan_id=None, order_id=order_id,
                        expires_at=legacy_end, status="unused", max_devices=1, seat_limit=1,
                        platform_scope=snapshot["platform_key"], scene_type="competition" if snapshot.get("scene_type") == "competition" else "course")
        self.db.add(code)
        await self.db.flush()
        grant = CommercialGrant(auth_code_id=code.id, order_id=order_id, offer_id=offer_id, claim_key=claim_key,
                                snapshot=encode(snapshot), project_id=snapshot["project_id"], site_origin=snapshot["site_origin"],
                                ends_at=end, status="active", created_by_staff_id=actor["staff_id"])
        self.db.add(grant)
        await self.db.flush()
        return grant

    async def grant_dict(self, grant: CommercialGrant, *, include_code: bool = False) -> dict:
        value = {"id": grant.id, "auth_code_id": grant.auth_code_id, "order_id": grant.order_id,
                 "snapshot": json.loads(grant.snapshot), "status": grant.status, "ends_at": timestamp(grant.ends_at)}
        if include_code:
            code = await self.db.get(AuthCode, grant.auth_code_id)
            value["auth_code"] = code.code if code else None
        return value

    async def grants(self) -> list[dict]:
        return [await self.grant_dict(row) for row in (await self.db.scalars(select(CommercialGrant).order_by(CommercialGrant.id.desc()).limit(200))).all()]

    async def fulfillments(self, order_id: int) -> list[dict]:
        rows = (await self.db.scalars(select(ServiceFulfillment).where(ServiceFulfillment.order_id == order_id))).all()
        order = await self.db.get(Order, order_id)
        review = await current_refund_review(self.db, order) if order and order.refund_amount else None
        limits = json.loads(review.service_limits) if review else {}
        refund_pending = bool(order and order.refund_amount and not review)
        events = (await self.db.scalars(select(ServiceFulfillmentEvent).where(
            ServiceFulfillmentEvent.fulfillment_id.in_([row.id for row in rows]),
        ).order_by(ServiceFulfillmentEvent.id))).all() if rows else []
        def effective_limit(row: ServiceFulfillment) -> int:
            if order and (order.status == OrderStatus.REFUNDED or refund_pending):
                return row.completed_count
            return limits.get(row.service_code, row.total_count)
        return [{"id": row.id, "order_id": row.order_id, "service_code": row.service_code,
                 "total_count": effective_limit(row), "purchased_count": row.total_count, "completed_count": row.completed_count,
                 "remaining_count": effective_limit(row) - row.completed_count, "refund_review_pending": refund_pending,
                 "minutes_per_unit": row.minutes_per_unit, "revision": row.revision,
                 "events": [{"id": event.id, "count": event.count, "minutes": event.minutes, "performed_by_staff_id": event.performed_by_staff_id,
                             "evidence_ref": event.evidence_ref, "created_at": timestamp(event.created_at)} for event in events if event.fulfillment_id == row.id]} for row in rows]

    async def complete_service(self, fulfillment_id: int, data: dict, actor: dict, request: Request | None = None) -> dict:
        row = await self.db.get(ServiceFulfillment, fulfillment_id)
        if not row:
            raise NotFoundException("履约项目不存在")
        event = await self.db.scalar(select(ServiceFulfillmentEvent).where(ServiceFulfillmentEvent.operation_id == data["operation_id"]))
        if event:
            if event.fulfillment_id != fulfillment_id or event.count != data["count"] or event.minutes != data["minutes"] or event.evidence_ref != data["evidence_ref"] or event.performed_by_staff_id != data["performed_by_staff_id"]:
                raise ConflictException("履约幂等键已被不同内容使用")
            return {"event_id": event.id, "idempotent": True}
        order = await self.db.scalar(select(Order).where(Order.id == row.order_id).with_for_update())
        if not order or order.status != OrderStatus.PAID:
            raise ConflictException("仅可确认已收款且无退款待核对的服务")
        service_limit = row.total_count
        if order.refund_amount:
            review = await current_refund_review(self.db, order)
            if not review:
                raise ConflictException("退款后的剩余服务权益尚未核对")
            service_limit = json.loads(review.service_limits).get(row.service_code, row.completed_count)
        performer = await self.db.get(StaffUser, data["performed_by_staff_id"])
        if not performer or performer.status != "active":
            raise ValidationException("履约执行人不存在或已停用")
        if data["minutes"] != row.minutes_per_unit * data["count"]:
            raise ValidationException("预约答疑按每次约定分钟数记录，其他服务分钟数为 0")
        changed = await self.db.execute(update(ServiceFulfillment).where(
            ServiceFulfillment.id == fulfillment_id, ServiceFulfillment.revision == data["expected_revision"],
            ServiceFulfillment.completed_count + data["count"] <= service_limit,
        ).values(completed_count=ServiceFulfillment.completed_count + data["count"], revision=ServiceFulfillment.revision + 1))
        if changed.rowcount != 1:
            raise ConflictException("服务次数不足或版本已变化，请刷新")
        event = ServiceFulfillmentEvent(fulfillment_id=fulfillment_id, operation_id=data["operation_id"], count=data["count"],
                minutes=data["minutes"], performed_by_staff_id=data["performed_by_staff_id"], evidence_ref=data["evidence_ref"])
        self.db.add(event)
        try:
            await self.db.flush()
            await self.audit(actor, "commercial_fulfillment_complete", fulfillment_id, {"event_id": event.id, "count": data["count"]}, request)
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("履约提交发生并发冲突，请刷新") from error
        return {"event_id": event.id, "idempotent": False}

    async def refund_entitlements(self, order_id: int) -> dict:
        order = await self.db.get(Order, order_id)
        if not order:
            raise NotFoundException("订单不存在")
        row = await self.db.scalar(select(CommercialRefundEntitlementReview).where(CommercialRefundEntitlementReview.order_id == order_id))
        return {"order_id": order_id, "refund_amount": str(order.refund_amount or 0), "revision": row.revision if row else 0,
                "current": bool(row and row.refund_amount_snapshot == order.refund_amount),
                "retained_capabilities": json.loads(row.retained_capabilities) if row else [],
                "service_limits": json.loads(row.service_limits) if row else {}, "evidence_ref": row.evidence_ref if row else None}

    async def review_refund_entitlements(self, order_id: int, data: dict, actor: dict, request: Request | None = None) -> dict:
        order = await self.db.scalar(select(Order).where(Order.id == order_id).with_for_update())
        snapshot = await self.db.scalar(select(CommercialOrderSnapshot).where(CommercialOrderSnapshot.order_id == order_id))
        if not order or not snapshot:
            raise NotFoundException("版本化商品订单不存在")
        if order.status != OrderStatus.PAID or not order.refund_amount or order.refund_amount != data["expected_refunded_total"]:
            raise ConflictException("订单未部分退款、已全退或退款金额已变化，请刷新")
        definition = json.loads(snapshot.snapshot)["definition"]
        retained = list(dict.fromkeys(CAPABILITY_ALIASES.get(cap, cap) for cap in data["retained_capabilities"]))
        if set(retained) - set(definition["allowed_capabilities"]):
            raise ValidationException("退款核对不能新增购买快照以外的工具权益")
        services = (await self.db.scalars(select(ServiceFulfillment).where(ServiceFulfillment.order_id == order_id))).all()
        service_map = {service.service_code: service for service in services}
        limits = data["service_limits"]
        if set(limits) != set(service_map):
            raise ValidationException("必须逐项明确剩余服务总次数，不能遗漏或新增服务")
        for code, limit in limits.items():
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < service_map[code].completed_count or limit > service_map[code].total_count:
                raise ValidationException("服务总次数不得少于已完成次数，或超过购买快照")
        row = await self.db.scalar(select(CommercialRefundEntitlementReview).where(CommercialRefundEntitlementReview.order_id == order_id))
        if (row.revision if row else 0) != data["expected_revision"]:
            raise ConflictException("退款权益审核已被其他管理员修改")
        before = await self.refund_entitlements(order_id)
        values = {"refund_amount_snapshot": order.refund_amount, "retained_capabilities": json.dumps(retained),
                  "service_limits": encode(limits), "revision": data["expected_revision"] + 1,
                  "reviewed_by_staff_id": actor["staff_id"], "evidence_ref": data["evidence_ref"], "reviewed_at": datetime.utcnow()}
        if row:
            changed = await self.db.execute(update(CommercialRefundEntitlementReview).where(
                CommercialRefundEntitlementReview.id == row.id, CommercialRefundEntitlementReview.revision == data["expected_revision"],
            ).values(**values))
            if changed.rowcount != 1:
                raise ConflictException("退款权益审核发生版本冲突")
        else:
            self.db.add(CommercialRefundEntitlementReview(order_id=order_id, **values))
        try:
            await self.db.flush()
            await self.audit(actor, "commercial_refund_rights_review", order_id,
                {"before": before, "after": {"refunded_total": str(order.refund_amount), "retained_capabilities": retained,
                 "service_limits": limits, "revision": values["revision"], "evidence_ref": data["evidence_ref"]}}, request)
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("退款权益审核发生并发冲突") from error
        return await self.refund_entitlements(order_id)

    async def reserve_trial(self, grant_id: int, capability: str, operation_id: str, actor: dict) -> TrialReservation:
        grant = await self.db.get(CommercialGrant, grant_id)
        if not grant or actor.get("role") != "user" or actor.get("auth_code_id") != grant.auth_code_id:
            raise HTTPException(403, "体验授权不属于当前登录身份")
        await assert_commercial_tool_access(self.db, grant.auth_code_id, capability)
        capability = CAPABILITY_ALIASES.get(capability, capability)
        quota = await self.db.scalar(select(TrialQuota).where(TrialQuota.grant_id == grant_id, TrialQuota.capability == capability))
        if not quota:
            raise ValidationException("该能力不属于免费体验三项额度")
        existing = await self.db.scalar(select(TrialReservation).where(TrialReservation.operation_id == operation_id))
        if existing:
            if existing.quota_id != quota.id or existing.status == "released":
                raise ConflictException("操作标识已经用于其他额度或已释放")
            return existing
        changed = await self.db.execute(update(TrialQuota).where(TrialQuota.id == quota.id, TrialQuota.available > 0).values(available=TrialQuota.available - 1))
        if changed.rowcount != 1:
            raise ConflictException("体验额度已使用或正在等待结果核对")
        reservation = TrialReservation(quota_id=quota.id, operation_id=operation_id, status="reserved")
        self.db.add(reservation)
        try:
            await self.db.flush()
        except IntegrityError as error:
            await self.db.rollback()
            raise ConflictException("体验操作重复，请读取原任务状态") from error
        # Caller owns the transaction so quota reservation and launch grant are atomic.
        return reservation

    async def finish_trial(self, operation_id: str, outcome: str, evidence_ref: str) -> TrialReservation:
        """Internal trusted Runner/reconciliation hook, never a customer success endpoint."""
        if outcome not in {"verified_success", "not_submitted", "unknown"} or not evidence_ref:
            raise ValidationException("必须有真实执行结果及核对证据引用")
        row = await self.db.scalar(select(TrialReservation).where(TrialReservation.operation_id == operation_id).with_for_update())
        if not row:
            raise NotFoundException("体验占用记录不存在")
        target = {"verified_success": "consumed", "not_submitted": "released", "unknown": "unknown"}[outcome]
        if row.status in {"consumed", "released"}:
            if row.status != target:
                raise ConflictException("已终结体验记录不能改写")
            return row
        previous = row.status
        changed = await self.db.execute(update(TrialReservation).where(TrialReservation.id == row.id, TrialReservation.status == previous).values(
            status=target, evidence_ref=evidence_ref, resolved_at=datetime.utcnow() if target != "unknown" else None))
        if changed.rowcount != 1:
            raise ConflictException("体验记录正在被另一请求核对")
        if target == "consumed":
            await self.db.execute(update(TrialQuota).where(TrialQuota.id == row.quota_id).values(consumed=TrialQuota.consumed + 1))
        elif target == "released":
            await self.db.execute(update(TrialQuota).where(TrialQuota.id == row.quota_id).values(available=TrialQuota.available + 1))
        return row


async def assert_commercial_tool_access(db: AsyncSession, auth_code_id: int | None, capability: str,
                                       site_origin: str | None = None, project_id: str | None = None) -> CommercialGrant | None:
    """Legacy licenses return None; new licenses are snapshot-bound and fail closed."""
    grant = await db.scalar(select(CommercialGrant).where(CommercialGrant.auth_code_id == auth_code_id)) if auth_code_id else None
    if not grant:
        return None
    if grant.status != "active" or grant.ends_at <= datetime.utcnow():
        raise HTTPException(403, "项目授权已经结束或撤销")
    review = None
    if grant.order_id:
        order = await db.get(Order, grant.order_id)
        if not order or order.status != OrderStatus.PAID:
            raise HTTPException(403, "订单退款待核对或授权已失效")
        if order.refund_amount:
            review = await current_refund_review(db, order)
            if not review:
                raise HTTPException(403, "退款后的剩余工具权益尚未核对")
    spec = json.loads(grant.snapshot)["definition"]
    canonical = CAPABILITY_ALIASES.get(capability, capability)
    if canonical not in spec["allowed_capabilities"]:
        raise HTTPException(403, "购买时的套餐权益不包含该工具")
    if review and canonical not in json.loads(review.retained_capabilities):
        raise HTTPException(403, "该工具权益已在退款核对时撤销")
    if site_origin is not None and site_origin != grant.site_origin:
        raise HTTPException(403, "当前站点不属于约定项目")
    if project_id is not None and project_id != grant.project_id:
        raise HTTPException(403, "当前课程或比赛不属于约定项目")
    return grant


async def current_refund_review(db: AsyncSession, order: Order) -> CommercialRefundEntitlementReview | None:
    return await db.scalar(select(CommercialRefundEntitlementReview).where(
        CommercialRefundEntitlementReview.order_id == order.id,
        CommercialRefundEntitlementReview.refund_amount_snapshot == order.refund_amount,
    ))


@dataclass(frozen=True, slots=True)
class ServiceFulfillmentRequirement:
    purchased_count: int
    required_count: int
    completed_count: int
    blocked: bool


async def service_fulfillment_requirement(db: AsyncSession, order_id: int, service_code: str) -> ServiceFulfillmentRequirement | None:
    """Effective delivery scope only; callers must independently check cash settlement holds."""
    row = await db.scalar(select(ServiceFulfillment).where(
        ServiceFulfillment.order_id == order_id, ServiceFulfillment.service_code == service_code,
    ))
    if row is None:
        return None
    order = await db.get(Order, order_id)
    required_count = row.total_count
    blocked = not order or order.status != OrderStatus.PAID
    if order and order.refund_amount:
        review = await current_refund_review(db, order)
        if review:
            required_count = int(json.loads(review.service_limits).get(service_code, 0))
        else:
            blocked = True
    # Cancelling every remaining service is not evidence of completed labor.
    blocked = bool(blocked or required_count <= 0)
    return ServiceFulfillmentRequirement(row.total_count, required_count, row.completed_count, blocked)


async def complete_trial_report(db: AsyncSession, launch: LaunchToken, run_id: str, succeeded: bool) -> None:
    """Called only inside report_execution's consumed-token transaction."""
    operation_id = trial_operation_id(launch.token)
    row = await db.scalar(select(TrialReservation).where(TrialReservation.operation_id == operation_id).with_for_update())
    if row is None:
        return  # Legacy/paid launches have no trial reservation.
    if launch.status != "used" or not launch.used_at:
        raise HTTPException(409, "体验结果必须来自已消费的 Runner 启动授权")
    quota = await db.get(TrialQuota, row.quota_id)
    grant = await db.get(CommercialGrant, quota.grant_id) if quota else None
    if not grant or grant.auth_code_id != launch.auth_code_id:
        raise HTTPException(403, "体验结果与启动授权不匹配")
    if row.run_id is not None and row.run_id != run_id:
        raise HTTPException(409, "体验启动授权已经绑定其他任务")
    if row.run_id is None:
        changed = await db.execute(update(TrialReservation).where(TrialReservation.id == row.id, TrialReservation.run_id.is_(None)).values(run_id=run_id))
        if changed.rowcount != 1:
            raise HTTPException(409, "体验回执正在被另一请求绑定")
    await CommercialService(db).finish_trial(operation_id, "verified_success" if succeeded else "unknown", f"runner-report:{run_id}")


async def complete_trial_reconciliation(db: AsyncSession, auth_code_id: int, run_id: str, object_ref: str) -> None:
    """Called after the existing owned same-object reconciliation validation."""
    rows = (await db.scalars(select(TrialReservation).join(TrialQuota, TrialReservation.quota_id == TrialQuota.id)
                            .join(CommercialGrant, TrialQuota.grant_id == CommercialGrant.id)
                            .where(CommercialGrant.auth_code_id == auth_code_id, TrialReservation.run_id == run_id).with_for_update())).all()
    if len(rows) > 1:
        raise HTTPException(409, "体验核对出现重复任务标识，请联系管理员")
    if rows:
        await CommercialService(db).finish_trial(rows[0].operation_id, "verified_success", f"same-object:{object_ref}")
