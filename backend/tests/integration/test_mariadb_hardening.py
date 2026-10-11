"""R26/R29 HTTP races with real InnoDB transactions and independent sessions."""

import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.exceptions import register_exception_handlers
from database import Base, get_db
from models import AuditLog, Setting, StaffRole, StaffUser
from routers import profit, staff
from services import staff_service
from tests.api.test_backend_transaction_guards import (
    test_profit_optimistic_conflict_returns_409_without_duplicate_version,
    test_profit_versions_and_audits_serialize_on_first_and_later_updates,
    test_two_admins_cannot_concurrently_remove_each_other,
)
from tests.integration.test_mariadb_order_concurrency import _mariadb_test_url

__all__ = [
    "test_profit_optimistic_conflict_returns_409_without_duplicate_version",
    "test_profit_versions_and_audits_serialize_on_first_and_later_updates",
    "test_two_admins_cannot_concurrently_remove_each_other",
]


@pytest_asyncio.fixture
async def isolated_http():
    # Match the production InnoDB default, not just READ COMMITTED. The request
    # dependencies establish snapshots before the transaction guard is acquired.
    engine = create_async_engine(_mariadb_test_url(), pool_size=5, max_overflow=0,
                                 isolation_level="REPEATABLE READ", pool_pre_ping=True)
    sessions = async_sessionmaker(engine, class_=AsyncSession, autoflush=False, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:10]
    ids = []
    keys = ["profit_ratios", "transaction_guard:profit_policy", "transaction_guard:staff_roles"]
    baseline = []
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(staff.router, prefix="/api/staff")
    app.include_router(profit.router, prefix="/api/profit")

    async def test_db():
        async with sessions() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = test_db
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            if (await db.execute(select(StaffUser.id).limit(1))).scalar_one_or_none() is not None:
                pytest.fail("Hardening concurrency fixture requires an empty staff test table")
            baseline = [{"key": row.key, "value": row.value, "description": row.description}
                        for row in (await db.execute(select(Setting).where(Setting.key.in_(keys)))).scalars()]
            if baseline:
                pytest.fail("Hardening concurrency fixture requires isolated policy/guard settings")
            accounts = [StaffUser(username=f"hardening-{suffix}-{i}", display_name=f"Admin {i}",
                                  password_hash="not-a-login-credential", role=StaffRole.SUPER_ADMIN,
                                  status="active", token_version=1, force_password_reset=False) for i in (1, 2)]
            db.add_all(accounts)
            await db.commit()
            ids = [row.id for row in accounts]
            headers = [{"Authorization": f"Bearer {staff_service.create_staff_access_token(row)}"}
                       for row in accounts]
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://isolated.test") as client:
            yield client, sessions, ids, headers
    finally:
        if ids:
            async with sessions() as db:
                await db.execute(delete(AuditLog).where(AuditLog.user_id.in_(ids)))
                await db.execute(delete(StaffUser).where(StaffUser.id.in_(ids)))
                await db.execute(delete(Setting).where(Setting.key.in_(keys)))
                await db.commit()
        await engine.dispose()
