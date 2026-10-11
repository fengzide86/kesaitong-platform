"""Persist live batch summaries with the same autoflush policy as production."""
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from domains.automation import business_service as service
from models import AuthCode, AutomationBatch, AutomationBatchItem, Plan
from schemas.business import BatchFinish, BatchItemUpdate, BatchUpdate


@pytest.fixture
async def live_batch(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> tuple[int, dict[str, Any]]:
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    db_session.autoflush = False
    plan = Plan(name="计数回归套餐", price=100, duration_days=30, product_type="business")
    db_session.add(plan)
    await db_session.flush()
    code = AuthCode(code="COUNTER-REGRESSION", plan_id=plan.id)
    db_session.add(code)
    await db_session.flush()
    batch = AutomationBatch(
        client_batch_id="counter-regression-batch", auth_code_id=code.id,
        device_id="counter-device", tool_id="counter-tool", tool_name="计数测试",
        total_count=2, pending_count=2,
    )
    db_session.add(batch)
    await db_session.commit()
    return batch.id, {"auth_code_id": code.id, "device_id": "counter-device"}


@pytest.mark.asyncio
async def test_foreign_device_has_summary_but_no_detail_or_write(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    other_device = {**context, "device_id": "another-device"}
    own = await service.list_batches(db_session, context, limit=20)
    foreign = await service.list_batches(db_session, other_device, limit=20)
    assert own[0]["detail_accessible"] is True
    assert foreign[0]["detail_accessible"] is False
    assert "device_id" not in foreign[0]
    assert "items" not in foreign[0]
    with pytest.raises(HTTPException) as detail:
        await service.get_batch(db_session, batch_id, other_device)
    assert detail.value.status_code == 404
    with pytest.raises(HTTPException) as write:
        await service.finish_batch(db_session, batch_id, BatchFinish(status="cancelled"), other_device)
    assert write.value.status_code == 404
    assert await service.list_batches(db_session, {"auth_code_id": -1}, limit=20) == []


@pytest.mark.asyncio
async def test_recount_includes_pending_writes_and_unreported_items(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    running = BatchItemUpdate(account_label_masked="客户", status="running")
    await service.upsert_batch_item(db_session, batch_id, " first ", running, context)
    batch = await service.get_batch(db_session, batch_id, context)
    assert (batch["pending_count"], batch["running_count"], batch["completed_count"]) == (1, 1, 0)
    assert batch["items"][0]["client_item_id"] == "first"
    assert batch["items"][0]["started_at"]

    # Heartbeat claims cannot replace persisted child state.
    batch = await service.update_batch(db_session, batch_id, BatchUpdate(completed_count=2), context)
    assert (batch["pending_count"], batch["running_count"], batch["completed_count"]) == (1, 1, 0)
    with pytest.raises(HTTPException) as early_finish:
        await service.finish_batch(db_session, batch_id, BatchFinish(status="completed"), context)
    assert early_finish.value.status_code == 409
    with pytest.raises(HTTPException) as early_update:
        await service.update_batch(db_session, batch_id, BatchUpdate(status="completed", completed_count=2), context)
    assert early_update.value.status_code == 409

    waiting = BatchItemUpdate(account_label_masked="客户", status="waiting_user", intervention_type="captcha")
    item = await service.upsert_batch_item(db_session, batch_id, "first", waiting, context)
    assert item["customer_message"] == "需要完成页面验证码"
    assert (await service.get_batch(db_session, batch_id, context))["waiting_count"] == 1
    completed = BatchItemUpdate(account_label_masked="客户", status="completed")
    for item_id in ["first", "second"]:
        await service.upsert_batch_item(db_session, batch_id, item_id, completed, context)
    batch = await service.finish_batch(db_session, batch_id, BatchFinish(status="completed"), context)
    assert batch["completed_count"] == 2
    assert batch["pending_count"] == batch["running_count"] == batch["waiting_count"] == 0
    assert batch["status"] == "completed"


@pytest.mark.asyncio
async def test_history_offset_is_stable_and_remains_authorization_scoped(db_session: AsyncSession, live_batch) -> None:
    _, context = live_batch
    for index in range(4):
        db_session.add(AutomationBatch(
            client_batch_id=f"history-page-{index}", auth_code_id=context["auth_code_id"],
            device_id="counter-device", tool_id="counter-tool", tool_name="分页测试",
            total_count=1, pending_count=1,
        ))
    await db_session.commit()
    first = await service.list_batches(db_session, context, limit=2)
    second = await service.list_batches(db_session, context, limit=2, offset=2)
    third = await service.list_batches(db_session, context, limit=2, offset=4)
    assert [len(first), len(second), len(third)] == [2, 2, 1]
    assert len({item["id"] for item in first + second + third}) == 5
    assert await service.list_batches(db_session, {"auth_code_id": -1}, limit=20) == []


@pytest.mark.asyncio
async def test_rejects_bad_counters_ids_and_extra_items(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    with pytest.raises(HTTPException) as invalid_count:
        await service.update_batch(db_session, batch_id, BatchUpdate(pending_count=3), context)
    assert invalid_count.value.status_code == 422
    item = BatchItemUpdate(account_label_masked="客户", status="completed")
    for item_id in [" ", "x" * 101]:
        with pytest.raises(HTTPException) as invalid_id:
            await service.upsert_batch_item(db_session, batch_id, item_id, item, context)
        assert invalid_id.value.status_code == 422
    # Before child reports exist a correctly summed heartbeat remains valid.
    batch = await service.update_batch(db_session, batch_id, BatchUpdate(pending_count=1, running_count=1), context)
    assert batch["running_count"] == 1
    for item_id in ["one", "two"]:
        await service.upsert_batch_item(db_session, batch_id, item_id, item, context)
    with pytest.raises(HTTPException) as extra_item:
        await service.upsert_batch_item(db_session, batch_id, "three", item, context)
    assert extra_item.value.status_code == 409
    assert await db_session.scalar(select(func.count(AutomationBatchItem.id)).where(AutomationBatchItem.batch_id == batch_id)) == 2
    batch = await service.update_batch(db_session, batch_id, BatchUpdate(status="completed", completed_count=2), context)
    assert batch["status"] == "completed"


@pytest.mark.asyncio
async def test_cancelled_and_failed_children_remain_terminal(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    for item_id, status in [("one", "cancelled"), ("two", "failed")]:
        await service.upsert_batch_item(db_session, batch_id, item_id, BatchItemUpdate(account_label_masked="客户", status=status), context)
    batch = await service.finish_batch(db_session, batch_id, BatchFinish(status="completed"), context)
    assert batch["failed_count"] == 2
    assert batch["completed_count"] == 0


@pytest.mark.asyncio
async def test_cancelled_items_do_not_make_legacy_summary_fail(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    for item_id, status in [("one", "completed"), ("two", "cancelled")]:
        await service.upsert_batch_item(
            db_session, batch_id, item_id,
            BatchItemUpdate(account_label_masked="客户", status=status), context,
        )
    # Electron's existing summary has no cancelled field and does not add
    # cancelled items to failed. Its terminal summary legitimately sums to
    # less than total_count; persisted child rows still provide exact counts.
    batch = await service.update_batch(
        db_session, batch_id, BatchUpdate(status="completed", completed_count=1), context,
    )
    assert batch["status"] == "completed"
    assert batch["completed_count"] == batch["failed_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal_status", ["completed", "cancelled", "interrupted"])
async def test_terminal_batch_ignores_late_heartbeats_and_item_mutations(
    db_session: AsyncSession, live_batch, terminal_status: str,
) -> None:
    batch_id, context = live_batch
    for item_id in ("one", "two"):
        await service.upsert_batch_item(
            db_session, batch_id, item_id,
            BatchItemUpdate(account_label_masked="客户", status="completed"), context,
        )
    await service.finish_batch(db_session, batch_id, BatchFinish(status=terminal_status), context)
    original = await service.get_batch(db_session, batch_id, context)
    await service.update_batch(
        db_session, batch_id, BatchUpdate(status="running", pending_count=1, running_count=1), context,
    )
    await service.upsert_batch_item(
        db_session, batch_id, "one",
        BatchItemUpdate(account_label_masked="被修改的名字", status="running"), context,
    )
    await service.finish_batch(db_session, batch_id, BatchFinish(status="cancelled"), context)
    assert await service.get_batch(db_session, batch_id, context) == original


@pytest.mark.asyncio
async def test_terminal_batch_cannot_gain_a_late_new_item(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    await service.finish_batch(db_session, batch_id, BatchFinish(status="cancelled"), context)
    before = await service.get_batch(db_session, batch_id, context)
    with pytest.raises(HTTPException) as conflict:
        await service.upsert_batch_item(
            db_session, batch_id, "late-new-row",
            BatchItemUpdate(account_label_masked="客户", status="completed"), context,
        )
    assert conflict.value.status_code == 409
    assert await service.get_batch(db_session, batch_id, context) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("stale_status", ["pending", "running", "waiting_user", "failed", "cancelled"])
async def test_completed_item_is_monotonic_while_other_rows_are_running(db_session: AsyncSession, live_batch, stale_status: str) -> None:
    batch_id, context = live_batch
    original = await service.upsert_batch_item(db_session, batch_id, "done", BatchItemUpdate(account_label_masked="客户", status="completed"), context)
    stale = BatchItemUpdate(account_label_masked="迟到覆盖", status=stale_status, intervention_type="captcha" if stale_status == "waiting_user" else None)
    assert await service.upsert_batch_item(db_session, batch_id, "done", stale, context) == original
    batch = await service.get_batch(db_session, batch_id, context)
    assert batch["status"] == "running"
    assert (batch["completed_count"], batch["pending_count"], batch["failed_count"]) == (1, 1, 0)


@pytest.mark.asyncio
async def test_failed_item_can_restart_while_batch_is_active(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    for state in ("running", "failed"):
        result = await service.upsert_batch_item(
            db_session, batch_id, "retry-row", BatchItemUpdate(account_label_masked="客户", status=state), context,
        )
    assert result["completed_at"] is not None
    restarted = await service.upsert_batch_item(
        db_session, batch_id, "retry-row", BatchItemUpdate(account_label_masked="客户", status="pending"), context,
    )
    assert restarted["completed_at"] is None
    assert restarted["started_at"] is None
    batch = await service.get_batch(db_session, batch_id, context)
    assert batch["status"] == "running"
    assert batch["pending_count"] == 2
    assert batch["failed_count"] == 0


@pytest.mark.asyncio
async def test_repeated_terminal_item_snapshot_keeps_its_original_completion_time(db_session: AsyncSession, live_batch) -> None:
    batch_id, context = live_batch
    payload = BatchItemUpdate(account_label_masked="客户", status="completed")
    original = await service.upsert_batch_item(db_session, batch_id, "first", payload, context)
    repeated = await service.upsert_batch_item(db_session, batch_id, "first", payload, context)
    assert repeated["completed_at"] == original["completed_at"]
