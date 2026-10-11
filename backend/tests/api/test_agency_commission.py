from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from core.security import hash_password
from models import Agency, AgencyCommissionEntry, Order, Plan, StaffUser
from services.staff_service import create_staff_access_token
from tests.api.test_agency_workspace import customer_and_order


@pytest.fixture
async def agency_setup(db_session, auth_headers):
    agencies = [Agency(name="佣金甲"), Agency(name="佣金乙")]
    db_session.add_all(agencies)
    await db_session.flush()
    staff = [StaffUser(username=f"commission{index}", display_name=f"佣金代理{index}", password_hash=hash_password("Test-commission-123"), role="agent", agency_id=agency.id, token_version=1, status="active", force_password_reset=False) for index, agency in enumerate(agencies)]
    plan = Plan(name="佣金测试套餐", price=Decimal("99.00"), duration_days=30, status="active", product_type="consumer", entitlements='{"max_devices":2,"seat_limit":2}')
    db_session.add_all([*staff, plan])
    await db_session.commit()
    return {"owner": auth_headers, "a": {"Authorization": f"Bearer {create_staff_access_token(staff[0])}"}, "b": {"Authorization": f"Bearer {create_staff_access_token(staff[1])}"}, "agencies": agencies, "staff": staff, "plan": plan}


@pytest.mark.asyncio
async def test_commission_is_opt_in_snapshot_and_refund_is_negative(client, agency_setup):
    setup = agency_setup
    agency_id = setup["agencies"][0].id
    policy = await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["owner"], json={"rate": "0.100000", "expected_rate": None})
    assert policy.status_code == 200, policy.text
    customer, order = await customer_and_order(client, setup)
    assert (await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    summary = (await client.get(f"/api/agency/agencies/{agency_id}/commission-summary", headers=setup["owner"])).json()["data"]
    assert summary["accrued_amount"] == "9.90" and summary["pending_amount"] == "9.90"
    # Editing the policy does not rewrite the order snapshot.
    assert (await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["owner"], json={"rate": "0.200000", "expected_rate": "0.100000"})).status_code == 200
    entries = (await client.get(f"/api/agency/agencies/{agency_id}/commissions", headers=setup["owner"])).json()
    assert entries["data"][0]["rate_snapshot"] == "0.100000"
    assert (await client.post(f"/api/orders/{order['id']}/refund", headers=setup["owner"], json={"reason": "线下已退款"})).status_code == 200
    entries = (await client.get(f"/api/agency/agencies/{agency_id}/commissions", headers=setup["owner"])).json()["data"]
    assert {row["kind"] for row in entries} == {"accrual", "refund"}
    assert "-9.90" in {row["amount"] for row in entries}


@pytest.mark.asyncio
async def test_monthly_settlement_is_single_use_and_revision_guarded(client, agency_setup):
    setup = agency_setup
    agency_id = setup["agencies"][0].id
    assert (await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["owner"], json={"rate": "0.100000", "expected_rate": None})).status_code == 200
    _, order = await customer_and_order(client, setup)
    await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=setup["owner"])
    month = datetime.now(UTC).strftime("%Y-%m")
    preview = (await client.get(f"/api/agency/agencies/{agency_id}/commission-settlement-preview?month={month}", headers=setup["owner"])).json()["data"]
    assert preview["amount"] == "9.90" and preview["count"] == 1
    response = await client.post(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=setup["owner"], json={"month": month, "expected_revision": preview["revision"], "note": "已线下结算"})
    assert response.status_code == 201, response.text
    assert (await client.post(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=setup["owner"], json={"month": month, "expected_revision": preview["revision"], "note": "重复"})).status_code == 409
    assert (await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["owner"], json={"rate": "0.200000", "expected_rate": "0.100000"})).status_code == 200
    _, second = await customer_and_order(client, setup)
    await client.post(f"/api/agency/orders/{second['id']}/mark-paid", headers=setup["owner"])
    stale = await client.post(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=setup["owner"], json={"month": month, "expected_revision": preview["revision"], "note": "旧版本"})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_agent_can_read_only_own_commission_and_cannot_settle(client, agency_setup):
    setup = agency_setup
    agency_id = setup["agencies"][0].id
    assert (await client.get(f"/api/agency/agencies/{agency_id}/commission-summary", headers=setup["a"])).status_code == 200
    assert (await client.get(f"/api/agency/agencies/{agency_id}/commissions", headers=setup["a"])).status_code == 200
    assert (await client.get(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=setup["a"])).status_code == 200
    assert (await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["a"], json={"rate": "0.100000", "expected_rate": None})).status_code == 403
    assert (await client.get(f"/api/agency/agencies/{setup['agencies'][1].id}/commission-summary", headers=setup["a"])).status_code == 403
    assert (await client.get(f"/api/agency/agencies/{setup['agencies'][1].id}/commissions", headers=setup["a"])).status_code == 403


async def enable_commission(client, setup, rate="0.100000"):
    agency_id = setup["agencies"][0].id
    response = await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["owner"], json={"rate": rate, "expected_rate": None})
    assert response.status_code == 200, response.text
    return agency_id


async def set_entry_month(db_session, order_id, kind, month):
    row = (await db_session.execute(select(AgencyCommissionEntry).where(AgencyCommissionEntry.order_id == order_id, AgencyCommissionEntry.kind == kind))).scalar_one()
    row.occurred_at = datetime.fromisoformat(f"{month}-15T12:00:00")
    await db_session.commit()
    return row


async def preview_month(client, setup, agency_id, month):
    response = await client.get(f"/api/agency/agencies/{agency_id}/commission-settlement-preview", headers=setup["owner"], params={"month": month})
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def confirm_month(client, setup, agency_id, preview):
    return await client.post(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=setup["owner"], json={"month": preview["month"], "expected_revision": preview["revision"], "note": "已核对线下结算凭证"})


@pytest.mark.asyncio
async def test_enabling_commission_does_not_backfill_paid_orders(client, agency_setup):
    setup = agency_setup
    _, historic = await customer_and_order(client, setup)
    paid_url = f"/api/agency/orders/{historic['id']}/mark-paid"
    assert (await client.post(paid_url, headers=setup["owner"])).status_code == 200
    agency_id = await enable_commission(client, setup)
    # A retry after opt-in must not manufacture an accrual for the old payment.
    assert (await client.post(paid_url, headers=setup["owner"])).status_code == 200
    assert (await client.post(f"/api/orders/{historic['id']}/refund", headers=setup["owner"], json={"reason": "退回启用前收款"})).status_code == 200
    rows = (await client.get(f"/api/agency/agencies/{agency_id}/commissions", headers=setup["owner"])).json()
    assert rows["total"] == 0


@pytest.mark.asyncio
async def test_commission_uses_confirmed_amount_not_plan_price(client, agency_setup, db_session):
    setup = agency_setup
    agency_id = await enable_commission(client, setup)
    _, order = await customer_and_order(client, setup)
    stored = await db_session.get(Order, order["id"])
    stored.amount = Decimal("123.45")
    await db_session.commit()
    assert (await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    row = (await client.get(f"/api/agency/agencies/{agency_id}/commissions", headers=setup["owner"])).json()["data"][0]
    assert row["order_amount_snapshot"] == "123.45"
    assert row["amount"] == "12.35"


@pytest.mark.asyncio
async def test_negative_refund_carries_forward_until_positive_month(client, agency_setup, db_session):
    setup = agency_setup
    agency_id = await enable_commission(client, setup)
    _, first = await customer_and_order(client, setup)
    assert (await client.post(f"/api/agency/orders/{first['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    await set_entry_month(db_session, first["id"], "accrual", "2020-01")
    january = await preview_month(client, setup, agency_id, "2020-01")
    assert (await confirm_month(client, setup, agency_id, january)).status_code == 201
    assert (await client.post(f"/api/orders/{first['id']}/refund", headers=setup["owner"], json={"reason": "结算后退款"})).status_code == 200
    refund = await set_entry_month(db_session, first["id"], "refund", "2020-02")
    february = await preview_month(client, setup, agency_id, "2020-02")
    assert february["amount"] == "0.00" and february["count"] == 1
    assert (await confirm_month(client, setup, agency_id, february)).status_code == 409
    assert refund.settlement_id is None
    assert (await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=setup["owner"], json={"rate": "0.200000", "expected_rate": "0.100000"})).status_code == 200
    _, second = await customer_and_order(client, setup)
    assert (await client.post(f"/api/agency/orders/{second['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    await set_entry_month(db_session, second["id"], "accrual", "2020-03")
    march = await preview_month(client, setup, agency_id, "2020-03")
    assert march["amount"] == "9.90" and march["count"] == 2
    response = await confirm_month(client, setup, agency_id, march)
    assert response.status_code == 201, response.text
    summary = (await client.get(f"/api/agency/agencies/{agency_id}/commission-summary", headers=setup["owner"])).json()["data"]
    assert summary == {"pending_amount": "0.00", "settled_amount": "19.80", "accrued_amount": "29.70", "refunded_amount": "-9.90"}


@pytest.mark.asyncio
async def test_historical_preview_excludes_later_refunds(client, agency_setup, db_session):
    setup = agency_setup
    agency_id = await enable_commission(client, setup)
    _, order = await customer_and_order(client, setup)
    assert (await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    await set_entry_month(db_session, order["id"], "accrual", "2020-01")
    assert (await client.post(f"/api/orders/{order['id']}/refund", headers=setup["owner"], json={"reason": "次月退款"})).status_code == 200
    await set_entry_month(db_session, order["id"], "refund", "2020-02")
    january = await preview_month(client, setup, agency_id, "2020-01")
    february = await preview_month(client, setup, agency_id, "2020-02")
    assert january["amount"] == "9.90" and january["count"] == 1
    assert february["amount"] == "0.00" and february["count"] == 2


@pytest.mark.asyncio
async def test_new_ledger_entry_invalidates_unconfirmed_preview(client, agency_setup):
    setup = agency_setup
    agency_id = await enable_commission(client, setup)
    month = datetime.now(UTC).strftime("%Y-%m")
    stale = await preview_month(client, setup, agency_id, month)
    _, order = await customer_and_order(client, setup)
    assert (await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    response = await confirm_month(client, setup, agency_id, stale)
    assert response.status_code == 409 and "重新预览" in response.text
    fresh = await preview_month(client, setup, agency_id, month)
    assert (await confirm_month(client, setup, agency_id, fresh)).status_code == 201


@pytest.mark.asyncio
@pytest.mark.parametrize("month", ["invalid", "2020-00", "2020-13", "2020-1", "0000-01", "9999-12"])
async def test_invalid_or_future_settlement_month_is_422(client, agency_setup, month):
    setup = agency_setup
    agency_id = setup["agencies"][0].id
    preview = await client.get(f"/api/agency/agencies/{agency_id}/commission-settlement-preview", headers=setup["owner"], params={"month": month})
    assert preview.status_code == 422, preview.text
    confirm = await client.post(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=setup["owner"], json={"month": month, "expected_revision": "a" * 64, "note": "无效月份"})
    assert confirm.status_code == 422, confirm.text


@pytest.mark.asyncio
async def test_commission_mutations_and_preview_require_owner(client, agency_setup, staff_headers_factory):
    setup = agency_setup
    agency_id = setup["agencies"][0].id
    month = datetime.now(UTC).strftime("%Y-%m")
    for headers in [setup["a"], await staff_headers_factory("operator", "commission-operator"), await staff_headers_factory("support", "commission-support")]:
        assert (await client.get(f"/api/agency/agencies/{agency_id}/commission-settlement-preview", headers=headers, params={"month": month})).status_code == 403
        assert (await client.post(f"/api/agency/agencies/{agency_id}/commission-settlements", headers=headers, json={"month": month, "expected_revision": "a" * 64, "note": "越权确认"})).status_code == 403
        assert (await client.put(f"/api/agency/agencies/{agency_id}/commission-policy", headers=headers, json={"rate": "0.1", "expected_rate": None})).status_code == 403


@pytest.mark.asyncio
async def test_refund_after_customer_transfer_reverses_original_agency(client, agency_setup):
    setup = agency_setup
    agency_id = await enable_commission(client, setup)
    customer, order = await customer_and_order(client, setup)
    assert (await client.post(f"/api/agency/orders/{order['id']}/mark-paid", headers=setup["owner"])).status_code == 200
    assert (await client.patch(f"/api/agency/customers/{customer['id']}", headers=setup["owner"], json={"agency_id": setup["agencies"][1].id})).status_code == 200
    assert (await client.post(f"/api/orders/{order['id']}/refund", headers=setup["owner"], json={"reason": "转移后退款"})).status_code == 200
    rows = (await client.get(f"/api/agency/agencies/{agency_id}/commissions", headers=setup["owner"])).json()["data"]
    assert {(row["kind"], row["amount"]) for row in rows} == {("accrual", "9.90"), ("refund", "-9.90")}
