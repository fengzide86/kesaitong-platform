"""Reliable user/license/ticket joins and scoped deep links, without inferred identities."""
from datetime import datetime

import pytest

from models import AuthCode, Feedback, User
from tests.conftest import get_data


async def seed_context(db):
    amazon = AuthCode(code="CONTEXT-AMAZON", platform_scope="amazon", status="active")
    ali = AuthCode(code="CONTEXT-ALI", platform_scope="aliexpress", status="active")
    db.add_all([amazon, ali])
    await db.flush()
    user = User(name="同名客户", device_id="context-a", auth_code_id=amazon.id)
    other = User(name="同名客户", device_id="context-b", auth_code_id=ali.id)
    db.add_all([user, other])
    await db.flush()
    ticket = Feedback(user_id=user.id, title="真实关联", content="详情", platform_key="amazon", status="processing", admin_reply="已回复", replied_at=datetime(2026, 10, 11, 1), screenshot='["/uploads/context.png"]')
    unrelated = Feedback(user_id=other.id, title="同名不同人", content="不可混入", platform_key="aliexpress", status="pending")
    db.add_all([ticket, unrelated])
    await db.commit()
    return amazon, ali, user, other, ticket


@pytest.mark.asyncio
async def test_user_detail_and_reverse_license_join(client, auth_headers, db_session):
    code, _, user, _, _ = await seed_context(db_session)
    detail = get_data(await client.get(f"/api/users/{user.id}", params={"platform_key": "amazon"}, headers=auth_headers))
    assert detail["auth_code_id"] == code.id
    rows = get_data(await client.get("/api/users", params={"auth_code_id": code.id}, headers=auth_headers))
    assert [row["id"] for row in rows] == [user.id]


@pytest.mark.asyncio
async def test_ticket_user_filter_and_real_reply_times(client, auth_headers, db_session):
    _, _, user, _, ticket = await seed_context(db_session)
    rows = get_data(await client.get("/api/feedback", params={"user_id": user.id}, headers=auth_headers))
    assert [row["id"] for row in rows] == [ticket.id]
    assert rows[0]["replied_at"] == "2026-10-11T01:00:00+00:00"
    assert rows[0]["updated_at"] is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("resource", ["users", "auth-codes", "feedback"])
async def test_scoped_detail_rejects_other_platform(client, auth_headers, db_session, resource):
    code, _, user, _, ticket = await seed_context(db_session)
    record_id = {"users": user.id, "auth-codes": code.id, "feedback": ticket.id}[resource]
    good = await client.get(f"/api/{resource}/{record_id}", params={"platform_key": "amazon"}, headers=auth_headers)
    assert good.status_code == 200
    wrong = await client.get(f"/api/{resource}/{record_id}", params={"platform_key": "aliexpress"}, headers=auth_headers)
    assert wrong.status_code == 403


@pytest.mark.asyncio
async def test_scoped_user_list_never_joins_by_name(client, auth_headers, db_session):
    _, _, user, _, _ = await seed_context(db_session)
    rows = get_data(await client.get("/api/users", params={"platform_key": "amazon"}, headers=auth_headers))
    assert [row["id"] for row in rows] == [user.id]


@pytest.mark.asyncio
async def test_deep_link_reads_full_ticket_outside_first_page(client, auth_headers, db_session):
    _, _, _, _, ticket = await seed_context(db_session)
    detail = get_data(await client.get(f"/api/feedback/{ticket.id}", headers=auth_headers))
    assert detail["screenshot"] == '["/uploads/context.png"]'
    assert detail["replied_at"] == "2026-10-11T01:00:00+00:00"


@pytest.mark.asyncio
@pytest.mark.parametrize("resource", ["users", "auth-codes", "feedback"])
async def test_deep_links_remain_staff_only(client, resource):
    response = await client.get(f"/api/{resource}/1")
    assert response.status_code == 401
