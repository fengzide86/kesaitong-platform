import json
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.security import create_access_token
from domains.automation import service as execution_service
from domains.automation.schemas import ExecutionReconcileRequest
from models import AuthCode, LaunchToken, Setting, User
from models.feedback import ExecutionVerification, RunLog
from tests.conftest import get_data


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("grant_status", "expiry_minutes"), [("reported", 5), ("revoked", 5), ("expired", 5), ("pending", -1)],
)
async def test_verify_does_not_consume_terminal_or_expired_grants(
    client, db_session, monkeypatch, grant_status, expiry_minutes,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    token_value = f"invalid-grant-{grant_status}"
    launch = LaunchToken(
        token=token_value, user_id=999, auth_code_id=999, platform_key="amazon",
        tool_id="audit-tool", script_key="audit-tool.v1", device_id="test-device",
        expires_at=datetime.now() + timedelta(minutes=expiry_minutes),
        status=grant_status, execution_mode="single",
    )
    db_session.add(launch)
    await db_session.commit()
    response = await client.post("/api/tools/launch-grant/verify", params={"token": token_value})
    assert response.status_code == 200
    assert response.json()["success"] is False
    await db_session.refresh(launch)
    assert launch.status == ("expired" if grant_status == "pending" and expiry_minutes < 0 else grant_status)
    assert launch.used_at is None


@pytest.mark.asyncio
@pytest.mark.parametrize("expiry_minutes", [-1, 5])
async def test_consumed_single_launch_grant_creates_one_verified_execution(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    expiry_minutes: int,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    auth_code = AuthCode(code="REPORT-LIVE-001", status="active")
    db_session.add(auth_code)
    await db_session.flush()
    user = User(name="Runner Report User", auth_code_id=auth_code.id, device_id="device-report")
    db_session.add(user)
    await db_session.flush()
    user_id = user.id
    tool_config_value = json.dumps([{
            "id": "tool_listing_script",
            "name": "自动上品脚本",
            "module": "上品脚本",
            "platform_key": "amazon",
            "capability_key": "listing_script",
            "availability": "live",
            "supports_live_single": True,
            "script_key": "amazon.listing_script.v1",
            "target_url": "https://training.idtrade.cn/listing/create",
        }], ensure_ascii=False)
    tool_setting = (await db_session.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one_or_none()
    if tool_setting:
        tool_setting.value = tool_config_value
    else:
        db_session.add(Setting(key="tool_configs", value=tool_config_value))
    launch = LaunchToken(
        token="runner-report-token-1234567890",
        user_id=user.id,
        auth_code_id=auth_code.id,
        platform_key="amazon",
        tool_id="tool_listing_script",
        script_key="amazon.listing_script.v1",
        device_id="device-report",
        expires_at=datetime.now() + timedelta(minutes=expiry_minutes),
        used_at=datetime.now(),
        status="used",
        execution_mode="single",
    )
    db_session.add(launch)
    await db_session.commit()

    payload = {
        "token": launch.token,
        "run_id": "local-run-report-1",
        "status": "succeeded",
        "adapter_version": "1.0.0",
        "page_fingerprint": "a" * 64,
        "page_changed": False,
        "completed_steps": 8,
    }
    response = await client.post("/api/executions/report", json=payload)

    assert response.status_code == 200
    assert get_data(response)["accepted"] is True
    log = (await db_session.execute(select(RunLog).where(RunLog.user_id == user.id))).scalar_one()
    assert log.status == "success"
    assert log.verification_state == ExecutionVerification.VERIFIED
    assert log.tool_id == "tool_listing_script"
    assert "runner-report-token" not in (log.detail or "")

    replay = await client.post(
        "/api/tools/launch-grant/verify", params={"token": launch.token},
    )
    assert replay.status_code == 200
    assert replay.json()["success"] is False
    await db_session.refresh(launch)
    assert launch.status == "reported"

    duplicate = await client.post("/api/executions/report", json=payload)
    assert duplicate.status_code == 200
    assert get_data(duplicate)["duplicate"] is True
    assert get_data(duplicate)["execution_id"] == log.id
    logs = (await db_session.execute(select(RunLog).where(RunLog.user_id == user_id))).scalars().all()
    assert len(logs) == 1

    mismatched = await client.post("/api/executions/report", json={
        **payload,
        "run_id": "local-run-report-different",
    })
    assert mismatched.status_code == 409
    assert "不匹配" in mismatched.json()["message"]


@pytest.mark.asyncio
async def test_reconcile_owned_failed_execution_updates_control_record(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    auth_code = AuthCode(code="REPORT-RECONCILE-001", status="active")
    db_session.add(auth_code)
    await db_session.flush()
    user = User(name="Reconcile User", auth_code_id=auth_code.id, device_id="device-reconcile")
    db_session.add(user)
    await db_session.flush()
    launch = LaunchToken(
        token="runner-reconcile-token-1234567890", user_id=user.id, auth_code_id=auth_code.id,
        platform_key="amazon", tool_id="tool_listing_script", script_key="amazon.listing_script.v1",
        device_id=user.device_id, expires_at=datetime.now() + timedelta(minutes=5), used_at=datetime.now(),
        status="used", execution_mode="single",
    )
    db_session.add(launch)
    await db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token({'user_id': user.id, 'device_id': user.device_id})}"}
    first = await client.post("/api/executions/report", json={
        "token": launch.token, "run_id": "reconcile-run-1", "status": "failed",
        "error_code": "TARGET_RESPONSE_TIMEOUT", "adapter_version": "bjysoft-v2-template.1",
        "page_fingerprint": "a" * 64, "completed_steps": 5,
    })
    assert first.status_code == 200
    reconcile = await client.post("/api/executions/reconcile", headers=headers, json={
        "run_id": "reconcile-run-1", "status": "succeeded",
        "verification": "same-object-list-and-details", "object_ref": "123",
        "adapter_version": "bjysoft-v2-template.1", "page_fingerprint": "b" * 64,
        "completed_steps": 8,
    })
    assert reconcile.status_code == 200
    assert get_data(reconcile)["reconciled"] is True
    log = (await db_session.execute(select(RunLog).where(RunLog.user_id == user.id))).scalar_one()
    assert log.status == "success"
    assert log.error_code is None
    assert json.loads(log.detail or "{}")["object_ref"] == "123"
    repeat = await client.post("/api/executions/reconcile", headers=headers, json={
        "run_id": "reconcile-run-1", "status": "succeeded",
        "verification": "same-object-list-and-details", "object_ref": "123",
        "completed_steps": 8,
    })
    assert repeat.status_code == 200
    assert get_data(repeat)["duplicate"] is True


@pytest.mark.asyncio
async def test_execution_report_rejects_unconsumed_grant(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    launch = LaunchToken(
        token="runner-report-pending-1234567890",
        user_id=999,
        auth_code_id=999,
        platform_key="amazon",
        tool_id="tool_listing_script",
        script_key="amazon.listing_script.v1",
        device_id="device-report",
        expires_at=datetime.now() + timedelta(minutes=5),
        status="pending",
        execution_mode="single",
    )
    db_session.add(launch)
    await db_session.commit()

    response = await client.post("/api/executions/report", json={
        "token": launch.token,
        "run_id": "local-run-report-2",
        "status": "failed",
        "error_code": "PAGE_CHANGED",
        "completed_steps": 2,
    })

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_execution_read_model_only_returns_owned_verified_records(
    db_session: AsyncSession,
):
    owner = User(name="Execution Owner", device_id="execution-owner")
    other = User(name="Other Owner", device_id="execution-other")
    db_session.add_all([owner, other])
    await db_session.flush()
    visible = RunLog(
        user_id=owner.id,
        tool_id="tool-visible",
        tool_name="可见工具",
        status="success",
        verification_state=ExecutionVerification.VERIFIED,
    )
    db_session.add_all([
        visible,
        RunLog(
            user_id=owner.id,
            tool_id="tool-unverified",
            status="success",
            verification_state=ExecutionVerification.LEGACY_UNVERIFIED,
        ),
        RunLog(
            user_id=other.id,
            tool_id="tool-other",
            status="success",
            verification_state=ExecutionVerification.VERIFIED,
        ),
    ])
    await db_session.commit()

    page = await execution_service.list_executions(
        db_session,
        {"user_id": owner.id, "role": "user"},
        page=1,
        page_size=20,
        platform_key=None,
        tool_id=None,
    )

    assert page["total"] == 1
    assert [item["id"] for item in page["data"]] == [visible.id]
    detail = await execution_service.get_execution(db_session, {"user_id": owner.id, "role": "user"}, visible.id)
    assert detail["record_kind"] == "live"
    assert detail["verification"] == "verified"


@pytest.mark.asyncio
@pytest.mark.parametrize("identity", [{"role": "operator", "staff_id": 1}, {"role": "user", "staff_id": 1}, {}])
async def test_staff_identity_cannot_access_same_number_customer_execution(db_session, identity):
    customer = User(name="Numeric identity isolation", device_id="numeric-isolation")
    db_session.add(customer)
    await db_session.flush()
    record = RunLog(user_id=customer.id, tool_id="owned-tool", status="failed",
                    detail=json.dumps({"run_id": "owned-run"}), verification_state=ExecutionVerification.VERIFIED)
    db_session.add(record)
    await db_session.commit()
    actor = {**identity, "user_id": customer.id}
    with pytest.raises(HTTPException) as denied_list:
        await execution_service.list_executions(db_session, actor, page=1, page_size=20, platform_key=None, tool_id=None)
    assert denied_list.value.status_code == 403
    with pytest.raises(HTTPException) as denied_detail:
        await execution_service.get_execution(db_session, actor, record.id)
    assert denied_detail.value.status_code == 403
    request = ExecutionReconcileRequest(run_id="owned-run", status="succeeded",
                                        verification="same-object-list-and-details", object_ref="object-1")
    with pytest.raises(HTTPException) as denied_reconcile:
        await execution_service.reconcile_execution(db_session, actor, request)
    assert denied_reconcile.value.status_code == 403
    await db_session.refresh(record)
    assert record.status == "failed"
