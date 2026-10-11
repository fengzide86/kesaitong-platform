"""Concurrent HTTP requests, independent connections, no process-level lock."""

import asyncio
import json
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings
from core.exceptions import register_exception_handlers
from database import Base, get_db
from domains.access import auth_codes
from domains.automation import launch_service
from models import AuditLog, AuthCode, LaunchToken, Setting, StaffRole, StaffUser
from routers import auth_codes as auth_router
from routers import profit, staff, tools
from services import profit_service, staff_service
from tests.api.test_tools import _seed_live_launch_access

RATIOS = {"tech": "0.30", "market": "0.25", "product": "0.15", "service": "0.15", "coordination": "0.10", "record": "0.05"}


@pytest_asyncio.fixture
async def isolated_http(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'guards.sqlite').as_posix()}", connect_args={"timeout": 15})
    sessions = async_sessionmaker(engine, class_=AsyncSession, autoflush=False, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(staff.router, prefix="/api/staff")
    app.include_router(profit.router, prefix="/api/profit")
    app.include_router(auth_router.router, prefix="/api/auth-codes")
    app.include_router(tools.router, prefix="/api/tools")

    async def test_db():
        async with sessions() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = test_db
    async with sessions() as db:
        accounts = [StaffUser(username=f"admin-{i}", display_name=f"Admin {i}", password_hash="not-used", role=StaffRole.SUPER_ADMIN, status="active", token_version=1, force_password_reset=False) for i in (1, 2)]
        db.add_all(accounts)
        await db.commit()
        ids = [row.id for row in accounts]
        headers = [{"Authorization": f"Bearer {staff_service.create_staff_access_token(row)}"} for row in accounts]
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://isolated.test") as client:
            yield client, sessions, ids, headers
    finally:
        await engine.dispose()


def synchronized_guard(monkeypatch, module, *, preload_policy=False):
    original = module.acquire_transaction_guard
    arrived = 0
    ready = asyncio.Event()

    async def before_guard(db, name):
        nonlocal arrived
        # Both HTTP dependencies have authenticated before either acquires the
        # real DB guard. Retain loaded rows to also exercise stale identity maps.
        stale_rows = (await db.execute(select(Setting))).scalars().all() if preload_policy else []
        arrived += 1
        if arrived == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), 5)
        await original(db, name)
        del stale_rows

    monkeypatch.setattr(module, "acquire_transaction_guard", before_guard)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"status": "disabled"}, {"role": "operator"}])
async def test_two_admins_cannot_concurrently_remove_each_other(isolated_http, monkeypatch, change):
    client, sessions, ids, headers = isolated_http
    synchronized_guard(monkeypatch, staff_service)
    responses = await asyncio.wait_for(asyncio.gather(
        client.patch(f"/api/staff/accounts/{ids[1]}", json=change, headers=headers[0]),
        client.patch(f"/api/staff/accounts/{ids[0]}", json=change, headers=headers[1]),
    ), 15)
    assert sorted(response.status_code for response in responses) == [200, 401]
    async with sessions() as db:
        surviving = (await db.execute(select(StaffUser).where(StaffUser.role == StaffRole.SUPER_ADMIN, StaffUser.status == "active"))).scalars().all()
        assert len(surviving) == 1
        assert len((await db.execute(select(AuditLog).where(AuditLog.action == "staff_update"))).scalars().all()) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("existing_version", [None, 7])
async def test_profit_versions_and_audits_serialize_on_first_and_later_updates(isolated_http, monkeypatch, existing_version):
    client, sessions, _, headers = isolated_http
    if existing_version:
        async with sessions() as db:
            db.add(Setting(key="profit_ratios", value=json.dumps({"version": existing_version, "ratios": RATIOS})))
            await db.commit()
    synchronized_guard(monkeypatch, profit_service, preload_policy=True)
    responses = await asyncio.wait_for(asyncio.gather(*[
        client.put("/api/profit/policy", json={"ratios": ratios}, headers=headers[0])
        for ratios in [RATIOS, {**RATIOS, "tech": "0.40", "market": "0.15"}]
    ]), 15)
    assert [response.status_code for response in responses] == [200, 200]
    baseline = existing_version or 1
    assert sorted(response.json()["data"]["version"] for response in responses) == [baseline + 1, baseline + 2]
    async with sessions() as db:
        policy = (await db.execute(select(Setting).where(Setting.key == "profit_ratios"))).scalar_one()
        assert json.loads(policy.value)["version"] == baseline + 2
        records = (await db.execute(select(AuditLog).where(AuditLog.action == "profit_policy_update").order_by(AuditLog.id))).scalars().all()
        details = [json.loads(row.detail) for row in records]
        assert [(row["before"]["version"], row["after"]["version"]) for row in details] == [(baseline, baseline + 1), (baseline + 1, baseline + 2)]


@pytest.mark.asyncio
async def test_profit_optimistic_conflict_returns_409_without_duplicate_version(isolated_http, monkeypatch):
    client, sessions, _, headers = isolated_http
    synchronized_guard(monkeypatch, profit_service)
    responses = await asyncio.wait_for(asyncio.gather(*[
        client.put("/api/profit/policy", json={"ratios": RATIOS, "expected_version": 1}, headers=headers[0]) for _ in range(2)
    ]), 15)
    assert sorted(response.status_code for response in responses) == [200, 409]
    async with sessions() as db:
        assert len((await db.execute(select(AuditLog).where(AuditLog.action == "profit_policy_update"))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_extension_and_freeze_are_atomic_in_either_interleaving(isolated_http, monkeypatch):
    client, sessions, _, headers = isolated_http
    async with sessions() as db:
        code = AuthCode(code="CONCURRENT-EXTENSION", status="unused", expires_at=datetime.now() + timedelta(days=2))
        db.add(code)
        await db.commit()
        code_id, old_expiry = code.id, code.expires_at
    original = auth_codes.lock_auth_code
    arrived, ready = 0, asyncio.Event()

    async def before_lock(db, code_id):
        nonlocal arrived
        stale = await db.get(AuthCode, code_id)
        arrived += 1
        if arrived == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), 5)
        result = await original(db, code_id)
        del stale
        return result

    monkeypatch.setattr(auth_codes, "lock_auth_code", before_lock)
    responses = await asyncio.wait_for(asyncio.gather(
        client.put(f"/api/auth-codes/{code_id}", json={"status": "frozen"}, headers=headers[0]),
        client.post(f"/api/auth-codes/{code_id}/extend", json={"days": 30}, headers=headers[0]),
    ), 15)
    assert [response.status_code for response in responses] == [200, 200]
    async with sessions() as db:
        code = await db.get(AuthCode, code_id)
        assert code.status == "frozen"
        assert code.expires_at == old_expiry + timedelta(days=30)


@pytest.mark.asyncio
async def test_concurrent_grant_consumption_is_exactly_once(isolated_http, monkeypatch):
    client, sessions, _, _ = isolated_http
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    async with sessions() as db:
        token, _ = await _seed_live_launch_access(db)
    created = await client.post("/api/tools/live_tool/launch-grant", params={"platform_key": "amazon"}, headers={"Authorization": f"Bearer {token}"})
    grant = created.json()["data"]["token"]
    original = launch_service.lock_auth_code
    arrived, ready = 0, asyncio.Event()

    async def before_lock(db, code_id):
        nonlocal arrived
        arrived += 1
        if arrived == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), 5)
        return await original(db, code_id)

    monkeypatch.setattr(launch_service, "lock_auth_code", before_lock)
    responses = await asyncio.wait_for(asyncio.gather(*[
        client.post("/api/tools/launch-grant/verify", json={"token": grant}) for _ in range(2)
    ]), 15)
    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()["success"] for response in responses) == [False, True]
    async with sessions() as db:
        row = (await db.execute(select(LaunchToken).where(LaunchToken.token == grant))).scalar_one()
        assert row.status == "used" and row.used_at is not None
