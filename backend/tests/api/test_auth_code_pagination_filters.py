"""Full-collection authorization filters agree with rendered effective state."""
from datetime import datetime, timedelta

import pytest

from models import AuthCode, Device, Plan
from tests.conftest import get_data


async def seed_large_collection(db):
    plan = Plan(name="专业套餐", product_type="business", price=99, duration_days=30, status="active")
    db.add(plan)
    await db.flush()
    now = datetime.now()
    target = AuthCode(code="OLDER-NEEDLE-101", status="unused", plan_id=plan.id, platform_scope="amazon", expires_at=now - timedelta(days=1), created_at=now - timedelta(days=30))
    db.add(target)
    db.add_all([AuthCode(code=f"NEWER-{index:03d}", status="active", platform_scope="amazon", expires_at=now + timedelta(days=30), created_at=now) for index in range(105)])
    await db.flush()
    db.add_all([Device(auth_code_id=target.id, device_id=f"needle-device-{index}", device_name="目标旧电脑") for index in range(2)])
    await db.commit()
    return target


@pytest.mark.asyncio
async def test_keyword_finds_authorization_beyond_first_hundred(client, auth_headers, db_session):
    target = await seed_large_collection(db_session)
    original = await client.get("/api/auth-codes", headers=auth_headers)
    assert original.json()["page_size"] == 100
    assert len(get_data(original)) == 100
    assert original.json()["total"] == 106
    assert target.id not in [row["id"] for row in get_data(original)]
    found = await client.get("/api/auth-codes", params={"keyword": "NEEDLE", "page_size": 20}, headers=auth_headers)
    assert found.json()["total"] == 1
    assert [row["id"] for row in get_data(found)] == [target.id]


@pytest.mark.asyncio
async def test_device_search_and_combined_filters_share_total_without_duplicate_rows(client, auth_headers, db_session):
    target = await seed_large_collection(db_session)
    params = {"keyword": "目标旧电脑", "product_type": "business", "status": "expired", "platform_key": "amazon", "page_size": 20}
    found = await client.get("/api/auth-codes", params=params, headers=auth_headers)
    assert found.json()["total"] == 1
    assert [row["id"] for row in get_data(found)] == [target.id]
    assert get_data(found)[0]["status"] == "expired"
    second = await client.get("/api/auth-codes", params={**params, "page": 2}, headers=auth_headers)
    assert second.json()["total"] == 1
    assert get_data(second) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status,expected", [
    ("expired", {"expired-unused", "expired-active", "explicit-expired"}),
    ("unused", {"future-unused"}), ("active", {"future-active"}),
    ("frozen", {"frozen-past"}),
])
async def test_status_filter_uses_same_effective_state_as_detail(client, auth_headers, db_session, status, expected):
    now = datetime.now()
    db_session.add_all([
        AuthCode(code="expired-unused", status="unused", expires_at=now - timedelta(days=1)),
        AuthCode(code="expired-active", status="active", expires_at=now - timedelta(days=1)),
        AuthCode(code="explicit-expired", status="expired", expires_at=None),
        AuthCode(code="future-unused", status="unused", expires_at=now + timedelta(days=1)),
        AuthCode(code="future-active", status="active", expires_at=now + timedelta(days=1)),
        AuthCode(code="frozen-past", status="frozen", expires_at=now - timedelta(days=1)),
        AuthCode(code="deleted-past", status="deleted", expires_at=now - timedelta(days=1)),
    ])
    await db_session.commit()
    response = await client.get("/api/auth-codes", params={"status": status}, headers=auth_headers)
    assert response.json()["total"] == len(expected)
    assert {row["code"] for row in get_data(response)} == expected
    for row in get_data(response):
        detail = await client.get(f"/api/auth-codes/{row['id']}", headers=auth_headers)
        assert detail.json()["status"] == row["status"] == status


@pytest.mark.asyncio
async def test_search_escapes_wildcards_and_pagination_has_stable_tie_breaker(client, auth_headers, db_session):
    now = datetime.now()
    db_session.add_all([AuthCode(code=f"TIED-{index:03d}", status="unused", created_at=now) for index in range(25)])
    db_session.add(AuthCode(code="LITERAL_%_CODE", status="unused", created_at=now))
    await db_session.commit()
    literal = await client.get("/api/auth-codes", params={"keyword": "_%_"}, headers=auth_headers)
    assert literal.json()["total"] == 1
    assert get_data(literal)[0]["code"] == "LITERAL_%_CODE"
    first = await client.get("/api/auth-codes", params={"page_size": 20}, headers=auth_headers)
    second = await client.get("/api/auth-codes", params={"page": 2, "page_size": 20}, headers=auth_headers)
    ids = [row["id"] for row in get_data(first) + get_data(second)]
    assert len(ids) == len(set(ids)) == 26
    assert ids == sorted(ids, reverse=True)
