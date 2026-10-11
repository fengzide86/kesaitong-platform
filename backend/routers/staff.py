"""Internal staff authentication and fixed-role account management."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_authenticated_staff, require_super_admin
from core.rate_limit import limiter
from database import get_db
from models import StaffUser
from schemas.staff import (
    StaffAccountCreate,
    StaffAccountEnvelope,
    StaffAccountListEnvelope,
    StaffAccountResponse,
    StaffAccountUpdate,
    StaffLogin,
    StaffMeEnvelope,
    StaffOperationEnvelope,
    StaffPasswordChange,
    StaffPasswordReset,
    StaffSessionEnvelope,
)
from services import staff_service

router = APIRouter()


def _session_data(staff: StaffUser) -> dict[str, object]:
    return {
        "token": staff_service.create_staff_access_token(staff),
        **staff_service.staff_to_dict(staff),
    }


@router.post("/auth/login", response_model=StaffSessionEnvelope)
@limiter.limit("5/minute")
async def login(
    req: StaffLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    staff = await staff_service.authenticate_staff(db, req.username, req.password, request=request)
    if not staff:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号、密码或账号状态无效",
        )
    return {"success": True, "message": "登录成功", "data": _session_data(staff)}


@router.get("/auth/me", response_model=StaffMeEnvelope)
async def me(
    staff: dict[str, Any] = Depends(get_authenticated_staff),
) -> dict[str, object]:
    return {"success": True, "message": "ok", "data": staff}


@router.post("/auth/change-password", response_model=StaffSessionEnvelope)
async def change_password(
    req: StaffPasswordChange,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_authenticated_staff),
) -> dict[str, object]:
    staff = await staff_service.change_password(db, req, actor=actor, request=request)
    return {
        "success": True,
        "message": "密码已修改，其他登录凭证已失效",
        "data": _session_data(staff),
    }


@router.post(
    "/auth/logout",
    response_model=StaffOperationEnvelope,
    response_model_exclude_unset=True,
)
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_authenticated_staff),
) -> dict[str, object]:
    await staff_service.logout_staff(db, actor=actor, request=request)
    return {"success": True, "message": "已退出，当前账号全部旧凭证已失效"}


@router.get("/accounts", response_model=StaffAccountListEnvelope)
async def list_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str = Query("", max_length=100),
    db: AsyncSession = Depends(get_db),
    _actor: dict[str, Any] = Depends(require_super_admin),
) -> dict[str, object]:
    accounts, total = await staff_service.list_accounts(db, page=page, page_size=page_size, keyword=q)
    return {
        "success": True,
        "message": "ok",
        "data": [account.model_dump(mode="json") for account in accounts],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@router.post(
    "/accounts",
    status_code=status.HTTP_201_CREATED,
    response_model=StaffAccountEnvelope,
)
async def create_account(
    req: StaffAccountCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(require_super_admin),
) -> dict[str, object]:
    account = await staff_service.create_account(db, req, actor=actor, request=request)
    return {
        "success": True,
        "message": "账号已创建；首次登录必须修改密码",
        "data": StaffAccountResponse.model_validate(account).model_dump(mode="json"),
    }


@router.patch("/accounts/{staff_id}", response_model=StaffAccountEnvelope)
async def update_account(
    staff_id: int,
    req: StaffAccountUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(require_super_admin),
) -> dict[str, object]:
    account = await staff_service.update_account(
        db,
        staff_id,
        req,
        actor=actor,
        request=request,
    )
    return {
        "success": True,
        "message": "账号已更新",
        "data": StaffAccountResponse.model_validate(account).model_dump(mode="json"),
    }


@router.post(
    "/accounts/{staff_id}/reset-password",
    response_model=StaffOperationEnvelope,
    response_model_exclude_unset=True,
)
async def reset_password(
    staff_id: int,
    req: StaffPasswordReset,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(require_super_admin),
) -> dict[str, object]:
    await staff_service.reset_password(db, staff_id, req, actor=actor, request=request)
    return {
        "success": True,
        "message": "密码已重置；旧凭证已失效，首次登录必须修改密码",
    }
