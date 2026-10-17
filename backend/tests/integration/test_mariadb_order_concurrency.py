import asyncio
import json
import os
import uuid
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from fastapi import HTTPException, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.exceptions import ConflictException
from core.security import hash_password
from database import Base, get_db
from domains.automation import demo_service
from domains.knowledge import chat_service
from main import app
from models import (
    AuditLog,
    AuthCode,
    AuthSeat,
    AuthSession,
    ChatMessage,
    ChatSession,
    Device,
    ExpenseAttachment,
    ExpenseCategory,
    ExpenseRecord,
    ExpenseRenewal,
    ExpenseRenewalOccurrence,
    Feedback,
    Order,
    Plan,
    ProfitRecord,
    StaffRole,
    StaffStatus,
    StaffUser,
    User,
)
from models.demo import DemoBatch, DemoBatchItem
from schemas.demo import DemoBatchItemUpdate, DemoBatchResponse, DemoBatchUpdate, DemoEvent
from schemas.plan import PlanUpdate
from services.plan_service import PlanService
from services.staff_service import create_staff_access_token


@pytest.mark.asyncio
async def test_twenty_concurrent_chat_handoffs_create_one_scoped_ticket():
    engine = create_async_engine(
        _mariadb_test_url(), pool_size=20, max_overflow=0,
        pool_pre_ping=True, isolation_level="READ COMMITTED",
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:12]
    session_id = f"handoff-{suffix}"
    owner_id: int | None = None
    all_preloaded = asyncio.Event()
    preloaded_count = 0
    tasks: list[asyncio.Task[Any]] = []
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            owner = User(name=f"Handoff {suffix}", is_active=True)
            db.add(owner)
            await db.flush()
            owner_id = owner.id
            db.add(ChatSession(
                session_id=session_id, user_id=owner_id, status="active",
                platform_key="amazon", capability_key="logistics_template",
            ))
            await db.commit()

        async def transfer() -> int | None | ConflictException:
            nonlocal preloaded_count
            async with sessions() as db:
                # Model the router ownership check: every identity map holds
                # the initial active row before any worker can transfer it.
                stale_session = (await db.execute(
                    select(ChatSession).where(ChatSession.session_id == session_id)
                )).scalar_one()
                assert stale_session.status == "active"
                preloaded_count += 1
                if preloaded_count == 20:
                    all_preloaded.set()
                await asyncio.wait_for(all_preloaded.wait(), timeout=15)
                try:
                    return await chat_service.transfer_to_human(
                        db, session_id, user_id=owner_id, summary="并发验收问题",
                    )
                except ConflictException as error:
                    return error

        tasks = [asyncio.create_task(transfer()) for _ in range(20)]
        results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=30)
        ids = [result for result in results if isinstance(result, int)]
        conflicts = [result for result in results if isinstance(result, ConflictException)]
        assert len(ids) == 1, results
        assert len(conflicts) == 19
        assert all(error.code == 409 for error in conflicts)
        async with sessions() as db:
            tickets = (await db.execute(select(Feedback).where(Feedback.user_id == owner_id))).scalars().all()
            assert len(tickets) == 1
            assert tickets[0].id == ids[0]
            assert (tickets[0].platform_key, tickets[0].capability_key) == ("amazon", "logistics_template")
            conversation = (await db.execute(
                select(ChatSession).where(ChatSession.session_id == session_id)
            )).scalar_one()
            assert conversation.status == "transferred"
            assert conversation.transferred_to_human is True
    finally:
        all_preloaded.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            if owner_id is not None:
                async with sessions() as db:
                    await db.execute(delete(Feedback).where(Feedback.user_id == owner_id))
                    await db.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
                    await db.execute(delete(ChatSession).where(ChatSession.session_id == session_id))
                    await db.execute(delete(User).where(User.id == owner_id))
                    await db.commit()
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_twenty_concurrent_agency_deliveries_issue_one_authorization():
    from starlette.requests import Request

    from domains.commerce.agency import AgencyService
    from models import Agency, AgencyCustomer

    engine = create_async_engine(_mariadb_test_url(), pool_size=20, max_overflow=0, pool_pre_ping=True, isolation_level="READ COMMITTED")
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:12]
    staff_id = agency_id = customer_id = plan_id = order_id = None
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            staff = StaffUser(username=f"agency-owner-{suffix}", display_name="Agency test owner", password_hash=hash_password(f"Test-{suffix}"), role="super_admin", status="active", token_version=1)
            agency = Agency(name=f"Partner {suffix}")
            plan = Plan(name=f"Partner plan {suffix}", price=Decimal("99"), duration_days=30, status="active", product_type="consumer")
            db.add_all([staff, agency, plan])
            await db.flush()
            staff_id, agency_id, plan_id = staff.id, agency.id, plan.id
            customer = AgencyCustomer(name=f"Customer {suffix}", agency_id=agency_id, created_by_staff_id=staff_id)
            db.add(customer)
            await db.flush()
            customer_id = customer.id
            order = Order(order_no=f"AGENCY-CONCURRENT-{suffix}", plan_id=plan_id, plan_name_snapshot=plan.name, plan_price_snapshot=plan.price, plan_duration_days_snapshot=30, amount=plan.price, status="paid", agency_id=agency_id, customer_id=customer_id, platform_key="amazon", created_by_staff_id=staff_id)
            db.add(order)
            await db.flush()
            order_id = order.id
            await db.commit()
        actor = {"staff_id": staff_id, "username": f"agency-owner-{suffix}", "role": "super_admin"}
        async def issue() -> int:
            async with sessions() as db:
                result = await AgencyService(db, actor).deliver(order_id, Request({"type": "http", "headers": [], "method": "POST", "path": "/test-agency-deliver"}))
                assert result.auth_code is not None
                return result.auth_code.id
        results = await asyncio.wait_for(asyncio.gather(*(issue() for _ in range(20))), timeout=45)
        assert len(set(results)) == 1
        async with sessions() as db:
            assert (await db.execute(select(func.count(AuthCode.id)).where(AuthCode.order_id == order_id))).scalar_one() == 1
    finally:
        async with sessions() as db:
            if staff_id is not None:
                await db.execute(delete(AuditLog).where(AuditLog.user_id == staff_id))
            if order_id is not None:
                await db.execute(delete(AuthCode).where(AuthCode.order_id == order_id))
                await db.execute(delete(Order).where(Order.id == order_id))
            if customer_id is not None:
                await db.execute(delete(AgencyCustomer).where(AgencyCustomer.id == customer_id))
            if plan_id is not None:
                await db.execute(delete(Plan).where(Plan.id == plan_id))
            if agency_id is not None:
                await db.execute(delete(Agency).where(Agency.id == agency_id))
            if staff_id is not None:
                await db.execute(delete(StaffUser).where(StaffUser.id == staff_id))
            await db.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_customer_reassignment_and_delivery_share_lock_order_and_new_scope():
    from starlette.requests import Request

    from domains.commerce.agency import AgencyService
    from models import Agency, AgencyCustomer
    from schemas.agency import CustomerUpdate

    engine = create_async_engine(_mariadb_test_url(), pool_size=5, max_overflow=0, pool_pre_ping=True, isolation_level="READ COMMITTED")
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:12]
    staff_id = customer_id = plan_id = order_id = None
    agency_ids: list[int] = []
    customer_locked = asyncio.Event()
    delivery_reached_customer = asyncio.Event()
    tasks: list[asyncio.Task[Any]] = []
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            staff = StaffUser(username=f"transfer-owner-{suffix}", display_name="Transfer test owner", password_hash=hash_password(f"Test-{suffix}"), role="super_admin", status="active", token_version=1)
            agencies = [Agency(name=f"Transfer {side} {suffix}") for side in ("A", "B")]
            plan = Plan(name=f"Transfer plan {suffix}", price=Decimal("99"), duration_days=30, status="active", product_type="consumer")
            db.add_all([staff, *agencies, plan])
            await db.flush()
            staff_id, plan_id = staff.id, plan.id
            agency_ids = [agency.id for agency in agencies]
            customer = AgencyCustomer(name=f"Transfer customer {suffix}", agency_id=agency_ids[0], created_by_staff_id=staff_id)
            db.add(customer)
            await db.flush()
            customer_id = customer.id
            order = Order(order_no=f"AGENCY-TRANSFER-{suffix}", plan_id=plan_id, plan_name_snapshot=plan.name, plan_price_snapshot=plan.price, plan_duration_days_snapshot=30, amount=plan.price, status="paid", agency_id=agency_ids[0], customer_id=customer_id, platform_key="amazon", created_by_staff_id=staff_id)
            db.add(order)
            await db.flush()
            order_id = order.id
            await db.commit()
        actor = {"staff_id": staff_id, "username": f"transfer-owner-{suffix}", "role": "super_admin"}
        request = Request({"type": "http", "headers": [], "method": "POST", "path": "/test-agency-transfer"})

        async def transfer() -> None:
            async with sessions() as db:
                service = AgencyService(db, actor)
                original_get = service._get
                async def hold_customer(model: Any, item_id: int, *, lock: bool = False) -> Any:
                    item = await original_get(model, item_id, lock=lock)
                    if model is AgencyCustomer and lock:
                        customer_locked.set()
                        await asyncio.wait_for(delivery_reached_customer.wait(), timeout=10)
                    return item
                service._get = hold_customer
                await service.update_customer(customer_id, CustomerUpdate(agency_id=agency_ids[1]), request)

        async def deliver() -> int:
            await asyncio.wait_for(customer_locked.wait(), timeout=10)
            async with sessions() as db:
                service = AgencyService(db, actor)
                original_get = service._get
                async def announce_customer(model: Any, item_id: int, *, lock: bool = False) -> Any:
                    if model is AgencyCustomer and lock:
                        delivery_reached_customer.set()
                    return await original_get(model, item_id, lock=lock)
                service._get = announce_customer
                result = await service.deliver(order_id, request)
                assert result.auth_code is not None
                return result.auth_code.id

        tasks = [asyncio.create_task(transfer()), asyncio.create_task(deliver())]
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=25)
        async with sessions() as db:
            customer = await db.get(AgencyCustomer, customer_id)
            order = await db.get(Order, order_id)
            codes = (await db.execute(select(AuthCode).where(AuthCode.order_id == order_id))).scalars().all()
            assert customer.agency_id == order.agency_id == agency_ids[1]
            assert len(codes) == 1 and codes[0].agency_id == agency_ids[1]
            old_agent = {**actor, "role": "agent", "agency_id": agency_ids[0]}
            assert (await AgencyService(db, old_agent).licenses(1, 20, None, None))["total"] == 0
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        async with sessions() as db:
            if staff_id is not None:
                await db.execute(delete(AuditLog).where(AuditLog.user_id == staff_id))
            if order_id is not None:
                await db.execute(delete(AuthCode).where(AuthCode.order_id == order_id))
                await db.execute(delete(Order).where(Order.id == order_id))
            if customer_id is not None:
                await db.execute(delete(AgencyCustomer).where(AgencyCustomer.id == customer_id))
            if plan_id is not None:
                await db.execute(delete(Plan).where(Plan.id == plan_id))
            if agency_ids:
                await db.execute(delete(Agency).where(Agency.id.in_(agency_ids)))
            if staff_id is not None:
                await db.execute(delete(StaffUser).where(StaffUser.id == staff_id))
            await db.commit()
        await engine.dispose()


def _mariadb_test_url() -> str:
    raw_url = os.getenv("MARIADB_TEST_URL", "").strip()
    if not raw_url:
        if os.getenv("REQUIRE_MARIADB_TEST") == "1":
            pytest.fail("MARIADB_TEST_URL is required for this verification run")
        pytest.skip("MARIADB_TEST_URL is not configured; real row-lock test skipped")

    url = make_url(raw_url)
    if url.drivername in {"mysql", "mysql+pymysql", "mariadb", "mariadb+pymysql"}:
        url = url.set(drivername="mysql+aiomysql")
    if not url.drivername.startswith(("mysql+aiomysql", "mariadb+aiomysql")):
        pytest.fail("MARIADB_TEST_URL must use a real MariaDB/MySQL database with the aiomysql driver")
    return url.render_as_string(hide_password=False)


@pytest.mark.asyncio
async def test_concurrent_plan_price_updates_accept_one_expected_price():
    engine = create_async_engine(
        _mariadb_test_url(), pool_size=2, max_overflow=0,
        pool_pre_ping=True, isolation_level="READ COMMITTED",
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:12]
    staff_id: int | None = None
    plan_id: int | None = None
    original_price = Decimal("199.00")
    proposals = (Decimal("249.99"), Decimal("299.99"))
    all_preloaded = asyncio.Event()
    connection_ids: set[int] = set()
    tasks: list[asyncio.Task[Any]] = []
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            staff = StaffUser(
                username=f"price-concurrency-{suffix}", display_name="Price concurrency test",
                password_hash=hash_password(f"Concurrency-{suffix}"),
                role=StaffRole.SUPER_ADMIN, status=StaffStatus.ACTIVE, token_version=1,
            )
            plan = Plan(
                name=f"Price concurrency {suffix}", price=original_price,
                duration_days=30, status="active", product_type="consumer",
            )
            db.add_all([staff, plan])
            await db.flush()
            staff_id, plan_id = staff.id, plan.id
            await db.commit()
        actor = {
            "staff_id": staff_id, "username": f"price-concurrency-{suffix}",
            "role": "super_admin",
        }

        async def change_price(proposed: Decimal) -> dict | ConflictException:
            async with sessions() as db:
                # Both requests retain the same old ORM row in distinct open
                # transactions. The locked read must refresh that identity map.
                stale_plan = (await db.execute(select(Plan).where(Plan.id == plan_id))).scalar_one()
                assert stale_plan.price == original_price
                connection_ids.add(int((await db.execute(select(func.connection_id()))).scalar_one()))
                if len(connection_ids) == 2:
                    all_preloaded.set()
                await asyncio.wait_for(all_preloaded.wait(), timeout=15)
                payload = PlanUpdate(price=proposed, expected_price=original_price)
                try:
                    return await PlanService(db).update(
                        plan_id, payload.model_dump(exclude_unset=True), actor,
                        Request({"type": "http", "headers": [], "method": "PATCH", "path": "/test-plan-price"}),
                    )
                except ConflictException as error:
                    await db.rollback()
                    return error

        tasks = [asyncio.create_task(change_price(price)) for price in proposals]
        results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=30)
        successes = [result for result in results if isinstance(result, dict)]
        conflicts = [result for result in results if isinstance(result, ConflictException)]
        assert len(connection_ids) == 2
        assert len(successes) == len(conflicts) == 1, results
        assert successes[0]["success"] is True
        assert conflicts[0].code == 409
        winning_price = Decimal(str(successes[0]["data"]["price"]))
        assert winning_price in proposals
        async with sessions() as db:
            persisted = (await db.execute(select(Plan).where(Plan.id == plan_id))).scalar_one()
            assert persisted.price == winning_price
            assert persisted.status == "active"
            assert persisted.duration_days == 30
            audits = (await db.execute(select(AuditLog).where(
                AuditLog.user_id == staff_id, AuditLog.target_type == "plan",
                AuditLog.target_id == str(plan_id), AuditLog.action == "plan_update",
            ))).scalars().all()
            assert len(audits) == 1
            detail = json.loads(audits[0].detail)
            assert Decimal(str(detail["before"]["price"])) == original_price
            assert Decimal(str(detail["after"]["price"])) == winning_price
    finally:
        all_preloaded.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            async with sessions() as db:
                if staff_id is not None:
                    await db.execute(delete(AuditLog).where(AuditLog.user_id == staff_id))
                if plan_id is not None:
                    await db.execute(delete(Plan).where(Plan.id == plan_id))
                if staff_id is not None:
                    await db.execute(delete(StaffUser).where(StaffUser.id == staff_id))
                await db.commit()
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_twenty_concurrent_manual_paid_transitions_create_one_profit_record():
    engine = create_async_engine(
        _mariadb_test_url(),
        pool_size=20,
        max_overflow=5,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:12]
    staff_id: int | None = None
    plan_id: int | None = None
    order_id: int | None = None

    async def override_get_db():
        async with sessions() as session:
            try:
                yield session
            finally:
                if session.in_transaction():
                    await session.rollback()

    previous_override = app.dependency_overrides.get(get_db)
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as session:
            staff = StaffUser(
                username=f"concurrency-{suffix}",
                display_name="MariaDB concurrency test",
                password_hash=hash_password(f"Concurrency-{suffix}"),
                role=StaffRole.SUPER_ADMIN,
                status=StaffStatus.ACTIVE,
                token_version=1,
                force_password_reset=False,
            )
            plan = Plan(
                name=f"MariaDB concurrency plan {suffix}",
                price=Decimal("99.99"),
                duration_days=30,
                status="active",
                product_type="consumer",
            )
            session.add_all([staff, plan])
            await session.flush()
            order = Order(
                order_no=f"ORD-CONCURRENCY-{suffix}",
                plan_id=plan.id,
                plan_name_snapshot=plan.name,
                plan_price_snapshot=plan.price,
                plan_duration_days_snapshot=plan.duration_days,
                amount=plan.price,
                status="pending",
                created_by_staff_id=staff.id,
                updated_by_staff_id=staff.id,
            )
            session.add(order)
            await session.flush()
            staff_id, plan_id, order_id = staff.id, plan.id, order.id
            await session.commit()
            await session.refresh(staff)
            await session.refresh(order)
            token = create_staff_access_token(staff)

        app.dependency_overrides[get_db] = override_get_db
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://mariadb-test") as client:
            responses = await asyncio.gather(*[
                client.post(
                    f"/api/orders/{order_id}/mark-paid",
                    headers={"Authorization": f"Bearer {token}"},
                )
                for _ in range(20)
            ])

        statuses = [response.status_code for response in responses]
        assert statuses.count(200) == 1, [response.text for response in responses]
        assert statuses.count(409) == 19, [response.text for response in responses]

        async with sessions() as session:
            persisted_order = (
                await session.execute(select(Order).where(Order.id == order_id))
            ).scalar_one()
            profit_count = (
                await session.execute(
                    select(func.count(ProfitRecord.id)).where(ProfitRecord.order_id == order_id)
                )
            ).scalar_one()
            assert persisted_order.status == "paid"
            assert profit_count == 1
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override

        if any(identifier is not None for identifier in (staff_id, plan_id, order_id)):
            async with sessions() as session:
                if staff_id is not None:
                    await session.execute(delete(AuditLog).where(AuditLog.user_id == staff_id))
                if order_id is not None:
                    await session.execute(delete(ProfitRecord).where(ProfitRecord.order_id == order_id))
                    await session.execute(delete(Order).where(Order.id == order_id))
                if plan_id is not None:
                    await session.execute(delete(Plan).where(Plan.id == plan_id))
                if staff_id is not None:
                    await session.execute(delete(StaffUser).where(StaffUser.id == staff_id))
                await session.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_demo_last_item_snapshot_and_finish_use_one_serialized_state(monkeypatch):
    """Hold the last child transaction open while two real connections contend.

    No timing sleeps decide the winner: either the stale snapshot gets the
    parent lock first and must recount, or finish wins and rejects the snapshot.
    """
    engine = create_async_engine(
        _mariadb_test_url(),
        pool_size=5,
        max_overflow=0,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",
    )
    last_item_flushed = asyncio.Event()
    release_last_item = asyncio.Event()
    at_lock_query = {name: asyncio.Event() for name in ("snapshot", "finish")}
    acquired_parent_lock: list[str] = []
    connection_ids: dict[str, int] = {}

    class CoordinatedSession(AsyncSession):
        async def commit(self) -> None:
            if self.info.get("operation") == "last_item":
                # At this point the actual service has changed both child and
                # parent counts, but its FOR UPDATE locks remain uncommitted.
                await self.flush()
                last_item_flushed.set()
                await asyncio.wait_for(release_last_item.wait(), timeout=15)
            await super().commit()

    sessions = async_sessionmaker(
        engine, class_=CoordinatedSession, expire_on_commit=False, autoflush=False,
    )
    original_owned_batch = demo_service._owned_batch

    async def observe_owned_batch(
        db: AsyncSession, batch_id: str, user_id: int, *, lock: bool = False,
    ) -> DemoBatch:
        operation = str(db.info.get("operation", ""))
        if operation in at_lock_query:
            assert lock, "Concurrent mutations must take the parent row lock"
            at_lock_query[operation].set()
        batch = await original_owned_batch(db, batch_id, user_id, lock=lock)
        if operation:
            acquired_parent_lock.append(operation)
        return batch

    monkeypatch.setattr(demo_service, "_owned_batch", observe_owned_batch)
    suffix = uuid.uuid4().hex[:12]
    batch_id = f"demo_race_{suffix}"
    last_item_ref = f"last_{suffix}"
    user_id: int | None = None
    tasks: list[asyncio.Task[Any]] = []
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as session:
            owner = User(name=f"Demo race {suffix}", is_active=True)
            session.add(owner)
            await session.flush()
            user_id = owner.id
            session.add(DemoBatch(
                id=batch_id, user_id=user_id, tool_id="demo-race",
                tool_name_snapshot="Demo race regression", platform_key="amazon",
                scenario_id="demo_batch_walkthrough_v1", row_count=2,
                status="running", event_seq=1, queued_count=0, playing_count=1,
                played_count=1, skipped_count=0, error_count=0,
            ))
            await session.flush()
            session.add_all([
                DemoBatchItem(
                    batch_id=batch_id, item_ref=f"done_{suffix}", status="played",
                    event_seq=2, simulated_outcome="completed_example",
                ),
                DemoBatchItem(
                    batch_id=batch_id, item_ref=last_item_ref, status="playing", event_seq=1,
                ),
            ])
            await session.commit()

        owner_context = {"user_id": user_id}

        async def mutate(operation: str) -> Any:
            async with sessions() as session:
                session.info["operation"] = operation
                connection_ids[operation] = int(
                    (await session.execute(select(func.connection_id()))).scalar_one()
                )
                try:
                    if operation == "last_item":
                        return await demo_service.update_demo_batch_item(
                            session, batch_id, last_item_ref,
                            DemoBatchItemUpdate(
                                event_seq=2, status="played", simulated_outcome="completed_example",
                            ),
                            owner_context,
                        )
                    if operation == "snapshot":
                        return await demo_service.update_demo_batch(
                            session, batch_id,
                            DemoBatchUpdate(
                                event_seq=2, status="running", queued_count=0,
                                playing_count=1, played_count=1, skipped_count=0, error_count=0,
                            ),
                            owner_context,
                        )
                    return await demo_service.finish_demo_batch(
                        session, batch_id, DemoEvent(event_seq=3), owner_context,
                    )
                except HTTPException as error:
                    return error

        tasks.append(asyncio.create_task(mutate("last_item")))
        await asyncio.wait_for(last_item_flushed.wait(), timeout=15)
        tasks.extend([
            asyncio.create_task(mutate("snapshot")),
            asyncio.create_task(mutate("finish")),
        ])
        await asyncio.wait_for(
            asyncio.gather(*(event.wait() for event in at_lock_query.values())), timeout=15,
        )
        assert len(set(connection_ids.values())) == 3, connection_ids
        assert acquired_parent_lock == ["last_item"]
        release_last_item.set()
        item, snapshot, finished = await asyncio.wait_for(asyncio.gather(*tasks), timeout=15)

        assert not isinstance(item, HTTPException), item
        assert item.status == "played"
        assert isinstance(finished, DemoBatchResponse), finished
        assert finished.status == "completed"
        assert (finished.played_count, finished.playing_count, finished.queued_count) == (2, 0, 0)
        if isinstance(snapshot, HTTPException):
            assert snapshot.status_code == 409
            assert acquired_parent_lock == ["last_item", "finish", "snapshot"]
        else:
            assert (snapshot.played_count, snapshot.playing_count, snapshot.queued_count) == (2, 0, 0)
            assert acquired_parent_lock == ["last_item", "snapshot", "finish"]

        # Replays and an even newer stale heartbeat cannot reopen completion.
        async with sessions() as session:
            replay = await demo_service.finish_demo_batch(
                session, batch_id, DemoEvent(event_seq=3), owner_context,
            )
            assert replay.status == "completed"
            with pytest.raises(HTTPException) as late_snapshot:
                await demo_service.update_demo_batch(
                    session, batch_id, DemoBatchUpdate(event_seq=4, status="running"), owner_context,
                )
            assert late_snapshot.value.status_code == 409

        async with sessions() as session:
            persisted = (await session.execute(
                select(DemoBatch).where(DemoBatch.id == batch_id)
            )).scalar_one()
            children = (await session.execute(
                select(DemoBatchItem).where(DemoBatchItem.batch_id == batch_id)
            )).scalars().all()
            assert (persisted.status, persisted.event_seq) == ("completed", 3)
            assert (persisted.played_count, persisted.playing_count, persisted.queued_count) == (2, 0, 0)
            assert persisted.skipped_count == persisted.error_count == 0
            assert len(children) == 2
            assert all(child.status == "played" and child.event_seq == 2 for child in children)
    finally:
        release_last_item.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            if user_id is not None:
                async with sessions() as session:
                    await session.execute(delete(DemoBatchItem).where(DemoBatchItem.batch_id == batch_id))
                    await session.execute(delete(DemoBatch).where(DemoBatch.id == batch_id))
                    await session.execute(delete(User).where(User.id == user_id))
                    await session.commit()
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_renewal_confirmation_creates_one_expense_for_due_cycle():
    engine = create_async_engine(
        _mariadb_test_url(),
        pool_size=20,
        max_overflow=5,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:12]
    staff_id: int | None = None
    category_id: int | None = None
    renewal_id: int | None = None
    due_on = date(2027, 1, 31)

    async def override_get_db():
        async with sessions() as session:
            try:
                yield session
            finally:
                if session.in_transaction():
                    await session.rollback()

    previous_override = app.dependency_overrides.get(get_db)
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as session:
            staff = StaffUser(
                username=f"renewal-concurrency-{suffix}",
                display_name="Renewal concurrency test",
                password_hash=hash_password(f"Concurrency-{suffix}"),
                role=StaffRole.SUPER_ADMIN,
                status=StaffStatus.ACTIVE,
                token_version=1,
                force_password_reset=False,
            )
            category = ExpenseCategory(
                code=f"concurrency_{suffix}",
                name=f"并发测试 {suffix}",
                status="active",
                sort_order=999,
                is_system=False,
            )
            session.add_all([staff, category])
            await session.flush()
            renewal = ExpenseRenewal(
                name=f"并发续费 {suffix}",
                vendor="Test vendor",
                default_amount=Decimal("88.00"),
                category_id=category.id,
                cycle="monthly",
                next_due_on=due_on,
                reminder_days=7,
                anchor_day=31,
                anchor_month_end=True,
                status="active",
                created_by_staff_id=staff.id,
                updated_by_staff_id=staff.id,
            )
            session.add(renewal)
            await session.flush()
            staff_id, category_id, renewal_id = staff.id, category.id, renewal.id
            await session.commit()
            token = create_staff_access_token(staff)

        app.dependency_overrides[get_db] = override_get_db
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://mariadb-test") as client:
            responses = await asyncio.gather(*[
                client.post(
                    f"/api/expenses/renewals/{renewal_id}/confirm",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"due_on": due_on.isoformat(), "expense_date": date.today().isoformat()},
                )
                for _ in range(20)
            ])

        statuses = [response.status_code for response in responses]
        assert statuses.count(200) == 1, [response.text for response in responses]
        assert statuses.count(409) == 19, [response.text for response in responses]

        async with sessions() as session:
            expense_count = (
                await session.execute(
                    select(func.count(ExpenseRecord.id)).where(
                        ExpenseRecord.renewal_id == renewal_id,
                        ExpenseRecord.renewal_due_on == due_on,
                    )
                )
            ).scalar_one()
            occurrence_count = (
                await session.execute(
                    select(func.count(ExpenseRenewalOccurrence.id)).where(
                        ExpenseRenewalOccurrence.renewal_id == renewal_id,
                        ExpenseRenewalOccurrence.due_on == due_on,
                    )
                )
            ).scalar_one()
            assert expense_count == 1
            assert occurrence_count == 1
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override

        if any(identifier is not None for identifier in (staff_id, category_id, renewal_id)):
            async with sessions() as session:
                if staff_id is not None:
                    await session.execute(delete(AuditLog).where(AuditLog.user_id == staff_id))
                if renewal_id is not None:
                    await session.execute(delete(ExpenseRenewalOccurrence).where(ExpenseRenewalOccurrence.renewal_id == renewal_id))
                    await session.execute(delete(ExpenseRecord).where(ExpenseRecord.renewal_id == renewal_id))
                    await session.execute(delete(ExpenseRenewal).where(ExpenseRenewal.id == renewal_id))
                if category_id is not None:
                    await session.execute(delete(ExpenseCategory).where(ExpenseCategory.id == category_id))
                if staff_id is not None:
                    await session.execute(delete(StaffUser).where(StaffUser.id == staff_id))
                await session.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_twenty_concurrent_first_activations_do_not_oversell_seats_or_devices():
    engine = create_async_engine(
        _mariadb_test_url(),
        pool_size=20,
        max_overflow=5,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:12]
    plan_id: int | None = None
    auth_code_id: int | None = None

    async def override_get_db():
        async with sessions() as session:
            try:
                yield session
            finally:
                if session.in_transaction():
                    await session.rollback()

    previous_override = app.dependency_overrides.get(get_db)
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)

        code_value = f"AUTH-CONCURRENCY-{suffix}"
        async with sessions() as session:
            plan = Plan(
                name=f"Activation concurrency {suffix}",
                price=Decimal("19.00"),
                duration_days=30,
                status="active",
                product_type="consumer",
            )
            session.add(plan)
            await session.flush()
            auth_code = AuthCode(
                code=code_value,
                plan_id=plan.id,
                max_devices=1,
                seat_limit=1,
                status="unused",
            )
            session.add(auth_code)
            await session.flush()
            plan_id, auth_code_id = plan.id, auth_code.id
            await session.commit()

        app.dependency_overrides[get_db] = override_get_db
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://mariadb-test") as client:
            responses = await asyncio.gather(*[
                client.post(
                    "/api/auth/verify",
                    json={
                        "code": code_value,
                        "device_id": f"device-{suffix}-{index}",
                        "device_name": f"desktop-{suffix}-{index}",
                    },
                )
                for index in range(20)
            ])

        bodies = [response.json() for response in responses]
        assert sum(body["success"] is True for body in bodies) == 1, bodies
        assert sum(body["success"] is False for body in bodies) == 19, bodies

        async with sessions() as session:
            user_count = int((await session.execute(
                select(func.count(User.id)).where(User.auth_code_id == auth_code_id)
            )).scalar_one())
            seat_count = int((await session.execute(
                select(func.count(AuthSeat.id)).where(
                    AuthSeat.auth_code_id == auth_code_id,
                    AuthSeat.status == "active",
                )
            )).scalar_one())
            device_count = int((await session.execute(
                select(func.count(Device.id)).where(Device.auth_code_id == auth_code_id)
            )).scalar_one())
            assert (user_count, seat_count, device_count) == (1, 1, 1)
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override

        if auth_code_id is not None or plan_id is not None:
            async with sessions() as session:
                if auth_code_id is not None:
                    await session.execute(
                        update(AuthCode).where(AuthCode.id == auth_code_id).values(user_id=None)
                    )
                    await session.execute(delete(AuthSession).where(AuthSession.auth_code_id == auth_code_id))
                    await session.execute(delete(AuthSeat).where(AuthSeat.auth_code_id == auth_code_id))
                    await session.execute(delete(Device).where(Device.auth_code_id == auth_code_id))
                    await session.execute(delete(User).where(User.auth_code_id == auth_code_id))
                    await session.execute(delete(AuthCode).where(AuthCode.id == auth_code_id))
                if plan_id is not None:
                    await session.execute(delete(Plan).where(Plan.id == plan_id))
                await session.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_attachment_uploads_enforce_five_file_limit(tmp_path, monkeypatch):
    engine = create_async_engine(
        _mariadb_test_url(),
        pool_size=10,
        max_overflow=2,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",
    )
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:12]
    staff_id: int | None = None
    category_id: int | None = None
    expense_id: int | None = None
    monkeypatch.setenv("EXPENSE_ATTACHMENT_DIR", str(tmp_path))

    async def override_get_db():
        async with sessions() as session:
            try:
                yield session
            finally:
                if session.in_transaction():
                    await session.rollback()

    previous_override = app.dependency_overrides.get(get_db)
    try:
        async with engine.begin() as connection:
            assert connection.dialect.name in {"mysql", "mariadb"}
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as session:
            staff = StaffUser(
                username=f"attachment-concurrency-{suffix}",
                display_name="Attachment concurrency test",
                password_hash=hash_password(f"Concurrency-{suffix}"),
                role=StaffRole.SUPER_ADMIN,
                status=StaffStatus.ACTIVE,
                token_version=1,
                force_password_reset=False,
            )
            category = ExpenseCategory(
                code=f"attachment_{suffix}",
                name=f"附件并发测试 {suffix}",
                status="active",
                sort_order=999,
                is_system=False,
            )
            session.add_all([staff, category])
            await session.flush()
            expense = ExpenseRecord(
                amount=Decimal("12.34"),
                currency="CNY",
                expense_date=date.today(),
                title=f"附件并发测试 {suffix}",
                category_id=category.id,
                status="active",
                created_by_staff_id=staff.id,
                updated_by_staff_id=staff.id,
            )
            session.add(expense)
            await session.flush()
            staff_id, category_id, expense_id = staff.id, category.id, expense.id
            await session.commit()
            token = create_staff_access_token(staff)

        app.dependency_overrides[get_db] = override_get_db
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://mariadb-test") as client:
            responses = await asyncio.gather(*[
                client.post(
                    f"/api/expenses/{expense_id}/attachments",
                    headers={"Authorization": f"Bearer {token}"},
                    files={
                        "file": (
                            f"receipt-{index}.png",
                            b"\x89PNG\r\n\x1a\n" + bytes([index]),
                            "image/png",
                        )
                    },
                )
                for index in range(10)
            ])

        statuses = [response.status_code for response in responses]
        assert statuses.count(201) == 5, [response.text for response in responses]
        assert statuses.count(409) == 5, [response.text for response in responses]

        async with sessions() as session:
            attachment_count = int((await session.execute(
                select(func.count(ExpenseAttachment.id)).where(
                    ExpenseAttachment.expense_id == expense_id
                )
            )).scalar_one())
            assert attachment_count == 5
        assert len(list(tmp_path.rglob("*.png"))) == 5
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override

        if any(identifier is not None for identifier in (staff_id, category_id, expense_id)):
            async with sessions() as session:
                if staff_id is not None:
                    await session.execute(delete(AuditLog).where(AuditLog.user_id == staff_id))
                if expense_id is not None:
                    await session.execute(
                        delete(ExpenseAttachment).where(
                            ExpenseAttachment.expense_id == expense_id
                        )
                    )
                    await session.execute(delete(ExpenseRecord).where(ExpenseRecord.id == expense_id))
                if category_id is not None:
                    await session.execute(delete(ExpenseCategory).where(ExpenseCategory.id == category_id))
                if staff_id is not None:
                    await session.execute(delete(StaffUser).where(StaffUser.id == staff_id))
                await session.commit()
        await engine.dispose()
