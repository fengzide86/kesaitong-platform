"""Authentication and fixed-role authorization dependencies."""

from collections.abc import Callable
from datetime import datetime

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.capabilities import has_capability, roles_with
from core.logging import set_user_id
from core.security import verify_token
from database import get_db
from domains.access.identity_leases import AuthSessionNotFound, validate_auth_session
from models import Agency, AuthCode, AuthSession, StaffRole, StaffStatus, StaffUser, User
from services.staff_service import staff_to_dict

security = HTTPBearer(auto_error=False)


def _unauthorized(message: str = "登录已过期，请重新登录") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _resolve_staff_payload(
    db: AsyncSession,
    payload: dict,
) -> dict | None:
    if payload.get("token_type") != "staff":
        return None
    staff_id = payload.get("staff_id")
    token_version = payload.get("token_version")
    if not staff_id or token_version is None:
        return None

    result = await db.execute(select(StaffUser).where(StaffUser.id == staff_id))
    staff = result.scalar_one_or_none()
    if (
        not staff
        or staff.status != StaffStatus.ACTIVE
        or staff.token_version != token_version
        or staff.role not in StaffRole.ALL
    ):
        return None
    context = staff_to_dict(staff)
    set_user_id(staff.id)
    return context


async def get_authenticated_staff(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Resolve an active staff token, including password-reset-only sessions."""

    if not credentials:
        raise _unauthorized("请先登录后台账号")
    payload = verify_token(credentials.credentials)
    if not payload:
        raise _unauthorized()
    staff = await _resolve_staff_payload(db, payload)
    if not staff:
        raise _unauthorized("后台账号凭证已失效")
    return staff


async def get_current_staff(
    staff: dict = Depends(get_authenticated_staff),
) -> dict:
    if staff.get("force_password_reset"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="首次登录或密码重置后必须先修改密码",
        )
    return staff


def require_staff_roles(*roles: str) -> Callable:
    allowed = frozenset(roles)
    if not allowed or not allowed.issubset(StaffRole.ALL):
        raise ValueError("require_staff_roles 收到无效角色")

    async def dependency(staff: dict = Depends(get_current_staff)) -> dict:
        if staff.get("role") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="当前后台角色无权执行此操作",
            )
        return staff

    return dependency


def require_staff_capability(capability: str) -> Callable:
    """Build a dependency from the shared matrix, retaining stable role errors."""

    allowed = roles_with(capability, StaffRole.ALL)
    if not allowed:
        raise ValueError(f"未知后台能力: {capability}")
    return require_staff_roles(*allowed)


require_super_admin = require_staff_capability("settings.manage")
require_commerce_operator = require_staff_capability("expenses.write")
require_any_staff = require_staff_capability("backoffice.read")


async def _validate_user_session(
    db: AsyncSession,
    payload: dict,
    *,
    user_id: int,
    strict: bool,
) -> dict | None:
    """Validate the server session bound to a customer JWT.

    New tokens carry both the opaque session id and its bearer token as JWT
    claims. Legacy tokens have neither claim; while they remain accepted for
    compatibility, an active server session on another device invalidates
    them so a second device cannot keep using the same authorization.
    """

    session_id = payload.get("session_id")
    session_token = payload.get("session_token")
    if bool(session_id) != bool(session_token):
        if strict:
            raise _unauthorized("登录会话凭证不完整，请重新登录")
        return None

    if session_id and session_token:
        try:
            session = await validate_auth_session(
                db,
                session_id=str(session_id),
                session_token=str(session_token),
                touch=True,
            )
        except AuthSessionNotFound:
            if strict:
                raise _unauthorized("登录会话已失效，请重新登录") from None
            return None
        if (
            session.get("principal_kind") != "user"
            or session.get("principal_id") != user_id
            or session.get("device_id") != payload.get("device_id")
            or (
                payload.get("auth_code_id") is not None
                and session.get("auth_code_id") not in {None, payload.get("auth_code_id")}
            )
        ):
            if strict:
                raise _unauthorized("登录会话与当前授权不匹配，请重新登录")
            return None
        return session

    # Legacy JWT fallback: once a server session exists, reject tokens from a
    # different device. No active row means this is an older installation and
    # the historical token path remains compatible.
    active = (
        await db.execute(
            select(AuthSession).where(
                AuthSession.principal_kind == "user",
                AuthSession.principal_id == user_id,
                AuthSession.active_guard == "held",
                AuthSession.status == "active",
                AuthSession.expires_at > datetime.utcnow(),
            )
        )
    ).scalars().first()
    if active is not None and active.device_id != payload.get("device_id"):
        if strict:
            raise _unauthorized("该授权已在其他设备登录，请先退出原设备")
        return None
    return active and {"session_id": active.session_id}


async def require_agency_staff(
    staff: dict = Depends(get_current_staff),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Partner scopes never inherit the internal administrator compatibility path."""
    if staff["role"] == StaffRole.SUPER_ADMIN:
        return staff
    if (
        staff["role"] != StaffRole.AGENT
        or not staff.get("agency_id")
        or not has_capability(staff.get("role"), "agency.workspace.read")
    ):
        raise HTTPException(status_code=403, detail="当前账号无代理工作台权限")
    agency = await db.get(Agency, staff["agency_id"])
    if not agency or agency.status != "active":
        raise HTTPException(status_code=403, detail="代理合作已停用，请联系平台负责人")
    return staff


async def get_current_admin(
    request: Request,
    staff: dict = Depends(get_current_staff),
) -> dict:
    """Compatibility dependency for older admin routes.

    This closes legacy routes against the same fixed matrix used by new routes.
    New commerce routes still use explicit role dependencies.
    """

    role = staff["role"]
    if role not in StaffRole.INTERNAL:
        raise HTTPException(status_code=403, detail="代理账号不能访问内部管理接口")
    if role == StaffRole.SUPER_ADMIN:
        return staff
    path = request.url.path

    # Settings, updater/release control and audit data are super-admin only,
    # including reads. Operational run logs are intentionally not audit logs.
    super_only_prefixes = {
        "/api/settings": "settings.manage",
        "/api/updates": "updates.manage",
        "/api/tool-releases": "updates.manage",
        "/api/freight-rate-packs": "settings.manage",
        "/api/audit": "settings.manage",
        "/api/audit-logs": "settings.manage",
    }
    if any(path.startswith(prefix) for prefix in super_only_prefixes) and not has_capability(
        role,
        next(capability for prefix, capability in super_only_prefixes.items() if path.startswith(prefix)),
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="该模块仅超级管理员可访问",
        )

    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return staff

    operator_mutation_prefixes = {
        "/api/auth-codes": "auth_codes.write",
        "/api/users": "users.write",
        "/api/devices/unbind": "devices.unbind",
        "/api/feedback": "feedback.write",
        "/api/knowledge": "knowledge.write",
        "/api/ai-chat": "rules.write",
        "/api/dashboard/refresh-cache": "backoffice.read",
    }
    if role == StaffRole.OPERATOR:
        if any(path.startswith(prefix) and has_capability(role, capability) for prefix, capability in operator_mutation_prefixes.items()):
            return staff
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="运营角色对该模块仅可查看",
        )

    support_mutation_prefixes = {
        "/api/announcements": "announcements.write",
        "/api/feedback": "feedback.write",
        "/api/knowledge": "knowledge.write",
        "/api/ai-chat": "rules.write",
    }
    if role == StaffRole.SUPPORT and (
        any(path.startswith(prefix) and has_capability(role, capability) for prefix, capability in support_mutation_prefixes.items())
        or (path == "/api/devices/unbind" and has_capability(role, "devices.unbind"))
    ):
        return staff
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="当前后台角色无权执行此操作",
    )


async def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> dict | None:
    if not credentials:
        return None
    payload = verify_token(credentials.credentials)
    if not payload:
        return None

    staff = await _resolve_staff_payload(db, payload)
    if staff:
        if staff["role"] == StaffRole.AGENT:
            raise HTTPException(status_code=403, detail="代理账号不能作为客户身份操作")
        return staff
    if payload.get("token_type") == "staff":
        return None

    user_id = payload.get("user_id")
    if not user_id:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    session = await _validate_user_session(db, payload, user_id=user.id, strict=False)
    if payload.get("session_id") and session is None:
        return None
    set_user_id(user.id)
    return {
        "user_id": user.id,
        "role": "user",
        "auth_code_id": user.auth_code_id,
        "device_id": payload.get("device_id"),
        "session_id": session.get("session_id") if session else None,
    }


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not credentials:
        raise _unauthorized("请先登录")
    payload = verify_token(credentials.credentials)
    if not payload:
        raise _unauthorized()

    staff = await _resolve_staff_payload(db, payload)
    if staff:
        if staff["role"] == StaffRole.AGENT:
            raise HTTPException(status_code=403, detail="代理账号不能作为客户身份操作")
        return staff
    if payload.get("token_type") == "staff":
        raise _unauthorized("后台账号凭证已失效")

    user_id = payload.get("user_id")
    if not user_id:
        raise _unauthorized("Token 数据无效")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise _unauthorized("用户不存在或已停用")
    session = await _validate_user_session(db, payload, user_id=user.id, strict=True)
    set_user_id(user.id)
    return {
        "user_id": user.id,
        "role": "user",
        "auth_code_id": user.auth_code_id,
        "device_id": payload.get("device_id"),
        "session_id": session.get("session_id") if session else None,
    }


async def verify_auth_code_active(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    auth_code_id = current_user.get("auth_code_id")
    if not auth_code_id:
        return current_user
    result = await db.execute(select(AuthCode).where(AuthCode.id == auth_code_id))
    auth_code = result.scalar_one_or_none()
    if not auth_code:
        raise HTTPException(status_code=403, detail="授权码不存在")
    if auth_code.status != "active":
        raise HTTPException(status_code=403, detail=f"授权码状态异常: {auth_code.status}")
    return current_user
