from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import OperationalError

from core.exceptions import ConflictException
from core.transaction_locks import acquire_transaction_guard


def session_with_errors(*errors):
    return SimpleNamespace(
        get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name="mysql")),
        new=set(), dirty=set(), deleted=set(),
        execute=AsyncMock(side_effect=[*errors, None]), rollback=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_guard_deadlock_retries_only_before_any_business_write():
    deadlock = OperationalError("probe", {}, Exception(1213, "deadlock"))
    db = session_with_errors(deadlock)
    await acquire_transaction_guard(db, "profit_policy")
    assert db.execute.await_count == 2
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_guard_deadlock_retries_are_bounded_and_end_with_conflict():
    deadlock = OperationalError("probe", {}, Exception(1213, "deadlock"))
    db = session_with_errors(deadlock, deadlock, deadlock)
    with pytest.raises(ConflictException):
        await acquire_transaction_guard(db, "profit_policy")
    assert db.execute.await_count == db.rollback.await_count == 3


@pytest.mark.asyncio
async def test_guard_does_not_retry_unknown_database_errors_or_pending_changes():
    unrelated = OperationalError("probe", {}, Exception(2006, "connection lost"))
    db = session_with_errors(unrelated)
    with pytest.raises(OperationalError):
        await acquire_transaction_guard(db, "profit_policy")
    db.rollback.assert_not_awaited()
    db = session_with_errors()
    db.dirty = {object()}
    with pytest.raises(RuntimeError, match="before business mutations"):
        await acquire_transaction_guard(db, "profit_policy")
    db.execute.assert_not_awaited()
