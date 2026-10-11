"""
认证 API 集成测试
测试所有认证相关接口
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.cache import cache
from core.config import settings
from core.security import hash_password
from models import AuthCode, AuthSeat, Device, Plan, StaffRole, StaffStatus, StaffUser, User


class TestHealthCheck:
    """健康检查测试"""

    @pytest.fixture(autouse=True)
    def isolate_redis_health(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Keep health assertions independent from a developer's local Redis."""
        monkeypatch.setattr(settings, "REDIS_URL", "")
        monkeypatch.setattr(cache, "redis", None)
        monkeypatch.setattr(cache, "redis_error", None)
    
    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """测试健康检查接口"""
        response = await client.get("/api/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert "checks" in data
        assert data["checks"]["database"]["status"] == "ok"

    @pytest.mark.asyncio
    async def test_liveness_check_has_no_dependency_payload(self, client: AsyncClient):
        response = await client.get("/api/health/live")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert "checks" not in response.json()
        assert "commit_sha" in response.json()
        assert "release_id" in response.json()

    @pytest.mark.asyncio
    async def test_readiness_check_keeps_health_contract(self, client: AsyncClient):
        response = await client.get("/api/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["checks"]["database"]["status"] == "ok"

    @pytest.mark.asyncio
    async def test_readiness_returns_503_when_database_is_unavailable(
        self, client: AsyncClient, monkeypatch
    ):
        async def failed_database():
            return {"status": "error", "type": "mysql", "error": "offline"}

        monkeypatch.setattr("app.factory.check_db_health", failed_database)
        response = await client.get("/api/health/ready")

        assert response.status_code == 503
        assert response.json()["status"] == "degraded"
        assert response.json()["checks"]["database"]["status"] == "error"

    @pytest.mark.asyncio
    async def test_configured_but_unavailable_redis_is_reported_as_error(
        self, client: AsyncClient, monkeypatch
    ):
        monkeypatch.setattr(settings, "REDIS_URL", "redis://configured.example:6379/0")
        monkeypatch.setattr(cache, "redis", None)
        monkeypatch.setattr(cache, "redis_error", "connection refused")
        monkeypatch.setattr(cache, "_next_retry_at", float("inf"))

        response = await client.get("/api/health/ready")

        assert response.status_code == 200
        assert response.json()["status"] == "degraded"
        assert response.json()["checks"]["redis"] == {
            "status": "error",
            "error": "connection refused",
            "required": False,
        }

    @pytest.mark.asyncio
    async def test_health_exposes_release_identity(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr(settings, "COMMIT_SHA", "abc1234")
        monkeypatch.setattr(settings, "RELEASE_ID", "release-20260816")

        live = await client.get("/api/health/live")
        ready = await client.get("/api/health/ready")
        system = await client.get("/api/system-info")

        assert live.json()["commit_sha"] == "abc1234"
        assert ready.json()["commit_sha"] == "abc1234"
        assert ready.json()["release_id"] == "release-20260816"
        assert system.json()["app"]["commit_sha"] == "abc1234"

    @pytest.mark.asyncio
    async def test_desktop_cors_contract(self, client: AsyncClient):
        response = await client.options(
            "/api/settings/public",
            headers={
                "Origin": "app://toolbox",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "authorization,content-type,x-toolbox-version",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "app://toolbox"
        assert "PATCH" in response.headers["access-control-allow-methods"]
        assert "X-Toolbox-Version" in response.headers["access-control-allow-headers"]

    @pytest.mark.asyncio
    async def test_demo_batch_cors_allows_idempotency_header(self, client: AsyncClient):
        response = await client.options(
            "/api/demo/batches",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type,idempotency-key,x-toolbox-version",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
        assert "Idempotency-Key" in response.headers["access-control-allow-headers"]


class TestAdminLogin:
    """管理员登录测试"""
    
    @pytest.mark.asyncio
    async def test_admin_login_success(self, client: AsyncClient, db_session: AsyncSession):
        """测试管理员正确密码登录"""
        staff = StaffUser(
            username="admin",
            display_name="超级管理员",
            password_hash=hash_password("Admin-test-123"),
            role=StaffRole.SUPER_ADMIN,
            status=StaffStatus.ACTIVE,
            token_version=1,
            force_password_reset=False,
        )
        db_session.add(staff)
        await db_session.commit()
        
        response = await client.post(
            "/api/auth/admin-login",
            json={"username": "admin", "password": "Admin-test-123"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "token" in data["data"]
        assert data["data"]["role"] == StaffRole.SUPER_ADMIN
    
    @pytest.mark.asyncio
    async def test_admin_login_wrong_password(self, client: AsyncClient, db_session: AsyncSession):
        """测试管理员错误密码"""
        staff = StaffUser(
            username="admin",
            display_name="超级管理员",
            password_hash=hash_password("Correct-password-123"),
            role=StaffRole.SUPER_ADMIN,
            status=StaffStatus.ACTIVE,
            token_version=1,
            force_password_reset=False,
        )
        db_session.add(staff)
        await db_session.commit()
        
        response = await client.post("/api/auth/admin-login", json={"password": "wrong_password"})
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
    
    @pytest.mark.asyncio
    async def test_admin_login_no_password_set(self, client: AsyncClient):
        """测试未设置管理员密码"""
        response = await client.post("/api/auth/admin-login", json={"password": "any_password"})
        
        data = response.json()
        assert data["success"] is False
    
    @pytest.mark.asyncio
    async def test_admin_login_empty_password(self, client: AsyncClient):
        """测试空密码"""
        response = await client.post("/api/auth/admin-login", json={"password": ""})
        
        data = response.json()
        assert data["success"] is False


class TestAuthVerify:
    """授权码验证测试"""
    
    @pytest.mark.asyncio
    async def test_verify_valid_code(self, client: AsyncClient, db_session: AsyncSession):
        """测试有效授权码验证"""
        # 创建套餐
        plan = Plan(name="Y199 测试套餐", price=99.00, duration_days=30, status="active")
        db_session.add(plan)
        await db_session.commit()
        
        # 创建授权码
        auth_code = AuthCode(
            code="VALID-TEST-CODE",
            plan_id=plan.id,
            max_devices=1,
            status="unused"
        )
        db_session.add(auth_code)
        await db_session.commit()
        
        response = await client.post("/api/auth/verify", json={
            "code": "VALID-TEST-CODE",
            "device_id": "device-001",
            "device_name": "测试设备"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "token" in data["data"]
        assert data["data"]["plan_name"] == "Y199 测试套餐"
        assert data["data"]["plan_code"] == "Y199"
    
    @pytest.mark.asyncio
    async def test_verify_invalid_code(self, client: AsyncClient):
        """测试无效授权码"""
        response = await client.post("/api/auth/verify", json={
            "code": "INVALID-CODE-12345",
            "device_id": "device-001",
            "device_name": "测试设备"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "无效" in data["message"]
    
    @pytest.mark.asyncio
    async def test_verify_frozen_code(self, client: AsyncClient, db_session: AsyncSession):
        """测试冻结的授权码"""
        auth_code = AuthCode(code="FROZEN-CODE", status="frozen")
        db_session.add(auth_code)
        await db_session.commit()
        
        response = await client.post("/api/auth/verify", json={
            "code": "FROZEN-CODE",
            "device_id": "device-001",
            "device_name": "测试设备"
        })
        
        data = response.json()
        assert data["success"] is False
        assert "冻结" in data["message"]
    
    @pytest.mark.asyncio
    async def test_verify_expired_code(self, client: AsyncClient, db_session: AsyncSession):
        """测试过期的授权码"""
        from datetime import datetime, timedelta
        
        auth_code = AuthCode(
            code="EXPIRED-CODE",
            status="expired",
            expires_at=datetime.now() - timedelta(days=1)
        )
        db_session.add(auth_code)
        await db_session.commit()
        
        response = await client.post("/api/auth/verify", json={
            "code": "EXPIRED-CODE",
            "device_id": "device-001",
            "device_name": "测试设备"
        })
        
        data = response.json()
        assert data["success"] is False
        assert "过期" in data["message"]
    
    @pytest.mark.asyncio
    async def test_verify_code_with_device_limit(self, client: AsyncClient, db_session: AsyncSession):
        """测试设备数量限制"""
        from models import Device
        
        # 创建套餐和授权码
        plan = Plan(name="单设备套餐", price=49.00, duration_days=30, status="active")
        db_session.add(plan)
        await db_session.commit()
        
        auth_code = AuthCode(
            code="LIMIT-CODE",
            plan_id=plan.id,
            max_devices=1,
            status="active"
        )
        db_session.add(auth_code)
        await db_session.commit()
        
        # 创建用户
        user = User(auth_code_id=auth_code.id, device_id="existing-device")
        db_session.add(user)
        await db_session.commit()
        auth_code.user_id = user.id
        await db_session.commit()
        
        # 添加一个已绑定的设备
        device = Device(auth_code_id=auth_code.id, device_id="existing-device")
        db_session.add(device)
        await db_session.commit()
        
        # 尝试用新设备登录（应该失败）
        response = await client.post("/api/auth/verify", json={
            "code": "LIMIT-CODE",
            "device_id": "new-device-002",
            "device_name": "新设备"
        })
        
        data = response.json()
        assert data["success"] is False
        assert "设备上限" in data["message"]
    
    @pytest.mark.asyncio
    async def test_verify_code_multiple_devices(self, client: AsyncClient, db_session: AsyncSession):
        """测试多设备支持"""
        from models import Device
        
        # 创建套餐和授权码（支持3台设备）
        plan = Plan(name="多设备套餐", price=199.00, duration_days=30, status="active")
        db_session.add(plan)
        await db_session.commit()
        
        auth_code = AuthCode(
            code="MULTI-DEVICE-CODE",
            plan_id=plan.id,
            max_devices=3,
            status="active"
        )
        db_session.add(auth_code)
        await db_session.commit()
        
        # 创建用户
        user = User(auth_code_id=auth_code.id, device_id="device-1")
        db_session.add(user)
        await db_session.commit()
        auth_code.user_id = user.id
        await db_session.commit()
        
        # 添加第一台设备
        device1 = Device(auth_code_id=auth_code.id, device_id="device-1")
        db_session.add(device1)
        await db_session.commit()
        
        # 用第二台设备登录（应该成功）
        response = await client.post("/api/auth/verify", json={
            "code": "MULTI-DEVICE-CODE",
            "device_id": "device-2",
            "device_name": "第二台设备"
        })
        
        data = response.json()
        assert data["success"] is True
        assert "token" in data["data"]

    @pytest.mark.asyncio
    async def test_same_device_name_recovers_rotated_legacy_device_id(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """旧客户端退出后丢失 device_id，同一电脑不得被当成第二个席位。"""
        plan = Plan(name="Y15 体验卡", price=15, duration_days=1, status="active")
        db_session.add(plan)
        await db_session.flush()
        auth_code = AuthCode(
            code="LEGACY-ROTATED-DEVICE",
            plan_id=plan.id,
            max_devices=1,
            seat_limit=1,
            status="active",
            device_id="DEV-OLD",
            device_name="DESKTOP-SAME",
        )
        db_session.add(auth_code)
        await db_session.flush()
        user = User(
            auth_code_id=auth_code.id,
            device_id="DEV-OLD",
            device_name="DESKTOP-SAME",
            total_seats=1,
        )
        db_session.add(user)
        await db_session.flush()
        auth_code.user_id = user.id
        seat = AuthSeat(
            auth_code_id=auth_code.id,
            user_id=user.id,
            device_id="DEV-OLD",
            device_name="DESKTOP-SAME",
            seat_no=1,
            status="active",
        )
        device = Device(
            auth_code_id=auth_code.id,
            device_id="DEV-OLD",
            device_name="DESKTOP-SAME",
        )
        db_session.add_all([seat, device])
        await db_session.commit()

        response = await client.post("/api/auth/verify", json={
            "code": "LEGACY-ROTATED-DEVICE",
            "device_id": "DEV-STABLE-NEW",
            "device_name": "DESKTOP-SAME",
        })
        body = response.json()

        assert body["success"] is True
        assert body["data"]["seat_used"] == 1
        assert body["data"]["device_used"] == 1
        await db_session.refresh(seat)
        await db_session.refresh(device)
        await db_session.refresh(user)
        assert seat.device_id == "DEV-STABLE-NEW"
        assert device.device_id == "DEV-STABLE-NEW"
        assert user.device_id == "DEV-STABLE-NEW"


class TestGetCurrentUser:
    """获取当前用户信息测试"""
    
    @pytest.mark.asyncio
    async def test_get_current_user_with_valid_token(self, client: AsyncClient, admin_token: str):
        """测试带有效 Token 获取用户信息"""
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["role"] == StaffRole.SUPER_ADMIN
    
    @pytest.mark.asyncio
    async def test_get_current_user_without_token(self, client: AsyncClient):
        """测试不带 Token 获取用户信息"""
        response = await client.get("/api/auth/me")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_get_current_user_with_invalid_token(self, client: AsyncClient):
        """测试带无效 Token 获取用户信息"""
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid_token_here"}
        )
        
        assert response.status_code == 401


class TestRefreshToken:
    """Token 刷新测试"""
    
    @pytest.mark.asyncio
    async def test_staff_token_refresh_is_disabled(self, client: AsyncClient, admin_token: str):
        """后台 JWT 固定八小时，不提供刷新。"""
        response = await client.post(
            "/api/auth/refresh",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 403
        data = response.json()
        assert data["detail"]["code"] == "FEATURE_DISABLED"
    
    @pytest.mark.asyncio
    async def test_refresh_token_without_token(self, client: AsyncClient):
        """测试不带 Token 刷新"""
        response = await client.post("/api/auth/refresh")
        
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


class TestCheckAuthStatus:
    """授权状态检查测试"""
    
    @pytest.mark.asyncio
    async def test_check_auth_status_admin(self, client: AsyncClient, admin_token: str):
        """测试管理员检查状态"""
        response = await client.post(
            "/api/auth/check",
            json={"code": "test", "device_id": "test", "device_name": ""},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["role"] == StaffRole.SUPER_ADMIN
    
    @pytest.mark.asyncio
    async def test_check_auth_status_without_token(self, client: AsyncClient):
        """测试不带 Token 检查状态"""
        response = await client.post(
            "/api/auth/check",
            json={"code": "test", "device_id": "test", "device_name": ""}
        )
        
        assert response.status_code == 401
