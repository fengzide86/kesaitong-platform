"""New framework gates: migrated schema, real InnoDB locks, no create_all repair.

Synthetic identities and amounts only. Every worker uses an independent
REPEATABLE READ connection; missing MariaDB fails when the release gate requires it.
"""

import asyncio
import importlib.util
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.exceptions import ConflictException
from domains.commercial.service import CommercialService
from domains.scenarios import service as scenarios
from domains.team_ledger.service import TeamLedgerService
from models import AuditLog, AuthCode, Order, StaffUser, User
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
from models.scenario import ScenarioAssignment, StaffRuntimePermission
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
from schemas.scenario import ScenarioAssignmentWrite, StaffRuntimePermissionWrite
from schemas.team_ledger import (
    AllocationInput,
    ConfirmInput,
    MemberInput,
    OwnershipInput,
    PartialRefundInput,
    PaymentInput,
    PolicyInput,
    PreviewInput,
)
from tests.integration.test_mariadb_order_concurrency import _mariadb_test_url

pytestmark = pytest.mark.asyncio


def upgrade_probe():
    path = Path(__file__).parents[3] / "scripts/verify_mariadb_upgrade.py"
    spec = importlib.util.spec_from_file_location("framework_mariadb_probe", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def assert_migrated(engine):
    probe = upgrade_probe()
    async with engine.connect() as connection:
        assert connection.dialect.name in {"mysql", "mariadb"}
        assert await connection.scalar(text("SELECT version_num FROM alembic_version")) == probe.NEW_REVISION
        await connection.run_sync(lambda sync: probe.assert_framework_contract(sync, empty=False))


async def test_framework_mariadb_schema_is_alembic_migrated_not_metadata_repaired():
    engine = create_async_engine(_mariadb_test_url(), pool_pre_ping=True)
    try:
        await assert_migrated(engine)
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def framework_db():
    engine = create_async_engine(_mariadb_test_url(), pool_size=4, max_overflow=0,
                                 isolation_level="REPEATABLE READ", pool_pre_ping=True)
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    fixture = SimpleNamespace(engine=engine, sessions=sessions, suffix=uuid.uuid4().hex[:12], staff_id=None, code_id=None, member_ids=[])
    try:
        await assert_migrated(engine)
        async with sessions() as db:
            staff = StaffUser(username=f"framework-{fixture.suffix}", display_name="Synthetic operator",
                              password_hash="not-a-login", role="super_admin", status="active", force_password_reset=False)
            db.add(staff)
            await db.flush()
            fixture.staff_id = staff.id
            fixture.actor = {"staff_id": staff.id, "username": staff.username, "role": "super_admin"}
            code = AuthCode(code=f"framework-{fixture.suffix}", status="active")
            db.add(code)
            await db.flush()
            fixture.code_id = code.id
            user = User(name=f"Synthetic {fixture.suffix}", auth_code_id=code.id, is_active=True)
            db.add(user)
            await db.flush()
            fixture.code_id, fixture.user_id = code.id, user.id
            end = datetime.now(UTC).replace(tzinfo=None) + timedelta(days=2)
            definition = {"name": "Synthetic trial", "price": "0", "business_line": "trial", "term_type": "project_end",
                          "allowed_capabilities": ["company.register", "product.create", "template.create"], "services": []}
            offer = CommercialOfferVersion(sku=f"trial-{fixture.suffix}", version=1, revision=1, status="active",
                                            active_sku=f"trial-{fixture.suffix}", definition=json.dumps(definition), created_by_staff_id=staff.id)
            db.add(offer)
            await db.flush()
            snapshot = {"schema_version": 1, "definition": definition, "project_id": "synthetic-project",
                        "site_origin": "https://fixture.test", "ends_at": end.replace(tzinfo=UTC).isoformat(),
                        "platform_key": "amazon", "scene_type": "training"}
            grant = CommercialGrant(auth_code_id=code.id, offer_id=offer.id, snapshot=json.dumps(snapshot),
                                    project_id="synthetic-project", site_origin="https://fixture.test", ends_at=end,
                                    status="active", created_by_staff_id=staff.id)
            db.add(grant)
            await db.flush()
            quota = TrialQuota(grant_id=grant.id, capability="template.create", available=1, consumed=0)
            db.add(quota)
            await db.commit()
            fixture.grant_id, fixture.quota_id = grant.id, quota.id
        yield fixture
    finally:
        if fixture.staff_id is not None:
            async with sessions() as db:
                actor_id = fixture.staff_id
                order_ids = list(await db.scalars(select(Order.id).where(Order.created_by_staff_id == actor_id)))
                policy_ids = list(await db.scalars(select(TeamPolicy.id).where(TeamPolicy.created_by_staff_id == actor_id)))
                grant_ids = list(await db.scalars(select(CommercialGrant.id).where(CommercialGrant.created_by_staff_id == actor_id)))
                code_ids = list(await db.scalars(select(CommercialGrant.auth_code_id).where(CommercialGrant.id.in_(grant_ids))))
                if fixture.code_id is not None and fixture.code_id not in code_ids:
                    code_ids.append(fixture.code_id)
                quota_ids = select(TrialQuota.id).where(TrialQuota.grant_id.in_(grant_ids))
                fulfillment_ids = select(ServiceFulfillment.id).where(ServiceFulfillment.order_id.in_(order_ids))
                # Core DELETE bypasses append-only business hooks only for this
                # exact fixture's records; children are removed before parents.
                for identity in await db.scalars(select(TeamLedgerEntry.id).where(TeamLedgerEntry.created_by_staff_id == actor_id).order_by(TeamLedgerEntry.id.desc())):
                    await db.execute(delete(TeamLedgerEntry).where(TeamLedgerEntry.id == identity))
                for model, predicate in [
                    (AuditLog, AuditLog.user_id == actor_id),
                    (ScenarioAssignment, ScenarioAssignment.updated_by == actor_id),
                    (StaffRuntimePermission, StaffRuntimePermission.staff_id == actor_id),
                    (TeamOrderAllocation, TeamOrderAllocation.order_id.in_(order_ids)),
                    (TeamSettlement, TeamSettlement.created_by_staff_id == actor_id),
                    (TeamOwnership, TeamOwnership.policy_id.in_(policy_ids)),
                    (TeamPolicy, TeamPolicy.id.in_(policy_ids)),
                    (TeamMember, TeamMember.id.in_(fixture.member_ids)),
                    (TeamRefundReview, TeamRefundReview.order_id.in_(order_ids)),
                    (TeamServiceDelivery, TeamServiceDelivery.order_id.in_(order_ids)),
                    (CommercialRefundEntitlementReview, CommercialRefundEntitlementReview.order_id.in_(order_ids)),
                    (ServiceFulfillmentEvent, ServiceFulfillmentEvent.fulfillment_id.in_(fulfillment_ids)),
                    (ServiceFulfillment, ServiceFulfillment.order_id.in_(order_ids)),
                    (TrialReservation, TrialReservation.quota_id.in_(quota_ids)),
                    (TrialQuota, TrialQuota.grant_id.in_(grant_ids)),
                    (CommercialGrant, CommercialGrant.id.in_(grant_ids)),
                    (CommercialOrderSnapshot, CommercialOrderSnapshot.order_id.in_(order_ids)),
                    (User, User.auth_code_id.in_(code_ids)),
                    (AuthCode, AuthCode.id.in_(code_ids)),
                    (Order, Order.id.in_(order_ids)),
                    (CommercialOfferVersion, CommercialOfferVersion.created_by_staff_id == actor_id),
                    (StaffUser, StaffUser.id == actor_id),
                ]:
                    await db.execute(delete(model).where(predicate))
                await db.commit()
        await engine.dispose()


async def race(fixture, action, *, stale=None):
    ready = asyncio.Event()
    arrived = 0
    connection_ids = set()

    async def worker(index):
        nonlocal arrived
        async with fixture.sessions() as db:
            connection_ids.add(await db.scalar(text("SELECT CONNECTION_ID()")))
            stale_rows = []
            if stale is not None:
                # Retain the ORM rows as well as the REPEATABLE READ snapshot
                # until the operation finishes; this models preloaded routers.
                stale_rows = list(await db.scalars(stale))
            arrived += 1
            if arrived == 4:
                ready.set()
            await asyncio.wait_for(ready.wait(), timeout=15)
            try:
                value = await action(db, index)
                await db.commit()
                assert stale is None or stale_rows
                return value
            except (ConflictException, HTTPException) as error:
                await db.rollback()
                assert getattr(error, "code", getattr(error, "status_code", None)) == 409
                return None

    results = await asyncio.wait_for(asyncio.gather(*(worker(index) for index in range(4))), timeout=45)
    assert len(connection_ids) == 4
    return [value for value in results if value is not None]


async def test_framework_mariadb_trial_reservation_and_completion_are_exactly_once(framework_db):
    fixture = framework_db
    async def reserve(db, index):
        row = await CommercialService(db).reserve_trial(fixture.grant_id, "template.create", f"quota-{fixture.suffix}-{index}",
                                                       {"role": "user", "auth_code_id": fixture.code_id})
        return row.operation_id
    winners = await race(fixture, reserve, stale=select(TrialQuota).where(TrialQuota.id == fixture.quota_id))
    assert len(winners) == 1
    async def finish(db, _index):
        return await CommercialService(db).finish_trial(winners[0], "verified_success", "synthetic-verified-receipt")
    assert await race(fixture, finish, stale=select(TrialReservation).where(TrialReservation.operation_id == winners[0]))
    async with fixture.sessions() as db:
        quota = await db.get(TrialQuota, fixture.quota_id)
        assert (quota.available, quota.consumed) == (0, 1)
        assert len(list(await db.scalars(select(TrialReservation).where(TrialReservation.quota_id == quota.id)))) == 1


async def paid_order(fixture):
    async with fixture.sessions() as db:
        offer = CommercialOfferVersion(sku=f"paid-{fixture.suffix}", version=1, revision=1, status="draft",
                                        definition="{}", created_by_staff_id=fixture.staff_id)
        order = Order(order_no=f"framework-{fixture.suffix}", amount=Decimal("100"), refund_amount=Decimal("0"),
                      status="paid", paid_at=datetime.now(UTC).replace(tzinfo=None), created_by_staff_id=fixture.staff_id)
        db.add_all([offer, order])
        await db.flush()
        db.add(CommercialOrderSnapshot(order_id=order.id, offer_id=offer.id, sku=offer.sku, offer_version=1,
                                       settlement_mode="manual", snapshot="{}"))
        await db.commit()
        return order.id, offer.sku


async def ledger_preview(fixture):
    order_id, sku = await paid_order(fixture)
    async with fixture.sessions() as db:
        service = TeamLedgerService(db)
        member = await service.create_member(MemberInput(name=f"Synthetic member {fixture.suffix}"), fixture.actor)
        fixture.member_ids.append(member["id"])
        policy = await service.create_policy(PolicyInput(name="Synthetic policy", product_skus=[sku], items=[
            {"code": "synthetic", "label": "Synthetic", "group": "Synthetic", "ratio": "1"}]), fixture.actor)
        await service.activate_policy(policy["id"], 1, fixture.actor)
        await service.save_ownership(OwnershipInput(policy_id=policy["id"], item_code="synthetic", product_sku=sku,
            starts_on=date(2020, 1, 1), members=[{"member_id": member["id"], "weight": "1"}]), fixture.actor)
        await service.set_allocation(order_id, AllocationInput(expected_version=0, amount="80", period="2026-10", note="Synthetic B"), fixture.actor)
        preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku=sku, period="2026-10"), fixture.actor)
        return order_id, member["id"], preview


async def test_framework_mariadb_settlement_and_payment_reject_stale_concurrent_versions(framework_db):
    fixture = framework_db
    order_id, member_id, preview = await ledger_preview(fixture)
    async def confirm(db, _index):
        return await TeamLedgerService(db).confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), fixture.actor)
    assert len(await race(fixture, confirm, stale=select(TeamSettlement).where(TeamSettlement.id == preview["id"]))) == 1
    async with fixture.sessions() as db:
        member = await db.get(TeamMember, member_id)
        version = member.ledger_version
    async def pay(db, index):
        return await TeamLedgerService(db).payment(PaymentInput(member_id=member_id, amount="80", expected_ledger_version=version,
            idempotency_key=f"payment-{fixture.suffix}-{index}", evidence="synthetic-external-receipt", note="Synthetic payment"), fixture.actor)
    assert len(await race(fixture, pay, stale=select(TeamMember).where(TeamMember.id == member_id))) == 1
    async with fixture.sessions() as db:
        rows = list(await db.scalars(select(TeamLedgerEntry).where(TeamLedgerEntry.order_id == order_id)))
        assert sum(row.amount for row in rows) == Decimal("80")
        payments = list(await db.scalars(select(TeamLedgerEntry).where(TeamLedgerEntry.member_id == member_id, TeamLedgerEntry.bucket == "paid")))
        assert len(payments) == 1 and payments[0].amount == Decimal("80")


async def test_framework_mariadb_refund_cas_cannot_exceed_net_receipts(framework_db):
    fixture = framework_db
    order_id, _sku = await paid_order(fixture)
    async def refund(db, index):
        return await TeamLedgerService(db).partial_refund(order_id, PartialRefundInput(amount="60", expected_refunded_total="0",
            reason="Synthetic partial refund", evidence="synthetic-proof", idempotency_key=f"refund-{fixture.suffix}-{index}"), fixture.actor)
    assert len(await race(fixture, refund, stale=select(Order).where(Order.id == order_id))) == 1
    async with fixture.sessions() as db:
        order = await db.get(Order, order_id)
        assert order.status == "paid" and order.refund_amount == Decimal("60")
        assert len(list(await db.scalars(select(TeamRefundReview).where(TeamRefundReview.order_id == order_id)))) == 1


async def test_framework_mariadb_service_fulfillment_cas_counts_once(framework_db):
    fixture = framework_db
    order_id, _sku = await paid_order(fixture)
    async with fixture.sessions() as db:
        row = ServiceFulfillment(order_id=order_id, service_code="synthetic", total_count=1, completed_count=0, minutes_per_unit=0, revision=1)
        db.add(row)
        await db.commit()
        identity = row.id
    async def complete(db, index):
        return await CommercialService(db).complete_service(identity, {"expected_revision": 1, "operation_id": f"fulfill-{fixture.suffix}-{index}",
            "count": 1, "minutes": 0, "performed_by_staff_id": fixture.staff_id, "evidence_ref": "synthetic-proof"}, fixture.actor)
    assert len(await race(fixture, complete, stale=select(ServiceFulfillment).where(ServiceFulfillment.id == identity))) == 1
    async with fixture.sessions() as db:
        row = await db.get(ServiceFulfillment, identity)
        assert (row.completed_count, row.revision) == (1, 2)
        assert len(list(await db.scalars(select(ServiceFulfillmentEvent).where(ServiceFulfillmentEvent.fulfillment_id == identity)))) == 1


@pytest.mark.parametrize("kind", ["customer", "staff"])
async def test_framework_mariadb_scenario_revision_cas_is_not_lost(framework_db, kind):
    fixture = framework_db
    end = datetime.now(UTC) + timedelta(days=1)
    if kind == "customer":
        request = ScenarioAssignmentWrite(expected_revision=0, mode="competition", entry_url="https://www.idtrade.cn/User/Contest",
                                          allowed_origins=["https://www.idtrade.cn"], expires_at=end)
        async with fixture.sessions() as db:
            await scenarios.save_assignment(db, "user", fixture.user_id, request, fixture.staff_id)
        async def save(db, _index):
            return await scenarios.save_assignment(db, "user", fixture.user_id,
                request.model_copy(update={"expected_revision": 1, "status": "disabled"}), fixture.staff_id)
        query = select(ScenarioAssignment).where(ScenarioAssignment.subject_type == "user", ScenarioAssignment.subject_id == fixture.user_id)
    else:
        request = StaffRuntimePermissionWrite(expected_revision=0, enabled=True, allowed_origins=["https://fixture.test"], expires_at=end)
        async with fixture.sessions() as db:
            await scenarios.save_staff_permission(db, fixture.staff_id, request, fixture.staff_id)
        async def save(db, _index):
            return await scenarios.save_staff_permission(db, fixture.staff_id,
                request.model_copy(update={"expected_revision": 1, "enabled": False}), fixture.staff_id)
        query = select(StaffRuntimePermission).where(StaffRuntimePermission.staff_id == fixture.staff_id)
    assert len(await race(fixture, save, stale=query)) == 1
    async with fixture.sessions() as db:
        row = await db.scalar(query)
        assert row.revision == 2
        if kind == "customer":
            assert (await scenarios.effective_policy(db, fixture.user_id))["status"] == "blocked"
        else:
            assert row.enabled is False
