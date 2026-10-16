"""
公告 API 测试
"""
import pytest
from sqlalchemy import select

from core.security import create_access_token
from domains.announcements import service
from models import Announcement, AnnouncementReceipt, AuthCode, Plan, User


@pytest.fixture
def user_token():
    """普通用户 token"""
    return create_access_token({"user_id": 1, "auth_code_id": 1, "device_id": "DEV-TEST", "role": "user"})


async def receipt_customer(db_session):
    plan = Plan(name="公告测试", price=1, duration_days=30, product_type="consumer", entitlements="{}")
    db_session.add(plan)
    await db_session.flush()
    auth_code = AuthCode(code="ANN-RECEIPT", plan_id=plan.id, status="active")
    db_session.add(auth_code)
    await db_session.flush()
    user = User(name="公告用户", auth_code_id=auth_code.id, device_id="DEV-TEST")
    db_session.add(user)
    await db_session.commit()
    identity = {"user_id": user.id, "auth_code_id": auth_code.id, "device_id": "DEV-TEST", "role": "user"}
    return {"Authorization": f"Bearer {create_access_token(identity)}"}, identity


class TestAnnouncementsAPI:
    """公告 API 测试"""

    @pytest.mark.asyncio
    async def test_get_announcements(self, client, db_session, admin_token):
        """测试获取公告列表"""
        announcement = Announcement(
            title="测试公告",
            content="公告内容",
            status="published"
        )
        db_session.add(announcement)
        await db_session.commit()

        response = await client.get(
            "/api/announcements",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        data = body["data"]
        assert len(data) >= 1
        assert data[0]["title"] == "测试公告"

    @pytest.mark.asyncio
    async def test_get_active_announcements(self, client, db_session):
        """测试获取已发布公告列表"""
        announcement = Announcement(
            title="已发布公告",
            content="公告内容",
            status="published"
        )
        db_session.add(announcement)
        await db_session.commit()

        response = await client.get("/api/announcements/active")
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True

    @pytest.mark.asyncio
    async def test_admin_list_requires_authentication(self, client):
        response = await client.get("/api/announcements")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_feed_targets_consumer_and_records_receipt(self, client, db_session):
        plan = Plan(name="C端", price=1, duration_days=30, product_type="consumer", entitlements="{}")
        db_session.add(plan)
        await db_session.flush()
        auth_code = AuthCode(code="ANN-C", plan_id=plan.id, status="active")
        db_session.add(auth_code)
        await db_session.flush()
        user = User(name="公告用户", auth_code_id=auth_code.id, device_id="DEV-TEST")
        db_session.add(user)
        consumer = Announcement(
            title="C端公告", content="仅 C 端", status="published", audience="consumer",
            category="system", severity="info", presentation="banner", revision=1,
        )
        business = Announcement(
            title="B端公告", content="仅 B 端", status="published", audience="business",
            category="system", severity="info", presentation="banner", revision=1,
        )
        db_session.add_all([consumer, business])
        await db_session.commit()
        await db_session.refresh(user)
        await db_session.refresh(consumer)
        token = create_access_token({
            "user_id": user.id, "auth_code_id": auth_code.id,
            "device_id": "DEV-TEST", "role": "user",
        })
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.get("/api/announcements/feed", headers=headers)
        assert response.status_code == 200
        titles = [item["title"] for item in response.json()["data"]]
        assert "C端公告" in titles
        assert "B端公告" not in titles

        response = await client.post(f"/api/announcements/{consumer.id}/read", headers=headers)
        assert response.status_code == 200
        response = await client.get("/api/announcements/feed", headers=headers)
        item = next(item for item in response.json()["data"] if item["id"] == consumer.id)
        assert item["is_read"] is True

    @pytest.mark.asyncio
    async def test_content_revision_becomes_unread_again(self, client, db_session, admin_token):
        announcement = Announcement(
            title="修订前", content="内容", status="published", audience="all",
            category="system", severity="info", presentation="banner", revision=1,
        )
        db_session.add(announcement)
        await db_session.commit()
        await db_session.refresh(announcement)

        response = await client.put(
            f"/api/announcements/{announcement.id}",
            json={"content": "修订后的内容"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200
        assert response.json()["data"]["revision"] == 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize("action", ["read", "dismiss"])
    async def test_receipt_requires_the_revision_actually_viewed(self, client, db_session, admin_token, action):
        headers, _ = await receipt_customer(db_session)
        announcement = Announcement(title="版本2", content="旧内容", status="published", revision=2)
        db_session.add(announcement)
        await db_session.commit()
        feed = (await client.get("/api/announcements/feed", headers=headers)).json()["data"]
        viewed = next(item for item in feed if item["id"] == announcement.id)
        assert viewed["revision"] == 2
        updated = await client.put(f"/api/announcements/{announcement.id}", json={"content": "新版内容"}, headers={"Authorization": f"Bearer {admin_token}"})
        assert updated.json()["data"]["revision"] == 3

        response = await client.post(f"/api/announcements/{announcement.id}/{action}", json={"revision": viewed["revision"]}, headers=headers)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "ANNOUNCEMENT_REVISION_CONFLICT"
        assert (await db_session.execute(select(AnnouncementReceipt))).scalars().all() == []
        latest = (await client.get("/api/announcements/feed", headers=headers)).json()["data"][0]
        assert latest["revision"] == 3
        assert latest["is_read"] is False and latest["is_dismissed"] is False

        response = await client.post(f"/api/announcements/{announcement.id}/{action}", json={"revision": 3}, headers=headers)
        assert response.status_code == 200
        assert response.json()["data"] == {"announcement_id": announcement.id, "revision": 3, "action": action}
        saved = (await db_session.execute(select(AnnouncementReceipt))).scalar_one()
        assert saved.revision == 3 and saved.read_at is not None
        assert (saved.dismissed_at is not None) is (action == "dismiss")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("action", ["read", "dismiss"])
    @pytest.mark.parametrize("current_revision", [1, 2])
    @pytest.mark.parametrize("body", [None, {}])
    async def test_legacy_receipts_never_acknowledge_an_edited_announcement(self, client, db_session, action, current_revision, body):
        headers, _ = await receipt_customer(db_session)
        announcement = Announcement(title="旧客户端公告", content="内容", status="published", revision=current_revision)
        db_session.add(announcement)
        await db_session.commit()
        kwargs = {"json": body} if body is not None else {}
        response = await client.post(f"/api/announcements/{announcement.id}/{action}", headers=headers, **kwargs)
        receipts = (await db_session.execute(select(AnnouncementReceipt))).scalars().all()
        if current_revision == 1:
            assert response.status_code == 200
            assert [item.revision for item in receipts] == [1]
        else:
            assert response.status_code == 409
            assert response.json()["detail"]["code"] == "ANNOUNCEMENT_REVISION_REQUIRED"
            assert receipts == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("action", ["read", "dismiss"])
    @pytest.mark.parametrize("viewed_revision", [0, -1, True, "2", 3])
    async def test_invalid_or_future_revision_never_creates_a_receipt(self, client, db_session, action, viewed_revision):
        headers, _ = await receipt_customer(db_session)
        announcement = Announcement(title="公告", content="内容", status="published", revision=2)
        db_session.add(announcement)
        await db_session.commit()
        response = await client.post(f"/api/announcements/{announcement.id}/{action}", json={"revision": viewed_revision}, headers=headers)
        assert response.status_code == (409 if viewed_revision == 3 else 422)
        assert (await db_session.execute(select(AnnouncementReceipt))).scalars().all() == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("action", ["read", "dismiss"])
    async def test_publication_after_validation_cannot_change_receipt_revision(self, db_session, monkeypatch, action):
        _, identity = await receipt_customer(db_session)
        announcement = Announcement(title="版本2", content="内容", status="published", revision=2)
        db_session.add(announcement)
        await db_session.commit()
        execute = db_session.execute
        calls = 0

        async def publish_between_validation_and_receipt(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                announcement.revision = 3
                await db_session.flush()
            return await execute(*args, **kwargs)

        monkeypatch.setattr(db_session, "execute", publish_between_validation_and_receipt)
        receipt = await service.record_receipt(db_session, announcement.id, identity, action, 2)
        assert receipt["revision"] == 2
        assert (await execute(select(AnnouncementReceipt))).scalar_one().revision == 2
        latest = (await service.feed(db_session, identity))[0]
        assert latest["revision"] == 3
        assert latest["is_read"] is False and latest["is_dismissed"] is False

    @pytest.mark.asyncio
    async def test_create_announcement_admin(self, client, admin_token):
        """测试管理员创建公告"""
        response = await client.post(
            "/api/announcements",
            json={"title": "新公告", "content": "内容", "status": "published"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert "id" in body["data"]

    @pytest.mark.asyncio
    async def test_update_announcement(self, client, db_session, admin_token):
        """测试更新公告"""
        announcement = Announcement(
            title="原标题",
            content="原内容",
            status="draft"
        )
        db_session.add(announcement)
        await db_session.commit()
        await db_session.refresh(announcement)

        response = await client.put(
            f"/api/announcements/{announcement.id}",
            json={"title": "新标题", "content": "新内容"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True

    @pytest.mark.asyncio
    async def test_delete_announcement(self, client, db_session, admin_token):
        """测试删除公告"""
        announcement = Announcement(
            title="待删除公告",
            content="内容",
            status="draft"
        )
        db_session.add(announcement)
        await db_session.commit()
        await db_session.refresh(announcement)

        response = await client.delete(
            f"/api/announcements/{announcement.id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True

    @pytest.mark.asyncio
    async def test_delete_nonexistent_announcement(self, client, admin_token):
        """测试删除不存在的公告"""
        response = await client.delete(
            "/api/announcements/99999",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 404
