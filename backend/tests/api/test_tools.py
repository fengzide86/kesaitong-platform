"""
工具配置接口测试
"""
import json
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from core.config import settings
from core.security import create_access_token
from models import AuthCode, AuthSeat, Device, LaunchToken, Plan, Setting, User
from routers.tools import normalize_tool_config, resolve_tool_runtime


async def _seed_live_launch_access(db_session) -> tuple[str, int]:
    plan = Plan(
        name="Y49 Live launch test",
        price=Decimal("49.00"),
        duration_days=30,
        status="active",
        product_type="consumer",
    )
    db_session.add(plan)
    await db_session.flush()
    auth_code = AuthCode(
        code="LIVE-LAUNCH-TEST",
        plan_id=plan.id,
        max_devices=1,
        seat_limit=1,
        status="active",
        platform_scope="amazon",
    )
    db_session.add(auth_code)
    await db_session.flush()
    user = User(
        name="launch-owner",
        auth_code_id=auth_code.id,
        device_id="device-live",
        device_name="Live test device",
    )
    db_session.add(user)
    await db_session.flush()
    auth_code.user_id = user.id
    db_session.add_all(
        [
            AuthSeat(
                auth_code_id=auth_code.id,
                user_id=user.id,
                device_id="device-live",
                device_name="Live test device",
                status="active",
            ),
            Device(
                auth_code_id=auth_code.id,
                device_id="device-live",
                device_name="Live test device",
            ),
            Setting(
                key="tool_configs",
                value=json.dumps(
                    [
                        {
                            "id": "live_tool",
                            "name": "真实工具测试",
                            "module": "自动化",
                            "category": "automation",
                            "description": "Launch Grant 测试",
                            "platform_key": "amazon",
                            "capability_key": "live_tool",
                            "availability": "live",
                            "supports_live_single": True,
                            "release_status": "available",
                            "status": "online",
                            "script_key": "amazon.live_tool.v1",
                            "script_status": "script_ready",
                            "target_url": "https://example.test/live",
                        }
                    ],
                    ensure_ascii=False,
                ),
            ),
        ]
    )
    await db_session.commit()
    token = create_access_token({"user_id": user.id, "device_id": "device-live"})
    return token, auth_code.id


def test_resolve_tool_runtime_supports_legacy_tool_config():
    script_key, target_url = resolve_tool_runtime(
        {"id": "tool_listing", "capability_key": "listing_script"},
        "amazon",
    )

    assert script_key == "amazon.listing_script.v1"
    assert target_url == ""


def test_normalize_tool_config_fills_operational_fields():
    tool = normalize_tool_config(
        {
            "name": "亚马逊注册页面巡检",
            "module": "注册工具",
            "platform_key": "amazon",
            "capability_key": "register",
        },
        0,
    )

    assert tool["id"] == "tool_register"
    assert tool["script_key"] == "demo.register_v1"
    assert tool["target_url"] == ""
    assert tool["availability"] == "demo_only"
    assert tool["tool_version"] == "1.0.0"
    assert tool["runner_api_version"] == 1
    assert tool["status"] == "online"
    assert tool["release_status"] == "available"


def test_normalize_tool_config_turns_invalid_status_into_maintenance():
    tool = normalize_tool_config(
        {
            "id": "工具 A",
            "release_status": "bad-value",
            "status": "bad-value",
            "available_plans": "Y49, Y199",
        },
        0,
    )

    assert tool["id"] == "a"
    assert tool["release_status"] == "maintenance"
    assert tool["status"] == "maintenance"
    assert tool["available_plans"] == ["Y49", "Y199"]


@pytest.mark.asyncio
class TestGetTools:
    """获取工具列表"""

    async def test_get_tools_empty(self, client: AsyncClient):
        """无工具配置时返回空列表"""
        resp = await client.get("/api/tools")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_get_tools_after_set(self, client: AsyncClient, db_session, auth_headers: dict):
        """设置工具后可获取 - 直接写入 Setting 表"""
        import json

        from models import Setting
        tools = [
            {"name": "工具A", "module": "模块A", "status": "online", "category": "data"},
            {"name": "工具B", "module": "模块B", "status": "offline", "category": "operation"},
        ]
        setting = Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False))
        db_session.add(setting)
        await db_session.commit()

        resp = await client.get("/api/tools")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["name"] == "工具A"

    async def test_get_tools_filter_by_category(self, client: AsyncClient, db_session, auth_headers: dict):
        """按分类筛选工具"""
        import json

        from models import Setting
        tools = [
            {"name": "工具A", "module": "模块A", "status": "online", "category": "data"},
            {"name": "工具B", "module": "模块B", "status": "online", "category": "operation"},
            {"name": "工具C", "module": "模块C", "status": "online", "category": "data"},
        ]
        db_session.add(Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools", params={"category": "data"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert all(t["category"] == "data" for t in data)

    async def test_get_tools_filter_by_search(self, client: AsyncClient, db_session, auth_headers: dict):
        """按关键词搜索工具"""
        import json

        from models import Setting
        tools = [
            {"name": "数据分析工具", "module": "数据分析", "status": "online", "description": "用于数据分析"},
            {"name": "发货助手", "module": "物流", "status": "online", "description": "批量发货"},
        ]
        db_session.add(Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools", params={"search": "数据"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "数据分析工具"

    async def test_get_tools_search_case_insensitive(self, client: AsyncClient, db_session, auth_headers: dict):
        """搜索不区分大小写"""
        import json

        from models import Setting
        tools = [{"name": "DataTool", "module": "Module", "status": "online"}]
        db_session.add(Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools", params={"search": "data"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_get_tools_platform_filter_normalizes_legacy_tools_first(self, client: AsyncClient, db_session):
        """旧工具没有 platform_key 时，平台筛选前应先补齐默认运行字段"""
        import json

        from models import Setting
        tools = [{"id": "tool_reg_newbie", "name": "旧注册工具", "module": "注册工具", "status": "online"}]
        db_session.add(Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools", params={"platform_key": "amazon"})

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["platform_key"] == "amazon"
        assert data[0]["script_key"] == "demo.tool_reg_newbie_v1"
        assert data[0]["target_url"] == ""

    async def test_get_tools_category_all(self, client: AsyncClient, db_session, auth_headers: dict):
        """category=all 返回全部"""
        import json

        from models import Setting
        tools = [
            {"name": "A", "module": "M", "status": "online", "category": "data"},
            {"name": "B", "module": "M", "status": "online", "category": "operation"},
        ]
        db_session.add(Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools", params={"category": "all"})
        assert resp.status_code == 200
        assert len(resp.json()) == 2


@pytest.mark.asyncio
class TestToolCategories:
    """工具分类接口"""

    async def test_get_default_categories(self, client: AsyncClient):
        """未设置时返回默认分类"""
        resp = await client.get("/api/tools/categories")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert any(c["id"] == "all" for c in data)

    async def test_update_categories(self, client: AsyncClient, db_session, auth_headers: dict):
        """更新分类配置 - 直接写入 Setting 表"""
        import json

        from models import Setting
        cats = [{"id": "custom", "name": "自定义", "sort_order": 0}]
        db_session.add(Setting(key="tool_categories", value=json.dumps(cats, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools/categories")
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == "custom"

    async def test_update_categories_requires_admin(self, client: AsyncClient):
        """更新分类需要管理员权限"""
        cats = [{"id": "custom", "name": "自定义", "sort_order": 0}]
        resp = await client.put("/api/tools/categories", json=cats)
        assert resp.status_code in (401, 403)


@pytest.mark.asyncio
class TestUpdateTools:
    """更新工具配置"""

    async def test_update_tools_requires_admin(self, client: AsyncClient):
        """更新工具需要管理员权限"""
        resp = await client.put("/api/tools", json=[])
        assert resp.status_code in (401, 403)

    async def test_update_tools_success(self, client: AsyncClient, db_session, auth_headers: dict):
        """管理员可更新工具 - 验证 Setting 表写入"""
        import json

        from models import Setting
        # 先写入初始数据
        tools = [{"name": "新工具", "module": "模块", "status": "online"}]
        db_session.add(Setting(key="tool_configs", value=json.dumps(tools, ensure_ascii=False)))
        await db_session.commit()

        resp = await client.get("/api/tools")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "新工具"

    async def test_internal_update_cannot_enable_live_runtime(
        self,
        client: AsyncClient,
        auth_headers: dict,
    ):
        response = await client.put(
            "/api/tools",
            headers=auth_headers,
            json=[{
                "id": "unsafe-live-tool",
                "name": "待演示工具",
                "module": "内部验证",
                "availability": "live",
                "supports_live_single": True,
                "supports_live_batch": True,
                "target_url": "https://sellercentral.amazon.com/",
                "script_key": "amazon.unsafe.v1",
            }],
        )

        assert response.status_code == 200
        tool = response.json()["data"][0]
        assert tool["availability"] == "demo_only"
        assert tool["supports_live_single"] is False
        assert tool["supports_live_batch"] is False
        assert tool["target_url"] == ""
        assert tool["script_key"].startswith("demo.")


@pytest.mark.asyncio
async def test_launch_grant_create_and_verify_preserve_response_contract(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    access_token, auth_code_id = await _seed_live_launch_access(db_session)
    headers = {"Authorization": f"Bearer {access_token}"}

    created = await client.post(
        "/api/tools/live_tool/launch-grant",
        params={"platform_key": "amazon"},
        headers=headers,
    )

    assert created.status_code == 200
    payload = created.json()
    assert set(payload) == {"success", "message", "data"}
    assert payload["success"] is True
    assert set(payload["data"]) == {"token", "expires_in", "expires_at", "launch_data"}
    assert payload["data"]["launch_data"]["execution_mode"] == "single"
    launch = (
        await db_session.execute(
            select(LaunchToken).where(LaunchToken.token == payload["data"]["token"])
        )
    ).scalar_one()
    assert launch.auth_code_id == auth_code_id
    assert launch.status == "pending"

    verified = await client.post(
        "/api/tools/launch-grant/verify",
        params={"token": payload["data"]["token"]},
    )

    assert verified.status_code == 200
    assert verified.json()["data"] == {
        "valid": True,
        "user_id": launch.user_id,
        "auth_code_id": auth_code_id,
        "platform_key": "amazon",
        "tool_id": "live_tool",
        "script_key": "amazon.live_tool.v1",
        "device_id": "device-live",
        "execution_mode": "single",
        "client_batch_id": None,
        "client_item_id": None,
    }
    await db_session.refresh(launch)
    assert launch.status == "used"

    duplicate = await client.post(
        "/api/tools/launch-grant/verify",
        params={"token": payload["data"]["token"]},
    )
    assert duplicate.status_code == 200
    assert duplicate.json() == {
        "success": False,
        "message": "Token 已使用",
        "error_code": 403,
    }


@pytest.mark.asyncio
async def test_live_launch_grant_rejects_tool_without_ready_script(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    access_token, _auth_code_id = await _seed_live_launch_access(db_session)
    setting = (
        await db_session.execute(select(Setting).where(Setting.key == "tool_configs"))
    ).scalar_one()
    tools = json.loads(setting.value)
    tools[0]["script_status"] = "script_not_ready"
    setting.value = json.dumps(tools, ensure_ascii=False)
    await db_session.commit()

    response = await client.post(
        "/api/tools/live_tool/launch-grant",
        params={"platform_key": "amazon"},
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "message": "该工具的自动化脚本尚未就绪",
        "error_code": 3009,
        "detail": {
            "code": "TOOL_SCRIPT_NOT_READY",
            "reason": "script_not_ready",
            "script_status": "script_not_ready",
        },
    }
    assert (await db_session.execute(select(LaunchToken))).scalars().all() == []


@pytest.mark.asyncio
async def test_legacy_launch_token_paths_remain_compatible(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    access_token, _auth_code_id = await _seed_live_launch_access(db_session)

    created = await client.post(
        "/api/tools/live_tool/launch-token",
        params={"platform_key": "amazon"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert created.status_code == 200
    launch_token = created.json()["data"]["token"]

    verified = await client.post(
        "/api/tools/launch-token/verify",
        params={"token": launch_token},
    )
    assert verified.status_code == 200
    assert verified.json()["data"]["valid"] is True


@pytest.mark.asyncio
async def test_demo_mode_rejects_launch_grant_without_creating_state(
    client: AsyncClient,
    db_session,
):
    access_token, _auth_code_id = await _seed_live_launch_access(db_session)

    response = await client.post(
        "/api/tools/live_tool/launch-grant",
        params={"platform_key": "amazon"},
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "FEATURE_DISABLED",
        "message": "当前为演示模式，真实工具尚未接入",
        "reason": "demo_only",
    }
    assert (
        await db_session.execute(select(LaunchToken))
    ).scalars().all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["launch-grant", "launch-token"])
async def test_launch_verification_accepts_json_without_query_and_consumes_once(client, db_session, monkeypatch, endpoint):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    access_token, _ = await _seed_live_launch_access(db_session)
    created = await client.post("/api/tools/live_tool/launch-grant", params={"platform_key": "amazon"},
                                headers={"Authorization": f"Bearer {access_token}"})
    token = created.json()["data"]["token"]
    response = await client.post(f"/api/tools/{endpoint}/verify", json={"token": token},
                                 headers={"X-Toolbox-Version": "1.8.15"})
    assert response.status_code == 200
    assert response.json()["data"]["valid"] is True
    duplicate = await client.post(f"/api/tools/{endpoint}/verify", json={"token": token})
    assert duplicate.json()["success"] is False
    assert duplicate.json()["message"] == "Token 已使用"


@pytest.mark.asyncio
async def test_launch_verification_rejects_conflicting_credential_sources_without_consuming(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    access_token, _ = await _seed_live_launch_access(db_session)
    created = await client.post("/api/tools/live_tool/launch-grant", params={"platform_key": "amazon"},
                                headers={"Authorization": f"Bearer {access_token}"})
    token = created.json()["data"]["token"]
    conflict = await client.post("/api/tools/launch-grant/verify", params={"token": "different-token"}, json={"token": token})
    assert conflict.status_code == 400
    accepted = await client.post("/api/tools/launch-grant/verify", json={"token": token})
    assert accepted.json()["data"]["valid"] is True


@pytest.mark.asyncio
async def test_launch_verification_does_not_echo_missing_or_invalid_credentials(client, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    missing = await client.post("/api/tools/launch-grant/verify")
    assert missing.status_code == 422
    invalid = await client.post("/api/tools/launch-grant/verify", json={"token": "private-invalid-token"})
    assert invalid.status_code == 200
    assert invalid.json()["success"] is False
    assert "private-invalid-token" not in invalid.text


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["launch-grant", "launch-token"])
@pytest.mark.parametrize("invalid_token", [
    "private-validation-secret-" * 30,
    {"private-validation-secret": "do-not-echo"},
    ["private-validation-secret-do-not-echo"],
])
async def test_launch_validation_does_not_echo_token_input(client, endpoint, invalid_token):
    response = await client.post(f"/api/tools/{endpoint}/verify", json={"token": invalid_token})
    assert response.status_code == 422
    assert "private-validation-secret" not in response.text
    errors = response.json()["detail"]
    assert errors[0]["loc"] == ["body", "token"]
    assert errors[0]["type"] in {"string_too_long", "string_type"}
    assert errors[0]["msg"]
    assert "input" not in errors[0]
    assert "url" not in errors[0]
    if errors[0]["type"] == "string_too_long":
        assert errors[0]["ctx"] == {"max_length": 512}


@pytest.mark.asyncio
async def test_launch_validation_filter_does_not_change_other_api_errors(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    access_token, _ = await _seed_live_launch_access(db_session)
    response = await client.post(
        "/api/tools/live_tool/launch-grant",
        params={"platform_key": "amazon", "execution_mode": "invalid-mode-marker"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["input"] == "invalid-mode-marker"


@pytest.mark.asyncio
@pytest.mark.parametrize(("original_name", "expected_success"), [("Y49 Live launch test", True), ("定制套餐", False)])
async def test_live_and_legacy_launch_paths_use_fixed_identity_after_admin_rename(
    client, db_session, monkeypatch, auth_headers, original_name, expected_success,
):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    token, auth_code_id = await _seed_live_launch_access(db_session)
    auth_code = await db_session.get(AuthCode, auth_code_id)
    plan = await db_session.get(Plan, auth_code.plan_id)
    plan.name = original_name
    setting = (await db_session.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one()
    tools = json.loads(setting.value)
    tools[0]["available_plans"] = ["Y49"]
    setting.value = json.dumps(tools)
    await db_session.commit()
    # The new name is deliberately a valid restricted-tool entitlement name.
    renamed = await client.patch(f"/api/plans/{plan.id}", headers=auth_headers, json={"name": "Y49 伪装的新名称"})
    assert renamed.status_code == 200
    for path in ("launch-grant", "launch-token"):
        response = await client.post(f"/api/tools/live_tool/{path}", params={"platform_key": "amazon"},
                                     headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["success"] is expected_success
        if not expected_success:
            assert response.json()["message"] == "当前套餐暂未包含该工具"
    if not expected_success:
        assert (await db_session.execute(select(LaunchToken))).scalars().all() == []
