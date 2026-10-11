"""
pytest 测试配置和公共 fixtures
"""
import os
import sys

# 确保 backend 目录在 Python 路径中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

# 设置测试环境变量
os.environ["APP_ENV"] = "test"

# 在导入 app 之前，将 Limiter.limit 装饰器替换为无操作装饰器
# 这样所有路由的频率限制都会被禁用
def _noop_limit(*args, **kwargs):
    """无操作的 limit 装饰器，用于测试环境"""
    def decorator(func):
        return func
    return decorator

# 补丁 Limiter.limit 方法
import slowapi  # noqa: E402 - test environment must be configured before app imports

slowapi.Limiter.limit = _noop_limit

from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402

# Business fixtures intentionally disable throttling; the independent-process
# scripts/tests/test_backend_security_live.py proves the real limiter boundary.
app.state.limiter.enabled = False

# 测试数据库 URL (使用 SQLite 内存数据库)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# 创建测试引擎
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)


@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def test_schema() -> AsyncGenerator[None, None]:
    """Create the shared in-memory schema once for the whole test session."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_schema: None) -> AsyncGenerator[AsyncSession, None]:
    """
    每个测试函数使用独立的数据库会话。
    测试结束后清空所有表；这兼容应用代码在用例内主动 commit，
    同时避免为每个用例重复执行整套 DDL。
    """
    async with AsyncSession(bind=test_engine, expire_on_commit=False) as session:
        yield session
        await session.rollback()

    async with test_engine.begin() as conn:
        # SQLite tests do not enforce foreign keys; metadata order avoids the
        # warning emitted by sorted_tables for the intentional user/code cycle.
        for table in reversed(tuple(Base.metadata.tables.values())):
            await conn.execute(table.delete())


@pytest.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    测试用 HTTP 客户端
    自动注入数据库会话
    """
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
async def admin_token(client: AsyncClient, db_session: AsyncSession) -> str:
    """获取超级管理员 Token"""
    from sqlalchemy import select

    from core.security import hash_password
    from models import StaffRole, StaffStatus, StaffUser
    
    result = await db_session.execute(select(StaffUser).where(StaffUser.username == "admin"))
    staff = result.scalars().first()
    
    if not staff:
        staff = StaffUser(
            username="admin",
            display_name="测试超级管理员",
            password_hash=hash_password("Admin-test-123"),
            role=StaffRole.SUPER_ADMIN,
            status=StaffStatus.ACTIVE,
            token_version=1,
            force_password_reset=False,
        )
        db_session.add(staff)
        await db_session.commit()
    else:
        staff.password_hash = hash_password("Admin-test-123")
        staff.status = StaffStatus.ACTIVE
        staff.force_password_reset = False
        await db_session.commit()
    
    response = await client.post(
        "/api/staff/auth/login",
        json={"username": "admin", "password": "Admin-test-123"},
    )
    data = response.json()
    if data.get("success") and data.get("data", {}).get("token"):
        return data["data"]["token"]
    raise Exception(f"获取管理员 Token 失败: {data}")


@pytest.fixture(scope="function")
async def auth_headers(admin_token: str) -> dict:
    """获取认证请求头"""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def staff_headers_factory(db_session: AsyncSession):
    """Create a staff account and return a valid Authorization header."""
    from core.security import hash_password
    from models import StaffStatus, StaffUser
    from services.staff_service import create_staff_access_token

    async def factory(role: str, username: str) -> dict:
        staff = StaffUser(
            username=username,
            display_name=username,
            password_hash=hash_password("Staff-test-123"),
            role=role,
            status=StaffStatus.ACTIVE,
            token_version=1,
            force_password_reset=False,
        )
        db_session.add(staff)
        await db_session.commit()
        await db_session.refresh(staff)
        return {"Authorization": f"Bearer {create_staff_access_token(staff)}"}

    return factory


# ===== 测试数据工厂 =====

@pytest.fixture
def sample_plan_data():
    """套餐测试数据"""
    return {
        "name": "测试套餐",
        "price": 99.00,
        "duration_days": 30,
        "features": '["功能1", "功能2"]'
    }


@pytest.fixture
def sample_auth_code_data():
    """授权码测试数据"""
    return {
        "code": "TEST-CODE-12345",
        "plan_id": 1,
        "max_devices": 1,
        "status": "unused"
    }


@pytest.fixture
def sample_user_data():
    """用户测试数据"""
    return {
        "name": "测试用户",
        "phone": "13800138000",
        "device_id": "test-device-001",
        "device_name": "Test Device"
    }


@pytest.fixture
def sample_order_data():
    """订单测试数据"""
    return {
        "order_no": "ORD-2024-001",
        "plan_id": 1,
        "amount": 99.00,
        "channel": "微信",
        "responsible": "张三"
    }


@pytest.fixture
def sample_feedback_data():
    """工单测试数据"""
    return {
        "title": "测试工单",
        "content": "这是一个测试工单内容",
        "status": "pending"
    }


# ===== 响应格式辅助函数 =====

def get_data(response):
    """从统一响应格式 {"success": True, "data": ...} 中提取 data 字段"""
    body = response.json()
    if isinstance(body, dict) and "data" in body:
        return body["data"]
    return body


def get_json(response):
    """获取响应 JSON 的 data 部分（兼容旧格式）"""
    body = response.json()
    if isinstance(body, dict) and "data" in body:
        return body["data"]
    return body
