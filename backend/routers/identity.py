"""Account identity leases and safe login-session boundaries.

The endpoints in this module coordinate a browser *slot*, not credentials.
External account identifiers are accepted only long enough to derive a
one-way hash. Passwords, cookies, MFA codes and access tokens are never
accepted or returned by these routes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user, require_any_staff, require_staff_capability
from database import get_db
from domains.access import (
    IdentityLeaseConflict,
    IdentityLeaseNeedsRelogin,
    IdentityLeaseNotFound,
    acquire_identity_lease,
    heartbeat_identity_lease,
    list_identity_leases,
    release_identity_lease,
    takeover_customer_binding,
)
from models import AuthCode, ExternalAccountLease
from schemas.identity import (
    AccountBindingTakeoverEnvelope,
    AccountBindingTakeoverRequest,
    AccountLeaseAcquireEnvelope,
    AccountLeaseAcquireRequest,
    AccountLeaseEnvelope,
    AccountLeaseHeartbeatRequest,
    AccountLeaseListEnvelope,
)

router = APIRouter()


def _identity_error(exc: Exception) -> HTTPException:
    if isinstance(exc, IdentityLeaseConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, IdentityLeaseNeedsRelogin):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, IdentityLeaseNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="账号现场操作失败")


def _staff_id(actor: dict[str, Any]) -> int | None:
    value = actor.get("staff_id")
    return int(value) if value is not None else None


async def _owned_lease(
    db: AsyncSession,
    lease_id: int,
    actor: dict[str, Any],
) -> ExternalAccountLease:
    row = await db.get(ExternalAccountLease, lease_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号现场不存在")
    staff_id = _staff_id(actor)
    if staff_id is not None:
        allowed = row.owner_kind == "staff" and row.owner_id == staff_id
    else:
        user_id = actor.get("user_id")
        allowed = row.owner_kind == "user" and user_id is not None and row.owner_id == int(user_id)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="不能操作其他账号的现场")
    return row


@router.post("/leases", response_model=AccountLeaseAcquireEnvelope)
async def acquire_lease(
    req: AccountLeaseAcquireRequest,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_user),
) -> dict[str, object]:
    """Open one isolated external-account slot for a customer or staff user."""

    staff_id = _staff_id(actor)
    if staff_id is None:
        owner_kind = "user"
        owner_id = actor.get("user_id")
        auth_code_id = actor.get("auth_code_id")
        if not owner_id or not auth_code_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前登录没有可用授权")
        token_device_id = actor.get("device_id")
        if token_device_id and token_device_id != req.device_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="现场设备与当前登录不一致")
        if req.takeover:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户不能接管其他账号现场")
        takeover_actor_id = None
    else:
        owner_kind = "staff"
        owner_id = staff_id
        auth_code_id = None
        takeover_actor_id = staff_id if req.takeover else None

    try:
        data = await acquire_identity_lease(
            db,
            owner_kind=owner_kind,
            owner_id=int(owner_id),
            auth_code_id=int(auth_code_id) if auth_code_id is not None else None,
            device_id=req.device_id,
            workspace_id=req.workspace_id,
            account_slot=req.account_slot,
            scene_id=req.scene_id,
            site_origin=req.site_origin,
            external_account_ref=req.external_account_ref,
            takeover=req.takeover,
            takeover_actor_id=takeover_actor_id,
        )
    except (IdentityLeaseConflict, IdentityLeaseNeedsRelogin, IdentityLeaseNotFound, ValueError) as exc:
        raise _identity_error(exc) from exc
    return {"success": True, "message": "账号现场已锁定", "data": data}


@router.get("/leases", response_model=AccountLeaseListEnvelope)
async def get_leases(
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_user),
) -> dict[str, object]:
    """List the caller's own slots; staff sees its own slots only by default."""

    staff_id = _staff_id(actor)
    if staff_id is not None:
        rows = await list_identity_leases(db, owner_kind="staff", owner_id=staff_id)
    else:
        user_id = actor.get("user_id")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前登录无用户身份")
        rows = await list_identity_leases(db, owner_kind="user", owner_id=int(user_id))
    return {"success": True, "message": "ok", "data": rows}


@router.post("/leases/{lease_id}/heartbeat", response_model=AccountLeaseEnvelope)
async def heartbeat_lease(
    lease_id: int,
    req: AccountLeaseHeartbeatRequest,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_user),
) -> dict[str, object]:
    await _owned_lease(db, lease_id, actor)
    try:
        data = await heartbeat_identity_lease(db, lease_id=lease_id, lease_token=req.lease_token)
    except (IdentityLeaseConflict, IdentityLeaseNeedsRelogin, IdentityLeaseNotFound, ValueError) as exc:
        raise _identity_error(exc) from exc
    return {"success": True, "message": "账号现场仍有效", "data": data}


@router.post("/leases/{lease_id}/release")
async def release_lease(
    lease_id: int,
    req: AccountLeaseHeartbeatRequest,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_user),
) -> dict[str, object]:
    await _owned_lease(db, lease_id, actor)
    try:
        await release_identity_lease(db, lease_id=lease_id, lease_token=req.lease_token)
    except (IdentityLeaseConflict, IdentityLeaseNeedsRelogin, IdentityLeaseNotFound, ValueError) as exc:
        raise _identity_error(exc) from exc
    return {"success": True, "message": "账号现场已结束", "data": None}


@router.get("/admin/leases", response_model=AccountLeaseListEnvelope)
async def list_admin_leases(
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(require_any_staff),
) -> dict[str, object]:
    """List all active/history slots for the administrator workbench."""

    staff_id = _staff_id(actor)
    if staff_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可查看全部账号现场")
    rows = await list_identity_leases(db)
    return {"success": True, "message": "ok", "data": rows}


@router.post(
    "/admin/bindings/{auth_code_id}/takeover",
    response_model=AccountBindingTakeoverEnvelope,
)
async def takeover_binding(
    auth_code_id: int,
    req: AccountBindingTakeoverRequest,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(require_staff_capability("users.write")),
) -> dict[str, object]:
    """Explicitly rebind a customer authorization after a support decision."""

    staff_id = _staff_id(actor)
    if staff_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可重新绑定客户账号")
    if await db.get(AuthCode, auth_code_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="授权码不存在")
    try:
        data = await takeover_customer_binding(
            db,
            staff_id=staff_id,
            auth_code_id=auth_code_id,
            site_origin=req.site_origin,
            external_account_ref=req.external_account_ref,
            reason=req.reason,
        )
    except (IdentityLeaseConflict, IdentityLeaseNeedsRelogin, IdentityLeaseNotFound, ValueError) as exc:
        raise _identity_error(exc) from exc
    return {"success": True, "message": "客户账号已重新绑定", "data": data}
