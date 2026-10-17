"""
认证路由模块（优化版）
使用服务层 + 统一响应格式
"""

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import _validate_user_session, get_current_user
from core.rate_limit import limiter as auth_limiter
from core.security import create_access_token, verify_token
from core.token_blacklist import is_token_blacklisted
from database import get_db
from domains.access import effective_license_status
from domains.auth import AuthService
from models import AuthCode
from schemas.auth import (
    AdminLoginRequest,
    AdminLoginResponse,
    AuthStatusResponse,
    CurrentUserInfoResponse,
    RefreshTokenResponse,
    VerifyRequest,
    VerifyResponse,
)

router = APIRouter()


@router.post("/verify", response_model=VerifyResponse, response_model_exclude_unset=True)
@auth_limiter.limit("10/minute")  # 每分钟最多10次尝试
async def verify_auth_code(
    request: Request,
    req: VerifyRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """授权码验证（用户登录）"""
    service = AuthService(db)
    return await service.verify_auth_code(req.code, req.device_id, req.device_name)


@router.post(
    "/admin-login",
    response_model=AdminLoginResponse,
    response_model_exclude_unset=True,
)
@auth_limiter.limit("5/minute")  # 管理员登录更严格：每分钟5次
async def admin_login(
    request: Request,
    req: AdminLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """兼容旧客户端的后台登录 URL；身份数据只来自 staff_users。"""
    service = AuthService(db)
    return await service.admin_login(req.password, req.username, request=request)


@router.post("/check", response_model=AuthStatusResponse, response_model_exclude_unset=True)
async def check_auth_status(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """检查授权码状态（用于踢人检测）"""
    if current_user.get("staff_id"):
        return {
            "success": True,
            "message": "后台账号正常",
            "data": current_user,
        }
    service = AuthService(db)
    return await service.check_auth_status(current_user.get("auth_code_id"))


@router.get(
    "/me",
    response_model=CurrentUserInfoResponse,
    response_model_exclude_unset=True,
)
async def get_current_user_info(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """获取当前用户信息"""
    if current_user.get("staff_id"):
        return {"success": True, "message": "ok", "data": current_user}
    service = AuthService(db)
    return await service.get_user_info(
        cast(int, current_user.get("user_id")), current_user.get("auth_code_id"), cast(str, current_user.get("role"))
    )


# 可选的 JWT 认证（用于 refresh，需要获取原始 Token）
optional_security = HTTPBearer(auto_error=True)


@router.post("/refresh", response_model=RefreshTokenResponse)
async def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(optional_security),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """刷新 Token

    安全检查:
    1. 验证当前 Token 是否在黑名单中
    2. 验证用户授权码是否仍然有效
    """
    token = credentials.credentials

    # 1. 检查 Token 是否在黑名单中
    if await is_token_blacklisted(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 已失效，请重新登录")

    # 2. 验证 Token 有效性
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 无效")

    user_id = payload.get("user_id")
    role = payload.get("role", "user")
    auth_code_id = payload.get("auth_code_id")
    device_id = payload.get("device_id")

    if payload.get("token_type") == "staff":
        # Staff sessions have a hard eight-hour lifetime.  Refreshing a still
        # valid staff JWT would silently turn that into an indefinite session.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "FEATURE_DISABLED",
                "message": "后台登录固定有效 8 小时，不提供刷新，请重新登录",
            },
        )

    # Customer JWTs are backed by one server-visible device session. Refresh
    # must not keep a token alive after another device has taken the session.
    if role == "user":
        await _validate_user_session(
            db,
            payload,
            user_id=int(user_id) if user_id is not None else 0,
            strict=True,
        )

    # 4. 检查授权码是否仍然有效（防止授权码被冻结/删除后仍可刷新）
    if auth_code_id:
        result = await db.execute(select(AuthCode).where(AuthCode.id == auth_code_id))
        auth_code = result.scalars().first()

        if not auth_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="授权码不存在")

        if auth_code.status == "frozen":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="授权码已被冻结")

        if auth_code.status == "deleted":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="授权码已被删除")

        if effective_license_status(auth_code) == "expired":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="授权码已过期")

    # 5. 签发新 Token
    new_token = create_access_token(
        data={
            "user_id": user_id,
            "role": role,
            "auth_code_id": auth_code_id,
            "device_id": device_id,
            "session_id": payload.get("session_id"),
            "session_token": payload.get("session_token"),
        }
    )
    return {"success": True, "data": {"token": new_token}}
