"""Verified real-execution records reported with a consumed launch grant."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from database import get_db
from domains.automation import service
from domains.automation.schemas import (
    ExecutionPageResponse,
    ExecutionReconcileRequest,
    ExecutionReportResponse,
    ExecutionResponse,
    RunnerExecutionReport,
)

router = APIRouter()


@router.post(
    "/report",
    response_model=ExecutionReportResponse,
    response_model_exclude_unset=True,
)
async def report_execution(
    req: RunnerExecutionReport,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await service.report_execution(db, req)


@router.post(
    "/reconcile",
    response_model=ExecutionReportResponse,
    response_model_exclude_unset=True,
)
async def reconcile_execution(
    req: ExecutionReconcileRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await service.reconcile_execution(db, current_user, req)


@router.get("", response_model=ExecutionPageResponse)
async def list_executions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    platform_key: str | None = Query(default=None, max_length=50),
    tool_id: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, object]:
    return await service.list_executions(
        db,
        current_user,
        page=page,
        page_size=page_size,
        platform_key=platform_key,
        tool_id=tool_id,
    )


@router.get("/{execution_id}", response_model=ExecutionResponse)
async def get_execution(
    execution_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, object]:
    return await service.get_execution(db, current_user, execution_id)
