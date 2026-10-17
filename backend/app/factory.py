from __future__ import annotations

import os
import platform
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.lifecycle import lifespan
from app.middleware import RequestTrackingMiddleware
from core.cache import cache
from core.config import settings
from core.exceptions import register_exception_handlers
from core.logging import redact_sensitive
from core.rate_limit import ApplicationRateLimitMiddleware, RateLimitStorageUnavailable, limiter
from core.security import configure_cors
from core.tasks import task_manager
from database import check_db_health, get_db_stats
from routers import (
    admin_action_center,
    agency,
    ai_chat,
    announcements,
    auth,
    auth_codes,
    business,
    commercial,
    dashboard,
    demo,
    devices,
    executions,
    expenses,
    feedback,
    freight_rate_packs,
    identity,
    knowledge,
    logs,
    orders,
    plans,
    profit,
    scenarios,
    staff,
    team_ledger,
    tool_releases,
    tools,
    updates,
    users,
)
from routers import (
    help as help_router,
)
from routers import (
    settings as settings_router,
)


def _register_routers(app: FastAPI) -> None:
    routes = (
        (auth.router, "/api/auth", ["认证"]),
        (staff.router, "/api/staff", ["后台账号"]),
        (agency.router, "/api/agency", ["代理工作台"]),
        (dashboard.router, "/api/dashboard", ["数据看板"]),
        (plans.router, "/api/plans", ["套餐管理"]),
        (commercial.router, "/api/commercial", ["版本化商品与履约"]),
        (scenarios.router, "/api/scenarios", ["场景策略与本机权限"]),
        (team_ledger.router, "/api/team-ledger", ["成员结算台账"]),
        (auth_codes.router, "/api/auth-codes", ["授权码管理"]),
        (orders.router, "/api/orders", ["订单管理"]),
        (users.router, "/api/users", ["用户管理"]),
        (logs.router, "/api/logs", ["运行日志"]),
        (feedback.router, "/api/feedback", ["工单反馈"]),
        (freight_rate_packs.router, "/api/freight-rate-packs", ["物流费率版本"]),
        (profit.router, "/api/profit", ["分润管理"]),
        (settings_router.router, "/api/settings", ["系统设置"]),
        (tools.router, "/api/tools", ["工具配置"]),
        (updates.router, "/api/updates", ["自动更新"]),
        (devices.router, "/api/devices", ["设备管理"]),
        (demo.router, "/api/demo", ["演示流程"]),
        (executions.router, "/api/executions", ["真实执行记录"]),
        (expenses.router, "/api/expenses", ["公账支出"]),
        (knowledge.router, "/api/knowledge", ["知识库管理"]),
        (ai_chat.router, "/api/ai-chat", ["AI客服"]),
        (announcements.router, "/api/announcements", ["公告管理"]),
        (tool_releases.router, "/api/tool-releases", ["工具版本发布"]),
        (business.router, "/api/business", ["专业批量工作台"]),
        (admin_action_center.router, "/api/admin", ["管理行动中心"]),
        (help_router.router, "/api/help", ["帮助查询"]),
        (identity.router, "/api/identity", ["账号现场与身份占用"]),
    )
    for router, prefix, tags in routes:
        app.include_router(router, prefix=prefix, tags=tags)


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=lifespan,
        docs_url="/api/docs" if settings.DEBUG else None,
        redoc_url="/api/redoc" if settings.DEBUG else None,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    configure_cors(app)
    # Health diagnostics must remain available when the distributed limiter's
    # Redis is offline. Keep a separate bounded, process-local probe limit.
    probe_limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    async def limiter_unavailable(_request: Request, _error: RateLimitStorageUnavailable) -> JSONResponse:
        return JSONResponse(status_code=503, content={"success": False, "message": "限流服务暂不可用，请稍后重试"},
                            headers={"Retry-After": "5"})

    app.add_exception_handler(RateLimitStorageUnavailable, limiter_unavailable)
    app.add_middleware(ApplicationRateLimitMiddleware)
    register_exception_handlers(app)
    app.add_middleware(RequestTrackingMiddleware)
    _register_routers(app)

    async def readiness_snapshot() -> dict[str, Any]:
        database = redact_sensitive({**await check_db_health(), "required": True})
        health: dict[str, Any] = {
            "status": "ok" if database["status"] == "ok" else "degraded",
            "version": settings.APP_VERSION,
            "commit_sha": settings.COMMIT_SHA,
            "release_id": settings.RELEASE_ID,
            "checks": {"database": database},
        }
        redis = {**await cache.check_health(), "required": settings.REDIS_REQUIRED}
        if settings.REDIS_REQUIRED and redis["status"] == "not_configured":
            redis.update(status="error", error="Redis 是必需依赖但未配置")
        health["checks"]["redis"] = redis
        if redis["status"] == "error":
            health["status"] = "degraded"
        health["ready"] = database["status"] == "ok" and (
            not settings.REDIS_REQUIRED or redis["status"] == "ok"
        )
        health["checks"]["pool"] = (await get_db_stats()).get("pool", {})
        health["checks"]["tasks"] = {"pending": task_manager.pending_count}
        return health

    @app.get("/api/health/live")
    @limiter.exempt
    @probe_limiter.limit("60/minute")
    async def health_live(request: Request) -> dict[str, Any]:
        del request
        return {
            "status": "ok",
            "version": settings.APP_VERSION,
            "commit_sha": settings.COMMIT_SHA,
            "release_id": settings.RELEASE_ID,
        }

    @app.get(
        "/api/health/ready",
        response_model=dict[str, Any],
        responses={503: {"description": "必需依赖不可用，服务尚未就绪"}},
    )
    @limiter.exempt
    @probe_limiter.limit("30/minute")
    async def health_ready(request: Request) -> Any:
        del request
        snapshot = await readiness_snapshot()
        if not snapshot["ready"]:
            return JSONResponse(status_code=503, content=snapshot)
        return snapshot

    @app.get("/api/health")
    @limiter.exempt
    @probe_limiter.limit("30/minute")
    async def health_check(request: Request) -> dict[str, Any]:
        del request
        return await readiness_snapshot()

    @app.get("/api/system-info")
    @limiter.limit("10/minute")
    async def system_info(request: Request) -> dict[str, Any]:
        del request
        return {
            "app": {
                "name": settings.APP_NAME,
                "version": settings.APP_VERSION,
                "commit_sha": settings.COMMIT_SHA,
                "release_id": settings.RELEASE_ID,
            },
            "runtime": {"python": platform.python_version(), "platform": platform.platform()},
            "database": {"type": settings.DB_TYPE},
            "cache": {"enabled": cache.redis is not None, "type": "redis" if cache.redis else "memory"},
            "features": {"rate_limit": True, "gzip": True, "request_tracking": True, "token_blacklist": True},
        }

    updates_directory = Path(os.path.dirname(os.path.dirname(__file__))) / "updates"
    updates_directory.mkdir(parents=True, exist_ok=True)
    app.mount("/updates", StaticFiles(directory=updates_directory), name="updates")
    return app
