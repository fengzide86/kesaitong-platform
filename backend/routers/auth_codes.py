"""Authorization-code administration routes."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_admin
from core.logging import get_logger
from database import get_db
from domains.access import auth_codes as auth_code_service
from schemas import AuthCodeGenerate, AuthCodeResponse, AuthCodeUpdate
from schemas.auth_code import (
    AuthCodeBatchGenerateResponse,
    AuthCodeDeleteResponse,
    AuthCodeExtend,
    AuthCodePageResponse,
)

logger = get_logger(__name__)
router = APIRouter()


@router.get("", response_model=AuthCodePageResponse)
async def get_auth_codes(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
    platform_key: str | None = None,
    include_deleted: bool = Query(False),
    keyword: str | None = Query(None, max_length=200),
    product_type: Literal["consumer", "business"] | None = Query(None),
    status: Literal["unused", "active", "frozen", "expired", "deleted"] | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, object]:
    return await auth_code_service.list_codes(
        db,
        page=page,
        page_size=page_size,
        platform_key=platform_key,
        include_deleted=include_deleted,
        keyword=keyword,
        product_type=product_type,
        status=status,
    )


@router.get("/{code_id}", response_model=AuthCodeResponse)
async def get_auth_code_detail(
    code_id: int,
    platform_key: str | None = Query(None, pattern="^(amazon|aliexpress)$"),
    db: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> AuthCodeResponse:
    return await auth_code_service.get_code(db, code_id, platform_key=platform_key)


@router.post("/batch-generate", response_model=AuthCodeBatchGenerateResponse)
async def batch_generate_codes(
    req: AuthCodeGenerate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, object]:
    codes = await auth_code_service.batch_generate(db, req, actor=actor, request=request)
    logger.info("批量生成 %s 个授权码", req.count)
    return {"success": True, "codes": codes, "count": req.count}


@router.put("/{code_id}", response_model=AuthCodeResponse)
async def update_auth_code(
    code_id: int,
    req: AuthCodeUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> AuthCodeResponse:
    result = await auth_code_service.update_code(db, code_id, req, actor=actor, request=request)
    logger.info("更新授权码 ID: %s", code_id)
    return result


@router.delete("/{code_id}", response_model=AuthCodeDeleteResponse)
async def delete_auth_code(
    code_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, bool]:
    await auth_code_service.delete_code(db, code_id, actor=actor, request=request)
    logger.info("删除授权码 ID: %s", code_id)
    return {"success": True}


@router.post("/{code_id}/extend", response_model=AuthCodeResponse)
async def extend_auth_code(
    code_id: int, req: AuthCodeExtend, request: Request,
    db: AsyncSession = Depends(get_db), actor: dict[str, Any] = Depends(get_current_admin),
) -> AuthCodeResponse:
    return await auth_code_service.extend_code(db, code_id, req, actor=actor, request=request)
