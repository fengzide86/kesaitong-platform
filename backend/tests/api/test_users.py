"""
用户管理 API 集成测试
"""
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import User
from tests.conftest import get_data


@pytest.mark.asyncio
@pytest.mark.parametrize("view", ["list", "detail"])
async def test_created_at_is_explicit_utc_without_reinterpreting_legacy_activity(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict, view: str,
):
    """Creation uses UTC DB defaults; the unrelated legacy activity field stays untouched."""
    legacy_activity = datetime(2026, 10, 1, 9, 25)
    user = User(name="UTC创建时间", device_id="utc-created-device", last_active_at=legacy_activity)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    # SQLite CURRENT_TIMESTAMP is UTC. MySQL sessions explicitly SET +00:00
    # in database.py; activation never overrides User.created_at.
    assert abs((datetime.now(UTC).replace(tzinfo=None) - user.created_at).total_seconds()) < 30
    path = "/api/users" if view == "list" else f"/api/users/{user.id}"
    response = await client.get(path, headers=auth_headers)
    data = get_data(response)
    item = data[0] if view == "list" else data
    assert item["created_at"] == user.created_at.replace(tzinfo=UTC).isoformat()
    assert datetime.fromisoformat(item["created_at"]).tzinfo == UTC
    if view == "detail":
        assert item["last_active_at"] == legacy_activity.isoformat()


class TestGetUsers:
    """获取用户列表测试"""
    
    @pytest.mark.asyncio
    async def test_get_users_empty(self, client: AsyncClient, auth_headers: dict):
        """测试获取空用户列表"""
        response = await client.get("/api/users", headers=auth_headers)
        
        assert response.status_code == 200
        data = get_data(response)
        assert isinstance(data, list)
        assert len(data) == 0
    
    @pytest.mark.asyncio
    async def test_get_users_with_data(self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict):
        """测试获取用户列表（有数据）"""
        # 创建测试用户
        user1 = User(name="用户1", phone="13800138001", device_id="device-001")
        user2 = User(name="用户2", phone="13800138002", device_id="device-002")
        db_session.add_all([user1, user2])
        await db_session.commit()
        
        response = await client.get("/api/users", headers=auth_headers)
        
        assert response.status_code == 200
        data = get_data(response)
        assert len(data) == 2
        assert data[0]["name"] in ["用户1", "用户2"]
    
    @pytest.mark.asyncio
    async def test_get_users_pagination(self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict):
        """测试用户列表分页"""
        # 创建多个用户
        for i in range(15):
            user = User(name=f"用户{i}", phone=f"138001380{i:02d}", device_id=f"device-{i:03d}")
            db_session.add(user)
        await db_session.commit()
        
        # 第一页
        response = await client.get("/api/users?page=1&page_size=10", headers=auth_headers)
        assert response.status_code == 200
        data = get_data(response)
        assert len(data) == 10
        
        # 第二页
        response = await client.get("/api/users?page=2&page_size=10", headers=auth_headers)
        assert response.status_code == 200
        data = get_data(response)
        assert len(data) == 5


class TestGetUser:
    """获取用户详情测试"""
    
    @pytest.mark.asyncio
    async def test_get_user_success(self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict):
        """测试成功获取用户详情"""
        user = User(name="测试用户", phone="13800138000", device_id="test-device")
        db_session.add(user)
        await db_session.commit()
        
        response = await client.get(f"/api/users/{user.id}", headers=auth_headers)
        
        assert response.status_code == 200
        data = get_data(response)
        assert data["name"] == "测试用户"
        assert data["phone"] == "13800138000"
    
    @pytest.mark.asyncio
    async def test_get_user_not_found(self, client: AsyncClient, auth_headers: dict):
        """测试获取不存在的用户"""
        response = await client.get("/api/users/99999", headers=auth_headers)
        
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is False


class TestUpdateUser:
    """更新用户测试"""
    
    @pytest.mark.asyncio
    async def test_update_user_success(self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict):
        """测试成功更新用户"""
        user = User(name="原名字", phone="13800138000", device_id="test-device")
        db_session.add(user)
        await db_session.commit()
        
        update_data = {"name": "新名字", "phone": "13900139000"}
        response = await client.put(f"/api/users/{user.id}", json=update_data, headers=auth_headers)
        
        assert response.status_code == 200
        data = get_data(response)
        assert data["name"] == "新名字"
        assert data["phone"] == "13900139000"
    
    @pytest.mark.asyncio
    async def test_update_user_without_auth(self, client: AsyncClient, db_session: AsyncSession):
        """测试未认证更新用户"""
        user = User(name="测试用户", phone="13800138000", device_id="test-device")
        db_session.add(user)
        await db_session.commit()
        
        update_data = {"name": "新名字"}
        response = await client.put(f"/api/users/{user.id}", json=update_data)
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_update_user_not_found(self, client: AsyncClient, auth_headers: dict):
        """测试更新不存在的用户"""
        response = await client.put("/api/users/99999", json={"name": "不存在"}, headers=auth_headers)
        
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is False
