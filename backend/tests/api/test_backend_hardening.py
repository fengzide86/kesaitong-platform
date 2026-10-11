"""R01/02/09/10/11: real HTTP boundaries against isolated test data."""

import csv
import io
import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import delete, select

from core.config import settings
from core.csv_export import csv_row
from core.security import create_access_token
from models import (
    AuthCode,
    AuthSeat,
    AutomationBatch,
    Device,
    ExpenseCategory,
    ExpenseRecord,
    LaunchToken,
    Order,
    Plan,
    RunLog,
    Setting,
    StaffRole,
    StaffUser,
    User,
)
from services.staff_service import create_staff_access_token
from tests.api.test_tools import _seed_live_launch_access


@pytest.mark.asyncio
async def test_unbind_does_not_let_old_jwt_rebind_or_consume_grant(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    token, code_id = await _seed_live_launch_access(db_session)
    code = await db_session.get(AuthCode, code_id)
    code.max_devices = code.seat_limit = 2
    user_id, code_text = code.user_id, code.code
    db_session.add_all([
        Device(auth_code_id=code_id, device_id="keep-device", device_name="Keep"),
        AuthSeat(auth_code_id=code_id, user_id=user_id, device_id="keep-device", status="active"),
    ])
    await db_session.commit()
    headers = {"Authorization": f"Bearer {token}"}
    grant = (await client.post("/api/tools/live_tool/launch-grant", headers=headers, params={"platform_key": "amazon"})).json()["data"]["token"]
    removed_id = await db_session.scalar(select(Device.id).where(Device.device_id == "device-live"))
    keep = create_access_token({"user_id": user_id, "device_id": "keep-device"})
    unbound = await client.post("/api/devices/user-unbind", params={"device_id": removed_id}, headers={"Authorization": f"Bearer {keep}"})
    assert unbound.status_code == 200
    revoked = await db_session.scalar(select(LaunchToken.status).where(LaunchToken.token == grant))
    assert revoked == "revoked"
    assert not (await client.post("/api/tools/live_tool/launch-grant", headers=headers, params={"platform_key": "amazon"})).json()["success"]
    assert not (await client.post("/api/tools/launch-grant/verify", json={"token": grant})).json()["success"]
    assert await db_session.scalar(select(Device.id).where(Device.device_id == "device-live")) is None
    assert await db_session.scalar(select(AuthSeat.status).where(AuthSeat.device_id == "device-live")) == "inactive"
    # Explicit credential login remains the supported re-authorization path.
    relogin = await client.post("/api/auth/verify", json={"code": code_text, "device_id": "device-live", "device_name": "Live test device"})
    assert relogin.json()["success"]
    fresh_headers = {"Authorization": f"Bearer {relogin.json()['data']['token']}"}
    assert (await client.post("/api/tools/live_tool/launch-grant", headers=fresh_headers, params={"platform_key": "amazon"})).json()["success"]


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["frozen", "deleted", "expired", "user_disabled", "seat_inactive", "device_removed", "platform_removed", "tool_removed", "tool_unready"])
async def test_pending_grant_rechecks_live_access_not_only_ttl(client, db_session, monkeypatch, change):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    token, code_id = await _seed_live_launch_access(db_session)
    result = await client.post("/api/tools/live_tool/launch-grant", headers={"Authorization": f"Bearer {token}"}, params={"platform_key": "amazon"})
    grant = result.json()["data"]["token"]
    code = await db_session.get(AuthCode, code_id)
    if change in {"frozen", "deleted"}:
        code.status = change
    elif change == "expired":
        code.expires_at = datetime.now() - timedelta(seconds=1)
    elif change == "user_disabled":
        (await db_session.get(User, code.user_id)).is_active = False
    elif change == "seat_inactive":
        (await db_session.execute(select(AuthSeat))).scalar_one().status = "inactive"
    elif change == "device_removed":
        await db_session.execute(delete(Device))
    elif change == "platform_removed":
        code.platform_scope = "aliexpress"
    else:
        setting = (await db_session.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one()
        tools = json.loads(setting.value)
        if change == "tool_removed":
            tools = []
        else:
            tools[0]["script_status"] = "script_not_ready"
        setting.value = json.dumps(tools)
    await db_session.commit()
    rejected = await client.post("/api/tools/launch-grant/verify", json={"token": grant})
    assert rejected.status_code == 200  # Existing transport envelope remains compatible.
    assert rejected.json()["success"] is False
    assert await db_session.scalar(select(LaunchToken.used_at).where(LaunchToken.token == grant)) is None


@pytest.mark.asyncio
async def test_pending_batch_grant_rechecks_batch_state(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    token, code_id = await _seed_live_launch_access(db_session)
    code = await db_session.get(AuthCode, code_id)
    plan = await db_session.get(Plan, code.plan_id)
    plan.product_type = "business"
    plan.entitlements = json.dumps({"batch_execution": True, "multi_account_workspace": True})
    config = (await db_session.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one()
    tools = json.loads(config.value)
    tools[0]["supports_batch"] = True
    config.value = json.dumps(tools)
    db_session.add(Setting(key="business_workspace_enabled", value="true"))
    batch = AutomationBatch(client_batch_id="grant-batch", auth_code_id=code_id, device_id="device-live", tool_id="live_tool", tool_name="测试", status="running", total_count=1)
    db_session.add(batch)
    await db_session.commit()
    result = await client.post("/api/tools/live_tool/launch-grant", headers={"Authorization": f"Bearer {token}"}, params={"platform_key": "amazon", "execution_mode": "batch", "client_batch_id": "grant-batch", "client_item_id": "row-1", "idempotency_key": "attempt-1"})
    assert result.json()["success"], result.json()
    grant = result.json()["data"]["token"]
    batch.status = "cancelled"
    await db_session.commit()
    assert not (await client.post("/api/tools/launch-grant/verify", json={"token": grant})).json()["success"]


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [StaffRole.SUPER_ADMIN, StaffRole.OPERATOR, StaffRole.SUPPORT])
async def test_staff_logs_not_accidentally_scoped_by_staff_numeric_id(client, db_session, staff_headers_factory, role):
    headers = await staff_headers_factory(role, "log-staff")
    db_session.add_all([RunLog(user_id=9001, tool_name="客户甲工具", status="success"), RunLog(user_id=9002, tool_name="客户乙工具", status="failed")])
    await db_session.commit()
    assert (await client.get("/api/logs", headers=headers)).json()["total"] == 2
    filtered = (await client.get("/api/logs", params={"user_id": 9002}, headers=headers)).json()
    assert filtered["total"] == 1 and filtered["data"][0]["user_id"] == 9002
    assert (await client.get("/api/logs/tools", headers=headers)).json() == ["客户乙工具", "客户甲工具"]
    exported = (await client.get("/api/logs/export", params={"user_id": 9002}, headers=headers)).text
    assert "客户乙工具" in exported and "客户甲工具" not in exported


@pytest.mark.asyncio
async def test_customer_logs_ignore_other_user_filter_and_reset_only_staff_is_blocked(client, db_session):
    user = User(name="viewer")
    staff = StaffUser(username="reset-logs", display_name="reset", password_hash="unused", role=StaffRole.SUPER_ADMIN, status="active", token_version=1, force_password_reset=True)
    db_session.add_all([user, staff])
    await db_session.flush()
    db_session.add_all([RunLog(user_id=user.id, tool_name="mine", status="success"), RunLog(user_id=9999, tool_name="other", status="success")])
    await db_session.commit()
    own = {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}
    staff_header = {"Authorization": f"Bearer {create_staff_access_token(staff)}"}
    for path in ["/api/logs", "/api/logs/tools", "/api/logs/export"]:
        response = await client.get(path, params={"user_id": 9999}, headers=own)
        assert response.status_code == 200 and "other" not in response.text
        assert (await client.get(path, headers=staff_header)).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"count": 0}, {"count": 1001}, {"duration_days": -1}, {"max_devices": 0}, {"seat_limit": -1}, {"scene_type": "unknown"}, {"platform_scope": "amazon,untrusted"}, {"plan_id": -1}])
async def test_generation_rejects_invalid_input_without_writes(client, db_session, auth_headers, payload):
    response = await client.post("/api/auth-codes/batch-generate", headers=auth_headers, json=payload)
    assert response.status_code == 422
    assert (await db_session.execute(select(AuthCode))).scalars().all() == []


@pytest.mark.asyncio
async def test_unknown_and_disabled_plan_cannot_generate_license(client, db_session, auth_headers):
    assert (await client.post("/api/auth-codes/batch-generate", headers=auth_headers, json={"plan_id": 9999})).status_code == 404
    plan = Plan(name="停用", price=1, duration_days=1, status="disabled")
    db_session.add(plan)
    await db_session.commit()
    assert (await client.post("/api/auth-codes/batch-generate", headers=auth_headers, json={"plan_id": plan.id})).status_code == 409
    assert (await db_session.execute(select(AuthCode))).scalars().all() == []


@pytest.mark.asyncio
async def test_existing_business_operations_scene_remains_supported(client, db_session, auth_headers):
    response = await client.post("/api/auth-codes/batch-generate", headers=auth_headers, json={"scene_type": "operations", "duration_days": 30})
    assert response.status_code == 200
    code = (await db_session.execute(select(AuthCode))).scalar_one()
    assert code.scene_type == "operations"


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"status": "arbitrary"}, {"expires_at": "not-a-date"}, {"max_devices": -1}])
async def test_update_rejects_invalid_fields_as_422(client, db_session, auth_headers, payload):
    code = AuthCode(code="INVALID-UPDATE", status="unused")
    db_session.add(code)
    await db_session.commit()
    assert (await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json=payload)).status_code == 422
    await db_session.refresh(code)
    assert code.status == "unused" and code.max_devices == 1 and code.expires_at is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status,bound,expected", [("expired", True, "active"), ("expired", False, "unused"), ("frozen", True, "frozen"), ("unused", False, "unused"), ("active", True, "active")])
async def test_extension_is_single_transaction_and_preserves_freeze(client, db_session, auth_headers, status, bound, expected):
    old_expiry = datetime.now() - timedelta(days=1)
    code = AuthCode(code="EXTEND-ATOMIC", status=status, expires_at=old_expiry)
    db_session.add(code)
    await db_session.flush()
    if bound:
        user = User(name="extend", auth_code_id=code.id)
        db_session.add(user)
        await db_session.flush()
        code.user_id = user.id
    await db_session.commit()
    before = datetime.now()
    response = await client.post(f"/api/auth-codes/{code.id}/extend", headers=auth_headers, json={"days": 30})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == expected
    expiry = datetime.fromisoformat(response.json()["expires_at"])
    assert before + timedelta(days=30) <= expiry <= datetime.now() + timedelta(days=30)
    again = await client.post(f"/api/auth-codes/{code.id}/extend", headers=auth_headers, json={"days": 2})
    assert datetime.fromisoformat(again.json()["expires_at"]) == expiry + timedelta(days=2)


@pytest.mark.asyncio
async def test_deleted_license_cannot_extend_or_resurrect_and_timezone_is_explicit(client, db_session, auth_headers):
    code = AuthCode(code="EXTEND-DELETED", status="deleted")
    db_session.add(code)
    await db_session.commit()
    assert (await client.post(f"/api/auth-codes/{code.id}/extend", headers=auth_headers, json={"days": 3})).status_code == 409
    assert (await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json={"status": "unused"})).status_code == 409
    code.status = "unused"
    await db_session.commit()
    response = await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json={"expires_at": "2030-01-02T03:04:05Z"})
    expected = datetime(2030, 1, 2, 3, 4, 5, tzinfo=UTC).astimezone().replace(tzinfo=None)
    assert datetime.fromisoformat(response.json()["expires_at"]) == expected


def test_shared_csv_encoder_escapes_only_text_and_preserves_quoting():
    values = ["=1+1", "\t @SUM(1)", " -1+2", "+cmd", '中文,"换行\n内容', Decimal("-12.50"), 42]
    assert next(csv.reader(io.StringIO(csv_row(values)))) == ["'=1+1", "'\t @SUM(1)", "' -1+2", "'+cmd", values[4], "-12.50", "42"]


@pytest.mark.asyncio
async def test_log_csv_export_does_not_execute_customer_text(client, db_session, auth_headers):
    db_session.add(RunLog(user_id=888, tool_name="=1+1", detail="\t@formula", status="failed"))
    await db_session.commit()
    response = await client.get("/api/logs/export", headers=auth_headers)
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[1][3] == "'=1+1" and rows[1][7] == "'\t@formula"


@pytest.mark.asyncio
async def test_commerce_csv_exports_share_safe_text_encoding(client, db_session, auth_headers):
    category = ExpenseCategory(code="csv-regression", name="@category")
    db_session.add(category)
    await db_session.flush()
    db_session.add_all([
        Order(order_no="=order", amount=Decimal("12.50"), plan_name_snapshot="+plan", responsible="\t@owner", status="pending"),
        ExpenseRecord(title="=expense", amount=Decimal("12.50"), expense_date=date.today(), category_id=category.id, payee="-payee", note="\r@note"),
    ])
    await db_session.commit()
    orders = list(csv.reader(io.StringIO((await client.get("/api/orders/export", headers=auth_headers)).content.decode("utf-8-sig"))))
    expenses = list(csv.reader(io.StringIO((await client.get("/api/expenses/export", headers=auth_headers)).content.decode("utf-8-sig"))))
    assert orders[1][0:3] == ["'=order", "'+plan", "12.50"]
    assert orders[1][4] == "'\t@owner"
    assert expenses[1][1:5] == ["'=expense", "'@category", "'-payee", "12.50"]
    assert expenses[1][8] == "'\r@note"


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["profit_ratios", "transaction_guard:profit_policy", "transaction_guard:staff_roles"])
async def test_generic_settings_cannot_bypass_versioning_or_transaction_guards(client, db_session, auth_headers, key):
    response = await client.put("/api/settings", headers=auth_headers, json={"key": key, "value": "unvalidated"})
    assert response.status_code == 422
    assert await db_session.scalar(select(Setting.id).where(Setting.key == key)) is None
