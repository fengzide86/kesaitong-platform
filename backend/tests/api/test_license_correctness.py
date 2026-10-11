"""Regression evidence for issued expiry snapshots and effective license status.

All objects live in the isolated pytest database; no customer credentials or
production data are used. Reads after commits verify the persisted result, not
just a successful HTTP click.
"""

from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from domains.access import effective_license_status, effective_license_status_sql
from domains.auth import AuthService
from domains.platform.dashboard_service import DashboardService
from models import Agency, AuthCode, AuthSeat, Device, Plan, User


async def delivered_license(
    client: AsyncClient, db: AsyncSession, headers: dict, duration: int = 30,
) -> tuple[Plan, dict]:
    agency = Agency(name="授权回归隔离代理")
    plan = Plan(
        name="授权回归隔离套餐", price=Decimal("99.00"), duration_days=duration,
        status="active", product_type="consumer", entitlements='{"max_devices":1,"seat_limit":1}',
    )
    db.add_all([agency, plan])
    await db.commit()
    customer = await client.post(
        "/api/agency/customers", headers=headers,
        json={"name": "隔离测试客户", "agency_id": agency.id},
    )
    assert customer.status_code == 201
    order = await client.post(
        "/api/agency/orders", headers=headers,
        json={"customer_id": customer.json()["data"]["id"], "plan_id": plan.id, "platform_key": "amazon"},
    )
    assert order.status_code == 201
    order_id = order.json()["data"]["id"]
    assert (await client.post(f"/api/agency/orders/{order_id}/mark-paid", headers=headers)).status_code == 200
    delivered = await client.post(f"/api/agency/orders/{order_id}/deliver", headers=headers)
    assert delivered.status_code == 200
    return plan, delivered.json()["data"]


async def verify(client: AsyncClient, code: str) -> dict:
    response = await client.post(
        "/api/auth/verify",
        json={"code": code, "device_id": "license-regression-device", "device_name": "隔离设备"},
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("issued_days,current_days", [(30, 1), (1, 30)])
async def test_activation_keeps_issued_expiry_when_plan_duration_changes(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
    issued_days: int, current_days: int,
) -> None:
    plan, order = await delivered_license(client, db_session, auth_headers, issued_days)
    code = await db_session.get(AuthCode, order["auth_code"]["id"])
    issued_expiry = code.expires_at
    plan.duration_days = current_days
    await db_session.commit()
    first = await verify(client, code.code)
    assert first["success"]
    await db_session.refresh(code)
    assert code.expires_at == issued_expiry
    assert datetime.fromisoformat(first["data"]["expires_at"]) == issued_expiry
    second = await verify(client, code.code)
    assert second["success"]
    await db_session.refresh(code)
    assert code.expires_at == issued_expiry
    assert (await db_session.execute(select(func.count(AuthSeat.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1


async def test_delayed_activation_does_not_restart_the_issued_term(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    _, order = await delivered_license(client, db_session, auth_headers, 30)
    code = await db_session.get(AuthCode, order["auth_code"]["id"])
    # This represents a code issued earlier with only six days now remaining.
    code.expires_at = datetime.now() + timedelta(days=6)
    await db_session.commit()
    issued_expiry = code.expires_at
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.expires_at == issued_expiry


@pytest.mark.parametrize("plan_days", [None, 9])
async def test_legacy_unused_code_without_expiry_gets_its_first_term_once(
    client: AsyncClient, db_session: AsyncSession, plan_days: int | None,
) -> None:
    plan = None
    if plan_days:
        plan = Plan(name="旧码兼容套餐", price=Decimal("1"), duration_days=plan_days, status="active")
        db_session.add(plan)
        await db_session.flush()
    code = AuthCode(code="ISOLATED-LEGACY-NO-EXPIRY", plan_id=plan.id if plan else None, status="unused")
    db_session.add(code)
    await db_session.commit()
    before = datetime.now()
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    expiry = code.expires_at
    assert before + timedelta(days=plan_days or 30) <= expiry <= datetime.now() + timedelta(days=plan_days or 30)
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.expires_at == expiry


async def test_admin_generated_override_and_explicit_extension_are_not_overwritten(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    plan = Plan(name="管理员发码套餐", price=Decimal("10"), duration_days=30, status="active")
    db_session.add(plan)
    await db_session.commit()
    generated = await client.post(
        "/api/auth-codes/batch-generate", headers=auth_headers,
        json={"plan_id": plan.id, "duration_days": 4, "count": 1},
    )
    assert generated.status_code == 200
    code = (await db_session.execute(select(AuthCode).where(AuthCode.code == generated.json()["codes"][0]))).scalar_one()
    generated_expiry = code.expires_at
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.expires_at == generated_expiry
    extended = datetime.now() + timedelta(days=45)
    updated = await client.put(
        f"/api/auth-codes/{code.id}", headers=auth_headers,
        json={"status": "active", "expires_at": extended.isoformat()},
    )
    assert updated.status_code == 200
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.expires_at == extended


async def test_naturally_expired_unused_code_has_one_effective_status_across_reads(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    plan, order = await delivered_license(client, db_session, auth_headers)
    code = await db_session.get(AuthCode, order["auth_code"]["id"])
    code.expires_at = datetime.now() - timedelta(days=1)
    await db_session.commit()
    for state, expected in (("expired", 1), ("pending_activation", 0), ("unused", 0)):
        listing = await client.get(f"/api/agency/licenses?status={state}", headers=auth_headers)
        assert listing.status_code == 200
        assert listing.json()["total"] == expected
    detail = await client.get(f"/api/agency/licenses/{code.id}", headers=auth_headers)
    assert detail.json()["data"]["status"] == "expired"
    order_read = await client.get(f"/api/agency/orders/{order['id']}", headers=auth_headers)
    assert order_read.json()["data"]["auth_code"]["status"] == "expired"
    for path in ("/api/auth-codes", f"/api/auth-codes/{code.id}"):
        response = await client.get(path, headers=auth_headers)
        body = response.json()
        read_code = body["data"][0] if path == "/api/auth-codes" else body
        assert read_code["status"] == "expired"
    center = await client.get("/api/admin/action-center", headers=auth_headers)
    tasks = {task["key"]: task["count"] for task in center.json()["data"]["agency_delivery_tasks"]}
    assert tasks["pending_activation"] == 0
    assert center.json()["data"]["summary"]["expiring_authorizations"] == 0
    stats = await client.get(f"/api/plans/{plan.id}/stats", headers=auth_headers)
    assert stats.json()["data"]["codes"] == {"total": 1, "active": 0, "unused": 0, "expired": 1}
    failed = await verify(client, code.code)
    assert not failed["success"] and "过期" in failed["message"]
    await db_session.refresh(code)
    assert code.status == "unused"  # Read models must not rewrite audit history.
    assert code.user_id is None
    assert (await db_session.execute(select(func.count(AuthSeat.id)))).scalar_one() == 0


async def test_expired_active_license_is_not_counted_as_active_customer_or_plan_usage(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    plan, order = await delivered_license(client, db_session, auth_headers)
    code = await db_session.get(AuthCode, order["auth_code"]["id"])
    assert (await verify(client, code.code))["success"]
    code.expires_at = datetime.now() - timedelta(days=1)
    await db_session.commit()
    dashboard = await client.get("/api/dashboard", headers=auth_headers)
    assert dashboard.json()["data"]["active_codes"] == 0
    users = await client.get("/api/users/stats", headers=auth_headers)
    assert users.json()["data"]["active_users"] == 0
    stats = await client.get(f"/api/plans/{plan.id}/stats", headers=auth_headers)
    assert stats.json()["data"]["codes"] == {"total": 1, "active": 0, "unused": 0, "expired": 1}


@pytest.mark.parametrize("raw_status,expected", [("unused", "expired"), ("active", "expired"), ("expired", "expired"), ("frozen", "frozen"), ("deleted", "deleted")])
async def test_effective_status_keeps_explicit_suspension_and_deletion_priority(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict, raw_status: str, expected: str,
) -> None:
    code = AuthCode(code="ISOLATED-STATE-PRIORITY", status=raw_status, expires_at=datetime.now() - timedelta(days=1))
    db_session.add(code)
    await db_session.commit()
    response = await client.get(f"/api/auth-codes/{code.id}", headers=auth_headers)
    assert response.status_code == 200 and response.json()["status"] == expected
    await db_session.refresh(code)
    assert code.status == raw_status


async def test_auth_service_logs_use_object_id_not_complete_authorization_code(
    db_session: AsyncSession,
) -> None:
    code = AuthCode(code="ISOLATED-SECRET-LICENSE-TEXT", status="unused")
    db_session.add(code)
    await db_session.commit()
    with patch("domains.auth.service.logger") as logger:
        result = await AuthService(db_session).verify_auth_code(code.code, "isolated-device", "隔离设备")
    assert result["success"]
    assert code.code not in str(logger.mock_calls)
    assert str(code.id) in str(logger.mock_calls)


async def test_delivery_uses_order_snapshot_if_plan_changes_before_code_issuance(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    agency = Agency(name="延迟发码代理")
    plan = Plan(name="延迟发码套餐", price=Decimal("10"), duration_days=30, status="active")
    db_session.add_all([agency, plan])
    await db_session.commit()
    customer = (await client.post("/api/agency/customers", headers=auth_headers, json={"name": "隔离延迟交付", "agency_id": agency.id})).json()["data"]
    order = (await client.post("/api/agency/orders", headers=auth_headers, json={"customer_id": customer["id"], "plan_id": plan.id, "platform_key": "amazon"})).json()["data"]
    plan.duration_days = 1
    await db_session.commit()
    await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=auth_headers)
    before = datetime.now()
    delivered = (await client.post(f"/api/agency/orders/{order['id']}/deliver", headers=auth_headers)).json()["data"]
    code = await db_session.get(AuthCode, delivered["auth_code"]["id"])
    issued_expiry = code.expires_at
    assert before + timedelta(days=30) <= issued_expiry <= datetime.now() + timedelta(days=30)
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.expires_at == issued_expiry


async def test_explicit_expired_code_needs_status_and_term_restored_before_reactivation(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    code = AuthCode(code="ISOLATED-EXPIRED-RENEWAL", status="expired", expires_at=datetime.now() - timedelta(days=1))
    db_session.add(code)
    await db_session.commit()
    extended = datetime.now() + timedelta(days=8)
    changed = await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json={"expires_at": extended.isoformat()})
    assert changed.json()["status"] == "expired"
    assert not (await verify(client, code.code))["success"]
    changed = await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json={"status": "unused"})
    assert changed.json()["status"] == "unused"
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.status == "active" and code.expires_at == extended


@pytest.mark.parametrize("offset,expected", [(-1, "expired"), (0, "expired"), (1, "unused")])
async def test_exact_expiry_boundary_matches_python_sql_and_login(
    client: AsyncClient, db_session: AsyncSession, offset: int, expected: str,
) -> None:
    now = datetime(2030, 1, 10, 12, 0, 0)
    code = AuthCode(code="ISOLATED-EXACT-EXPIRY", status="unused", expires_at=now + timedelta(microseconds=offset))
    db_session.add(code)
    await db_session.commit()
    assert effective_license_status(code, now=now) == expected
    sql_status = (await db_session.execute(select(effective_license_status_sql(now=now)).where(AuthCode.id == code.id))).scalar_one()
    assert sql_status == expected
    with patch("domains.access.license_state.datetime") as clock:
        clock.now.return_value = now
        response = await verify(client, code.code)
    assert response["success"] == (expected == "unused")
    if expected == "expired":
        await db_session.refresh(code)
        assert code.status == "unused" and code.user_id is None


async def test_cached_dashboard_rechecks_natural_expiry_without_rewriting_cached_metrics(
    db_session: AsyncSession,
) -> None:
    code = AuthCode(code="ISOLATED-CACHED-EXPIRY", status="active", expires_at=datetime.now() - timedelta(days=1), platform_scope="amazon")
    db_session.add(code)
    await db_session.commit()
    cached = {"success": True, "data": {"active_codes": 1, "total_orders": 7}}
    with patch("domains.platform.dashboard_service.cache.get", new=AsyncMock(return_value=cached)):
        response = await DashboardService(db_session).get_dashboard_stats("amazon")
    assert response["data"] == {"active_codes": 0, "total_orders": 7}
    assert cached["data"]["active_codes"] == 1
    await db_session.refresh(code)
    assert code.status == "active"


async def test_commit_failure_logs_no_bound_code_and_rolls_back_activation(
    db_session: AsyncSession,
) -> None:
    code = AuthCode(code="ISOLATED-COMMIT-SECRET", status="unused")
    db_session.add(code)
    await db_session.commit()
    code_id = code.id
    with patch("domains.auth.service.logger") as logger, patch.object(db_session, "commit", side_effect=RuntimeError("bound value ISOLATED-COMMIT-SECRET")):
        response = await AuthService(db_session).verify_auth_code(code.code, "isolated-device", "隔离设备")
    assert not response["success"]
    assert "ISOLATED-COMMIT-SECRET" not in str(logger.mock_calls)
    assert "RuntimeError" in str(logger.mock_calls)
    persisted = await db_session.get(AuthCode, code_id)
    assert persisted.status == "unused" and persisted.user_id is None
    assert (await db_session.execute(select(func.count(AuthSeat.id)))).scalar_one() == 0


async def test_legacy_device_rebind_keeps_issued_term_and_does_not_log_code_or_device_identity(
    db_session: AsyncSession,
) -> None:
    expiry = datetime.now() + timedelta(days=7)
    code = AuthCode(code="ISOLATED-REBIND-SECRET", status="unused", expires_at=expiry)
    db_session.add(code)
    await db_session.commit()
    service = AuthService(db_session)
    assert (await service.verify_auth_code(code.code, "legacy-private-id", "legacy-private-name"))["success"]
    user_id = code.user_id
    with patch("domains.auth.service.logger") as logger:
        response = await service.verify_auth_code(code.code, "replacement-private-id", "legacy-private-name")
    assert response["success"]
    await db_session.refresh(code)
    assert code.expires_at == expiry and code.user_id == user_id
    assert code.device_id == "replacement-private-id"
    assert (await db_session.execute(select(func.count(AuthSeat.id)))).scalar_one() == 1
    for private_text in (code.code, "legacy-private-id", "replacement-private-id", "legacy-private-name"):
        assert private_text not in str(logger.mock_calls)


async def test_natural_expiry_extension_restores_original_unused_state_without_activation(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
) -> None:
    code = AuthCode(code="ISOLATED-NATURAL-EXTENSION", status="unused", expires_at=datetime.now() - timedelta(days=1))
    db_session.add(code)
    await db_session.commit()
    extended = datetime.now() + timedelta(days=7)
    changed = await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json={"expires_at": extended.isoformat()})
    assert changed.json()["status"] == "unused"
    await db_session.refresh(code)
    assert code.status == "unused" and code.user_id is None
    assert (await verify(client, code.code))["success"]
    await db_session.refresh(code)
    assert code.status == "active" and code.expires_at == extended


@pytest.mark.parametrize("stored_status,activated", [
    ("unused", False), ("active", True), ("expired", False),
    ("expired", True), ("frozen", False), ("frozen", True),
])
async def test_admin_extension_sequence_keeps_login_identity_and_frozen_state(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict,
    stored_status: str, activated: bool,
) -> None:
    code = AuthCode(code="ISOLATED-ADMIN-EXTENSION", status="unused")
    db_session.add(code)
    await db_session.commit()
    if activated:
        assert (await verify(client, code.code))["success"]
        await db_session.refresh(code)
    original_user_id = code.user_id
    code.status = stored_status
    code.expires_at = datetime.now() - timedelta(days=1)
    await db_session.commit()

    extended = datetime.now() + timedelta(days=7)
    changed = await client.put(
        f"/api/auth-codes/{code.id}", headers=auth_headers,
        json={"expires_at": extended.isoformat()},
    )
    assert changed.status_code == 200
    # Match the actual admin UI: decide from the first write's response,
    # not the stale effective state that opened the extension dialog.
    updated = changed.json()
    if updated["status"] == "expired":
        changed = await client.put(
            f"/api/auth-codes/{code.id}", headers=auth_headers,
            json={"status": "active" if updated["user_id"] else "unused"},
        )
        assert changed.status_code == 200

    await db_session.refresh(code)
    assert code.user_id == original_user_id
    assert code.expires_at == extended
    assert code.status == ("frozen" if stored_status == "frozen" else "active" if activated else "unused")
    result = await verify(client, code.code)
    if stored_status == "frozen":
        assert not result["success"]
        assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == int(activated)
        return

    assert result["success"] and result["data"]["user_id"]
    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    if original_user_id:
        assert result["data"]["user_id"] == original_user_id
    profile = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {result['data']['token']}"})
    assert profile.status_code == 200 and profile.json()["success"]


@pytest.mark.parametrize("activated", [False, True])
async def test_unfreeze_preserves_identity_after_all_devices_are_unbound(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict, activated: bool,
) -> None:
    code = AuthCode(code="ISOLATED-UNFREEZE-IDENTITY", status="unused")
    db_session.add(code)
    await db_session.commit()
    if activated:
        assert (await verify(client, code.code))["success"]
        await db_session.refresh(code)
        device_id = (await db_session.execute(select(Device.id).where(Device.auth_code_id == code.id))).scalar_one()
        unbound = await client.post(
            "/api/devices/unbind", headers=auth_headers,
            params={"device_id": device_id, "reason": "测试全部解绑"},
        )
        assert unbound.status_code == 200
    original_user_id = code.user_id
    frozen = await client.put(f"/api/auth-codes/{code.id}", headers=auth_headers, json={"status": "frozen"})
    assert frozen.status_code == 200
    await db_session.refresh(code, ["devices"])
    detail = (await client.get(f"/api/auth-codes/{code.id}", headers=auth_headers)).json()
    assert detail["seat_used"] == detail["device_used"] == 0 and detail["devices"] == []
    restored_status = "active" if detail["user_id"] else "unused"
    restored = await client.put(
        f"/api/auth-codes/{code.id}", headers=auth_headers, json={"status": restored_status},
    )
    assert restored.status_code == 200
    result = await verify(client, code.code)
    assert result["success"] and result["data"]["user_id"]
    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    if original_user_id:
        assert result["data"]["user_id"] == original_user_id
