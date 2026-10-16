"""Search behavior uses isolated records; no production service or data."""

from datetime import datetime, timedelta

import pytest

from models import Feedback
from tests.conftest import get_data


@pytest.mark.asyncio
@pytest.mark.parametrize("keyword, expected_id", [("物流模板", 901), ("配送费用", 902), ("903", 903)])
async def test_feedback_keyword_finds_title_content_and_ticket_number(client, auth_headers, db_session, keyword, expected_id):
    db_session.add_all([
        Feedback(id=901, title="物流模板有疑问", content="请帮助检查", status="pending", platform_key="amazon"),
        Feedback(id=902, title="设置咨询", content="配送费用怎样填写", status="pending", platform_key="amazon"),
        Feedback(id=903, title="账号问题", content="页面加载失败", status="processing", platform_key="amazon"),
    ])
    await db_session.commit()
    response = await client.get("/api/feedback", params={"keyword": f"  {keyword}  "}, headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert [row["id"] for row in get_data(response)] == [expected_id]


@pytest.mark.asyncio
async def test_feedback_search_filters_before_pagination_and_preserves_total(client, auth_headers, db_session):
    now = datetime.utcnow()
    db_session.add_all([
        Feedback(title=f"匹配词工单 {index}", content="内容", status="pending", platform_key="amazon", created_at=now - timedelta(minutes=index))
        for index in range(25)
    ])
    db_session.add_all([
        Feedback(title="匹配词其他状态", content="内容", status="resolved", platform_key="amazon"),
        Feedback(title="匹配词其他平台", content="内容", status="pending", platform_key="aliexpress"),
        Feedback(title="无关工单", content="内容", status="pending", platform_key="amazon"),
    ])
    await db_session.commit()
    params = {"keyword": "匹配词", "status": "pending", "platform_key": "amazon", "page_size": 20}
    first = await client.get("/api/feedback", params=params, headers=auth_headers)
    second = await client.get("/api/feedback", params=params | {"page": 2}, headers=auth_headers)
    for response in (first, second):
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 25
        assert all(row["status"] == "pending" and row["platform_key"] == "amazon" for row in get_data(response))
    assert len(get_data(first)) == 20
    assert len(get_data(second)) == 5
    assert not ({row["id"] for row in get_data(first)} & {row["id"] for row in get_data(second)})


@pytest.mark.asyncio
async def test_feedback_no_match_returns_empty_without_removing_existing_tickets(client, auth_headers, db_session):
    db_session.add(Feedback(title="现有工单", content="仍然存在", status="pending"))
    await db_session.commit()
    empty = await client.get("/api/feedback", params={"keyword": "不匹配的关键词"}, headers=auth_headers)
    assert empty.status_code == 200, empty.text
    assert empty.json()["total"] == 0
    assert get_data(empty) == []
    restored = await client.get("/api/feedback", headers=auth_headers)
    assert restored.json()["total"] == 1
    assert get_data(restored)[0]["title"] == "现有工单"


@pytest.mark.asyncio
async def test_feedback_search_treats_sql_wildcards_as_literal_text(client, auth_headers, db_session):
    db_session.add_all([
        Feedback(title="字段 %_ 原样显示", content="内容", status="pending"),
        Feedback(title="普通工单", content="内容", status="pending"),
    ])
    await db_session.commit()
    response = await client.get("/api/feedback", params={"keyword": "%_"}, headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert get_data(response)[0]["title"] == "字段 %_ 原样显示"
