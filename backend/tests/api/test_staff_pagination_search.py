import pytest

from models import StaffRole, StaffStatus, StaffUser


@pytest.mark.asyncio
async def test_staff_search_reaches_beyond_first_hundred(client, auth_headers, db_session):
    db_session.add_all([
        StaffUser(username=f"paging{i:03d}", display_name=f"成员{i:03d}", password_hash="unused-test-hash",
                  role=StaffRole.SUPPORT, status=StaffStatus.ACTIVE, token_version=1,
                  force_password_reset=False)
        for i in range(121)
    ])
    await db_session.commit()
    page = await client.get("/api/staff/accounts", params={"page": 6, "page_size": 20}, headers=auth_headers)
    assert page.status_code == 200
    assert page.json()["total"] >= 121
    assert len(page.json()["data"]) == 20
    for query in ["paging120", "成员120"]:
        result = await client.get("/api/staff/accounts", params={"q": query}, headers=auth_headers)
        assert result.status_code == 200
        assert result.json()["total"] == 1
        assert result.json()["data"][0]["username"] == "paging120"
    escaped = await client.get("/api/staff/accounts", params={"q": "%"}, headers=auth_headers)
    assert escaped.json()["total"] == 0
    invalid = await client.get("/api/staff/accounts", params={"q": "a" * 101}, headers=auth_headers)
    assert invalid.status_code == 422
