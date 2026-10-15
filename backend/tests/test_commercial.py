"""Isolated database regressions for new offers; never touch production data."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from core.config import settings
from core.exceptions import ConflictException, ValidationException
from domains.access.entitlements import resolve_product_access
from domains.automation.schemas import ExecutionReconcileRequest, RunnerExecutionReport
from domains.automation.service import reconcile_execution, report_execution
from domains.commercial import service_fulfillment_requirement
from domains.commercial.catalog import draft_templates
from domains.commercial.service import CommercialService, assert_commercial_tool_access, trial_operation_id
from models import AuthCode, LaunchToken, Order, Plan, ProfitRecord, Setting, StaffUser, User
from models.base import Base
from models.commercial import CommercialGrant, ServiceFulfillmentEvent, TrialQuota, TrialReservation
from schemas.commercial import CommercialOrderCreate, OfferDefinition, TrialGrantCreate
from services.order_service import OrderService

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def actor(db_session, auth_headers):
    staff = await db_session.scalar(select(StaffUser).where(StaffUser.username == "admin"))
    return {"staff_id": staff.id, "username": staff.username, "role": staff.role}


def scope():
    return {"project_id": "contest-2026", "site_origin": "https://www.idtrade.cn", "ends_at": datetime.now(UTC) + timedelta(days=30)}


async def active_offer(service, actor, sku="competition-guided"):
    item = next(item for item in draft_templates() if item["sku"] == sku)
    draft = await service.create_draft(sku, OfferDefinition.model_validate(item["definition"]), actor)
    return await service.activate(draft["id"], draft["revision"], actor)


def request():
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("test", 1)})


async def test_templates_are_drafts_and_export_is_explicit(db_session, actor):
    service = CommercialService(db_session)
    offers = await service.seed_drafts(actor)
    assert len(offers) == 11
    assert all(item["status"] == "draft" for item in offers)
    assert (await service.export_catalog())["items"] == []
    assert len(await service.seed_drafts(actor)) == 11
    guided = next(item for item in offers if item["sku"] == "competition-guided")
    await service.activate(guided["id"], 1, actor)
    exported = await service.export_catalog()
    assert exported["items"][0]["price"] == "599"
    assert set(exported["items"][0]) == {"sku", "version", "name", "price", "business_line", "term_type", "description", "allowed_capabilities", "services", "availability"}
    assert "staff" not in json.dumps(exported)
    assert "ratio" not in json.dumps(exported)


async def test_version_updates_preserve_order_snapshot_and_legacy_business(db_session, actor):
    service = CommercialService(db_session)
    legacy = Plan(name="旧999B", price=999, duration_days=30, status="active", product_type="business", entitlements='{"batch_execution":true}')
    db_session.add(legacy)
    await db_session.commit()
    offer = await active_offer(service, actor)
    order = await service.create_order(CommercialOrderCreate(offer_id=offer["id"], **scope()), actor)
    changed = OfferDefinition.model_validate({**offer["definition"], "name": "下期新名", "price": "699"})
    draft = await service.create_draft(offer["sku"], changed, actor)
    await service.activate(draft["id"], 1, actor)
    preserved = await service.order_detail(order["id"])
    assert preserved["commercial"]["definition"]["price"] == "599"
    assert preserved["plan_name_snapshot"] == "比赛工具与指导包"
    assert (await db_session.get(Plan, legacy.id)).price == Decimal("999")
    assert len((await service.export_catalog())["items"]) == 1
    with pytest.raises(ConflictException):
        await service.update_draft(draft["id"], 1, changed, actor)


async def test_new_receipt_does_not_generate_profit_and_grant_is_snapshot(db_session, actor):
    service = CommercialService(db_session)
    offer = await active_offer(service, actor)
    order = await service.create_order(CommercialOrderCreate(offer_id=offer["id"], **scope()), actor)
    with pytest.raises(ConflictException):
        await service.issue_order_grant(order["id"], actor)
    assert (await service_fulfillment_requirement(db_session, order["id"], "appointment")).blocked
    await OrderService(db_session).mark_paid(order["id"], actor, request())
    assert await db_session.scalar(select(func.count()).select_from(ProfitRecord)) == 0
    grant = await service.issue_order_grant(order["id"], actor)
    repeated = await service.issue_order_grant(order["id"], actor)
    assert repeated["id"] == grant["id"]
    code = await db_session.get(AuthCode, grant["auth_code_id"])
    assert code.plan_id is None
    assert code.expires_at.astimezone(UTC).replace(tzinfo=None) == (await db_session.get(CommercialGrant, grant["id"])).ends_at
    access = await resolve_product_access(db_session, code.id)
    assert access["product_type"] == "consumer"
    assert not access["entitlements"]["batch_execution"]
    assert await assert_commercial_tool_access(db_session, code.id, "template.create", "https://www.idtrade.cn", "contest-2026")
    with pytest.raises(HTTPException):
        await assert_commercial_tool_access(db_session, code.id, "template.create", "https://www.idtrade.cn.evil.test")
    with pytest.raises(HTTPException):
        await assert_commercial_tool_access(db_session, code.id, "unapproved")
    with pytest.raises(ConflictException):
        await OrderService(db_session).update_pending(order["id"], {"plan_id": 1}, actor, request())


async def test_explicit_project_scope_and_free_no_fake_orders(db_session, actor):
    service = CommercialService(db_session)
    offer = await active_offer(service, actor, "training-full")
    with pytest.raises(ValidationException):
        await service.create_order(CommercialOrderCreate(offer_id=offer["id"]), actor)
    with pytest.raises(ValidationError):
        CommercialOrderCreate(offer_id=offer["id"], **{**scope(), "site_origin": "https://www.idtrade.cn@evil.test/path"})
    with pytest.raises(ValidationError):
        CommercialOrderCreate(offer_id=offer["id"], **{**scope(), "ends_at": datetime.now()})
    trial = await active_offer(service, actor, "free-trial")
    with pytest.raises(ValidationException):
        await service.create_order(CommercialOrderCreate(offer_id=trial["id"], **scope()), actor)
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0


async def test_trial_atomic_reservation_unknown_release_and_consumption(db_session, actor):
    service = CommercialService(db_session)
    offer = await active_offer(service, actor, "free-trial")
    user = User(name="体验用户", is_active=True)
    db_session.add(user)
    await db_session.commit()
    grant = await service.issue_trial(TrialGrantCreate(offer_id=offer["id"], user_id=user.id, **scope()), actor)
    assert (await service.issue_trial(TrialGrantCreate(offer_id=offer["id"], user_id=user.id, **scope()), actor))["id"] == grant["id"]
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    customer = {"role": "user", "auth_code_id": grant["auth_code_id"], "user_id": user.id}
    reservation = await service.reserve_trial(grant["id"], "template.create", "operation-template-1", customer)
    await db_session.commit()
    assert (await service.reserve_trial(grant["id"], "template.create", "operation-template-1", customer)).id == reservation.id
    with pytest.raises(ConflictException):
        await service.reserve_trial(grant["id"], "template.create", "operation-template-2", customer)
    await service.finish_trial("operation-template-1", "unknown", "receipt:uncertain")
    await db_session.commit()
    with pytest.raises(ConflictException):
        await service.reserve_trial(grant["id"], "template.create", "operation-template-3", customer)
    await service.finish_trial("operation-template-1", "not_submitted", "receipt:not-submitted")
    await db_session.commit()
    await service.reserve_trial(grant["id"], "template.create", "operation-template-4", customer)
    await service.finish_trial("operation-template-4", "verified_success", "receipt:same-object-readback")
    await db_session.commit()
    await service.finish_trial("operation-template-4", "verified_success", "receipt:same-object-readback")
    await db_session.commit()
    quotas = (await db_session.scalars(select(TrialQuota).where(TrialQuota.grant_id == grant["id"]))).all()
    assert {q.capability: (q.available, q.consumed) for q in quotas} == {"company.register": (1, 0), "product.create": (1, 0), "template.create": (0, 1)}
    with pytest.raises(HTTPException):
        await service.reserve_trial(grant["id"], "company.register", "operation-other-user", {"role": "user", "auth_code_id": -1})


async def test_599_fulfillment_counts_minutes_idempotency_and_cas(db_session, actor):
    service = CommercialService(db_session)
    offer = await active_offer(service, actor)
    order = await service.create_order(CommercialOrderCreate(offer_id=offer["id"], **scope()), actor)
    services = await service.fulfillments(order["id"])
    assert {s["service_code"]: s["total_count"] for s in services} == {"materials-full": 1, "diagnosis": 1, "group-qa": 1, "appointment": 3}
    appointment = next(s for s in services if s["service_code"] == "appointment")
    data = {"expected_revision": 1, "operation_id": "appointment-1", "count": 1, "minutes": 30, "performed_by_staff_id": actor["staff_id"], "evidence_ref": "fulfillment:meeting-1"}
    with pytest.raises(ConflictException):
        await service.complete_service(appointment["id"], data, actor)
    await OrderService(db_session).mark_paid(order["id"], actor, request())
    event = await service.complete_service(appointment["id"], data, actor)
    repeated = await service.complete_service(appointment["id"], data, actor)
    assert event["event_id"] == repeated["event_id"]
    assert repeated["idempotent"]
    with pytest.raises(ConflictException):
        await service.complete_service(appointment["id"], {**data, "operation_id": "appointment-stale"}, actor)
    with pytest.raises(ValidationException):
        await service.complete_service(appointment["id"], {**data, "expected_revision": 2, "operation_id": "appointment-short", "minutes": 15}, actor)
    assert await db_session.scalar(select(func.count()).select_from(ServiceFulfillmentEvent)) == 1


async def test_single_tool_39_requires_exact_reviewed_tool(db_session, actor):
    service = CommercialService(db_session)
    template = next(item for item in draft_templates() if item["sku"] == "single-tool-39")
    draft = await service.create_draft(template["sku"], OfferDefinition.model_validate(template["definition"]), actor)
    with pytest.raises(ValidationException):
        await service.activate(draft["id"], 1, actor)
    db_session.add(Setting(key="tool_configs", value=json.dumps([{"id": "template", "name": "模板", "capability_key": "logistics_standard", "availability": "live", "script_status": "script_ready"}])))
    await db_session.commit()
    specific = await service.create_draft("single-logistics-standard", OfferDefinition.model_validate({**template["definition"], "allowed_capabilities": ["logistics_standard"]}), actor)
    active = await service.activate(specific["id"], 1, actor)
    order = await service.create_order(CommercialOrderCreate(offer_id=active["id"], **scope()), actor)
    assert order["amount"] == 39
    assert order["commercial"]["definition"]["allowed_capabilities"] == ["template.create"]


async def test_commercial_routes_reject_anonymous_and_operator_cannot_activate(client, auth_headers, staff_headers_factory):
    assert (await client.get("/api/commercial/offers")).status_code == 401
    seed = await client.post("/api/commercial/offers/seed-drafts", headers=auth_headers)
    assert seed.status_code == 200, seed.text
    operator = await staff_headers_factory("operator", "commercial-operator")
    target = seed.json()["data"][0]
    denied = await client.post(f"/api/commercial/offers/{target['id']}/activate", json={"expected_revision": 1}, headers=operator)
    assert denied.status_code == 403
    assert (await client.get("/api/commercial/catalog-export", headers=operator)).status_code == 403


async def test_paid_order_login_catalog_and_legacy_mutation_guard(client, db_session, actor, auth_headers):
    service = CommercialService(db_session)
    offer = await active_offer(service, actor)
    req = {"offer_id": offer["id"], **scope()}
    req["ends_at"] = req["ends_at"].isoformat()
    created = await client.post("/api/commercial/orders", json=req, headers=auth_headers)
    assert created.status_code == 200, created.text
    order_id = created.json()["data"]["id"]
    paid = await client.post(f"/api/orders/{order_id}/mark-paid", headers=auth_headers)
    assert paid.status_code == 200, paid.text
    granted = await client.post(f"/api/commercial/orders/{order_id}/grant", headers=auth_headers)
    assert granted.status_code == 200, granted.text
    grant = granted.json()["data"]
    login = await client.post("/api/auth/verify", json={"code": grant["auth_code"], "device_id": "commercial-device", "device_name": "test"})
    assert login.status_code == 200 and login.json()["success"], login.text
    profile = login.json()["data"]
    assert profile["plan_name"] == "比赛工具与指导包"
    assert profile["plan_code"] == "competition-guided"
    assert profile["entitlements"]["allowed_capabilities"]
    assert not profile["business_workspace_enabled"]
    customer = {"Authorization": f"Bearer {profile['token']}"}
    refreshed = await client.get("/api/auth/me", headers=customer)
    assert refreshed.json()["data"]["plan_name"] == "比赛工具与指导包"
    assert refreshed.json()["data"]["expires_at"]
    catalog = await client.get("/api/commercial/catalog", headers=customer)
    assert catalog.json()["data"]["items"][0]["price"] == "599"
    denied = await client.post(f"/api/auth-codes/{grant['auth_code_id']}/extend", json={"days": 30}, headers=auth_headers)
    assert denied.status_code == 409, denied.text
    assert (await client.get("/api/commercial/offers", headers=customer)).status_code == 401


async def test_trial_concurrent_sessions_cannot_claim_same_slot_twice(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'commercial-race.sqlite').as_posix()}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine, expire_on_commit=False) as seed:
        staff = StaffUser(username="race-admin", display_name="isolated test", password_hash="not-a-live-account", role="super_admin", status="active")
        seed.add(staff)
        await seed.commit()
        actor = {"staff_id": staff.id, "username": staff.username, "role": staff.role}
        user = User(name="race", is_active=True)
        seed.add(user)
        await seed.commit()
        service = CommercialService(seed)
        offer = await active_offer(service, actor, "free-trial")
        grant = await service.issue_trial(TrialGrantCreate(offer_id=offer["id"], user_id=user.id, **scope()), actor)
    async def reserve(operation):
        async with AsyncSession(engine, expire_on_commit=False) as session:
            try:
                await CommercialService(session).reserve_trial(grant["id"], "template.create", operation,
                    {"role": "user", "auth_code_id": grant["auth_code_id"]})
                await session.commit()
                return "reserved"
            except ConflictException:
                await session.rollback()
                return "conflict"
    try:
        assert sorted(await asyncio.gather(reserve("parallel-operation-1"), reserve("parallel-operation-2"))) == ["conflict", "reserved"]
        async with AsyncSession(engine) as session:
            quota = await session.scalar(select(TrialQuota).where(TrialQuota.grant_id == grant["id"], TrialQuota.capability == "template.create"))
            assert quota.available == 0 and quota.consumed == 0
    finally:
        await engine.dispose()


async def test_partial_service_refund_explicitly_preserves_other_rights(db_session, actor):
    service = CommercialService(db_session)
    offer = await active_offer(service, actor)
    order = await service.create_order(CommercialOrderCreate(offer_id=offer["id"], **scope()), actor)
    await OrderService(db_session).mark_paid(order["id"], actor, request())
    grant = await service.issue_order_grant(order["id"], actor)
    row = await db_session.get(Order, order["id"])
    row.refund_amount = Decimal("50")
    await db_session.commit()
    with pytest.raises(HTTPException):
        await assert_commercial_tool_access(db_session, grant["auth_code_id"], "template.create")
    with pytest.raises(ConflictException):
        await service.issue_order_grant(order["id"], actor)
    review = {"expected_revision": 0, "expected_refunded_total": Decimal("50"),
              "retained_capabilities": order["commercial"]["definition"]["allowed_capabilities"],
              "service_limits": {"materials-full": 1, "diagnosis": 1, "group-qa": 0, "appointment": 3}, "evidence_ref": "refund:group-qa-only"}
    await service.review_refund_entitlements(order["id"], review, actor)
    assert await assert_commercial_tool_access(db_session, grant["auth_code_id"], "template.create")
    fulfillment = await service.fulfillments(order["id"])
    group = next(s for s in fulfillment if s["service_code"] == "group-qa")
    appointment = next(s for s in fulfillment if s["service_code"] == "appointment")
    assert group["remaining_count"] == 0 and appointment["remaining_count"] == 3
    removed_service = await service_fulfillment_requirement(db_session, order["id"], "group-qa")
    assert removed_service.blocked and removed_service.required_count == 0 and removed_service.purchased_count == 1
    retained_service = await service_fulfillment_requirement(db_session, order["id"], "appointment")
    assert not retained_service.blocked and retained_service.required_count == 3
    await service.complete_service(appointment["id"], {"expected_revision": 1, "operation_id": "after-refund-appointment", "count": 1,
            "minutes": 30, "performed_by_staff_id": actor["staff_id"], "evidence_ref": "fulfillment:retained-service"}, actor)
    with pytest.raises(ConflictException):
        await service.complete_service(group["id"], {"expected_revision": 1, "operation_id": "refunded-group-qa", "count": 1,
                "minutes": 0, "performed_by_staff_id": actor["staff_id"], "evidence_ref": "fulfillment:must-deny"}, actor)
    with pytest.raises(ValidationException):
        await service.review_refund_entitlements(order["id"], {**review, "expected_revision": 1, "retained_capabilities": ["unbought-tool"]}, actor)
    row.refund_amount = Decimal("60")
    await db_session.commit()
    with pytest.raises(HTTPException):
        await assert_commercial_tool_access(db_session, grant["auth_code_id"], "template.create")
    assert not (await service.refund_entitlements(order["id"]))["current"]
    assert (await service_fulfillment_requirement(db_session, order["id"], "appointment")).blocked


@pytest.mark.parametrize("result_status", ["succeeded", "failed"])
async def test_trial_consumed_runner_report_and_same_object_reconciliation(db_session, actor, monkeypatch, result_status):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    service = CommercialService(db_session)
    offer = await active_offer(service, actor, "free-trial")
    user = User(name="report-user", is_active=True)
    db_session.add(user)
    await db_session.commit()
    grant = await service.issue_trial(TrialGrantCreate(offer_id=offer["id"], user_id=user.id, **scope()), actor)
    customer = {"role": "user", "user_id": user.id, "auth_code_id": grant["auth_code_id"], "device_id": "quota-device"}
    token = "isolated-quota-launch-token-" + result_status
    operation = trial_operation_id(token)
    await service.reserve_trial(grant["id"], "template.create", operation, customer)
    launch = LaunchToken(token=token, user_id=user.id, auth_code_id=grant["auth_code_id"], platform_key="amazon",
                         tool_id="template", script_key="template-script", device_id="quota-device", status="pending",
                         expires_at=datetime.now() + timedelta(minutes=5), execution_mode="single")
    db_session.add(launch)
    await db_session.commit()
    report = RunnerExecutionReport(token=token, run_id="trusted-run-" + result_status, status=result_status, page_changed=True)
    with pytest.raises(HTTPException):
        await report_execution(db_session, report)
    launch.status = "used"
    launch.used_at = datetime.now()
    await db_session.commit()
    accepted = await report_execution(db_session, report)
    assert accepted["data"]["accepted"]
    row = await db_session.scalar(select(TrialReservation).where(TrialReservation.operation_id == operation))
    assert row.run_id == report.run_id
    assert row.status == ("consumed" if result_status == "succeeded" else "unknown")
    with pytest.raises(HTTPException):
        await report_execution(db_session, report.model_copy(update={"run_id": "another-run"}))
    if result_status == "failed":
        reconcile = ExecutionReconcileRequest(run_id=report.run_id, status="succeeded", verification="same-object-list-and-details", object_ref="created-object-123")
        with pytest.raises(HTTPException):
            await reconcile_execution(db_session, {**customer, "auth_code_id": -1}, reconcile)
        await reconcile_execution(db_session, customer, reconcile)
        await reconcile_execution(db_session, customer, reconcile)
    else:
        assert (await report_execution(db_session, report))["data"]["duplicate"]
    await db_session.refresh(row)
    assert row.status == "consumed"
    quota = await db_session.get(TrialQuota, row.quota_id)
    assert quota.consumed == 1 and quota.available == 0
