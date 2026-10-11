"""Tool catalog and launch-grant HTTP boundary."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_admin, get_current_user
from core.deprecation import log_deprecated_api_call
from database import get_db
from domains.automation import launch_service
from domains.catalog import normalize_tool_config as normalize_tool_config
from domains.catalog import resolve_tool_runtime as resolve_tool_runtime
from domains.catalog import service as catalog_service
from schemas.tools import (
    ConfigJsonValue,
    ConfigUpdateResponse,
    FeatureDisabledResponse,
    LaunchGrantResponse,
    LaunchGrantVerifyRequest,
    LaunchGrantVerifyResponse,
    ToolConfigUpdateResponse,
)


class LaunchVerifyRoute(APIRoute):
    """Limit credential-safe validation responses to the two verify endpoints."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()
        verify_paths = {"/launch-grant/verify", "/launch-token/verify",
                        "/api/tools/launch-grant/verify", "/api/tools/launch-token/verify"}
        if self.path not in verify_paths:
            return original

        async def safe_verify_handler(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError as exc:
                errors = []
                for error in exc.errors():
                    error_type = error["type"]
                    messages = {
                        "missing": "Field required",
                        "string_type": "Input should be a valid string",
                        "string_too_long": "String exceeds the allowed maximum length",
                        "string_too_short": "String is shorter than the allowed minimum length",
                        "model_attributes_type": "Input should be a valid dictionary or object",
                        "json_invalid": "JSON decode error",
                    }
                    # Never stringify input or arbitrary ValueError/parser ctx;
                    # either can contain the complete credential on failure.
                    safe_error = {"type": error_type, "loc": error["loc"],
                                  "msg": messages.get(error_type, "Invalid launch authorization request")}
                    safe_ctx = {key: value for key, value in error.get("ctx", {}).items()
                                if key in {"min_length", "max_length"} and isinstance(value, int)}
                    if safe_ctx:
                        safe_error["ctx"] = safe_ctx
                    errors.append(safe_error)
                return JSONResponse(status_code=422, content={"detail": errors})

        return safe_verify_handler


router = APIRouter(route_class=LaunchVerifyRoute)


@router.get("/categories", response_model=list[ConfigJsonValue])
async def get_tool_categories(db: AsyncSession = Depends(get_db)) -> list[Any]:
    """获取工具分类列表"""
    return await catalog_service.list_categories(db)


@router.get("", response_model=list[ConfigJsonValue])
async def get_tools(
    category: str | None = Query(None, description="分类ID"),
    search: str | None = Query(None, description="搜索关键词"),
    platform_key: str | None = Query(None, description="平台: amazon / aliexpress"),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """获取工具配置列表，支持分类、搜索和平台筛选"""
    return await catalog_service.list_tools(
        db,
        category=category,
        search=search,
        platform_key=platform_key,
    )


@router.put("", response_model=ToolConfigUpdateResponse)
async def update_tools(
    request: Request,
    tools: list[dict[str, JsonValue]] = Body(...),
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """更新工具配置"""
    return await catalog_service.update_tools(
        db,
        tools,
        actor=actor,
        request=request,
    )


@router.put("/categories", response_model=ConfigUpdateResponse)
async def update_tool_categories(
    categories: list[JsonValue],
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, bool]:
    """更新工具分类配置"""
    return await catalog_service.update_categories(
        db,
        categories,
        actor=actor,
        request=request,
    )


@router.get("/platforms", response_model=list[ConfigJsonValue])
async def get_platforms(db: AsyncSession = Depends(get_db)) -> list[Any]:
    """获取平台配置列表"""
    return await catalog_service.list_platforms(db)


@router.put("/platforms", response_model=ConfigUpdateResponse)
async def update_platforms(
    platforms: list[JsonValue],
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, bool]:
    """更新平台配置（管理员）"""
    return await catalog_service.update_platforms(
        db,
        platforms,
        actor=actor,
        request=request,
    )


@router.post(
    "/{tool_id}/launch-grant",
    response_model=LaunchGrantResponse,
    response_model_exclude_unset=True,
    responses={409: {"model": FeatureDisabledResponse}},
)
@router.post(
    "/{tool_id}/launch-token",
    response_model=LaunchGrantResponse,
    response_model_exclude_unset=True,
    responses={409: {"model": FeatureDisabledResponse}},
)
async def create_launch_token(
    request: Request,
    tool_id: str,
    platform_key: str,
    execution_mode: str = Query("single", pattern="^(single|batch)$"),
    client_batch_id: str | None = Query(None, max_length=100),
    client_item_id: str | None = Query(None, max_length=100),
    idempotency_key: str | None = Query(None, max_length=200),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """创建工具一次性启动授权；旧 launch-token 路径继续兼容。"""
    if request.url.path.endswith("/launch-token"):
        log_deprecated_api_call(request, "/api/tools/{tool_id}/launch-token")
    return await launch_service.create_launch_grant(
        db,
        tool_id=tool_id,
        platform_key=platform_key,
        execution_mode=execution_mode,
        client_batch_id=client_batch_id,
        client_item_id=client_item_id,
        idempotency_key=idempotency_key,
        current_user=current_user,
    )


@router.post(
    "/launch-grant/verify",
    response_model=LaunchGrantVerifyResponse,
    response_model_exclude_unset=True,
    responses={409: {"model": FeatureDisabledResponse}},
)
@router.post(
    "/launch-token/verify",
    response_model=LaunchGrantVerifyResponse,
    response_model_exclude_unset=True,
    responses={409: {"model": FeatureDisabledResponse}},
)
async def verify_launch_token(
    request: Request,
    body: LaunchGrantVerifyRequest | None = Body(None),
    token: str | None = Query(None, deprecated=True, description="旧客户端 query 协议，保留至 1.9.0；新版使用 JSON body"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """验证并消费一次性启动授权；旧路径和 query 协议兼容至 1.9.0。"""
    if request.url.path.endswith("/launch-token/verify"):
        log_deprecated_api_call(request, "/api/tools/launch-token/verify")
    if token is not None:
        log_deprecated_api_call(request, "/api/tools/launch-grant/verify?token")
    if body is not None and token is not None and body.token != token:
        raise HTTPException(status_code=400, detail="启动授权来源冲突")
    grant_token = body.token if body is not None else token
    if not grant_token:
        raise HTTPException(status_code=422, detail="缺少启动授权")
    return await launch_service.verify_launch_grant(db, grant_token)
