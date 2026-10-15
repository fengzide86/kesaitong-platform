"""Scenario administration is never writable by consumer tokens."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_staff, get_current_user, require_super_admin
from core.response import APIResponse
from database import get_db
from domains.automation.schemas import ExecutionReportResult, RunnerExecutionReport
from domains.scenarios import service, staff_execution
from models.scenario import ProjectRuntimeScope, ScenarioAssignment, StaffRuntimePermission
from schemas.scenario import (
    ProjectRuntimeScopeRead,
    ProjectRuntimeScopeWrite,
    ScenarioAssignmentRead,
    ScenarioAssignmentWrite,
    ScenarioEffectivePolicy,
    StaffBrowseGrantRead,
    StaffExecutionReconcileRequest,
    StaffExecutionReportRead,
    StaffRuntimeLaunchRequest,
    StaffRuntimePermissionRead,
    StaffRuntimePermissionWrite,
    StaffToolGrantRead,
    StaffToolGrantRequest,
    StaffToolGrantVerify,
    StaffToolVerificationRead,
)

router = APIRouter()


@router.get("/projects", response_model=APIResponse[list[ProjectRuntimeScopeRead]])
async def projects(db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_super_admin)) -> dict:
    rows = (await db.execute(select(ProjectRuntimeScope).order_by(ProjectRuntimeScope.id))).scalars()
    return {"success": True, "data": [service.project_scope_dict(row) for row in rows]}


@router.put("/projects", response_model=APIResponse[ProjectRuntimeScopeRead])
async def save_project(req: ProjectRuntimeScopeWrite, db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict:
    return {"success": True, "data": await service.save_project_scope(db, req, actor["user_id"])}


@router.get("/me", response_model=APIResponse[ScenarioEffectivePolicy])
async def mine(db: AsyncSession = Depends(get_db), actor: dict = Depends(get_current_user)) -> dict:
    data = await service.effective_policy(db, actor["user_id"]) if actor.get("role") == "user" else await service.staff_policy(db, actor)
    return {"success": True, "data": data}


@router.get("/assignments", response_model=APIResponse[list[ScenarioAssignmentRead]])
async def assignments(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
                      db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_super_admin)) -> dict:
    rows = (await db.execute(select(ScenarioAssignment).order_by(ScenarioAssignment.id)
                            .offset((page - 1) * page_size).limit(page_size))).scalars()
    return {"success": True, "data": [service.assignment_dict(row) for row in rows]}


@router.put("/assignments/{subject_type}/{subject_id}", response_model=APIResponse[ScenarioAssignmentRead])
async def assign(subject_type: Literal["user", "auth_code"], subject_id: int, req: ScenarioAssignmentWrite,
                 db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict:
    return {"success": True, "data": await service.save_assignment(db, subject_type, subject_id, req, actor["user_id"])}


@router.put("/staff/{staff_id}/permission", response_model=APIResponse[StaffRuntimePermissionRead])
async def staff_permission(staff_id: int, req: StaffRuntimePermissionWrite,
                           db: AsyncSession = Depends(get_db), actor: dict = Depends(require_super_admin)) -> dict:
    return {"success": True, "data": await service.save_staff_permission(db, staff_id, req, actor["user_id"])}


@router.get("/staff/permissions", response_model=APIResponse[list[StaffRuntimePermissionRead]])
async def staff_permissions(db: AsyncSession = Depends(get_db), _actor: dict = Depends(require_super_admin)) -> dict:
    rows = (await db.execute(select(StaffRuntimePermission).order_by(StaffRuntimePermission.staff_id))).scalars()
    return {"success": True, "data": [service.permission_dict(row) for row in rows]}


@router.post("/staff/launch-grant", response_model=APIResponse[StaffBrowseGrantRead])
async def staff_launch(req: StaffRuntimeLaunchRequest, db: AsyncSession = Depends(get_db),
                       actor: dict = Depends(get_current_staff)) -> dict:
    return {"success": True, "data": await service.issue_staff_grant(db, actor, req)}


@router.post("/staff/tool-grants", response_model=APIResponse[StaffToolGrantRead])
async def staff_tool_grant(req: StaffToolGrantRequest, db: AsyncSession = Depends(get_db),
                          actor: dict = Depends(get_current_staff)) -> dict:
    return {"success": True, "data": await staff_execution.issue(db, actor, req)}


@router.post("/staff/tool-grants/verify", response_model=APIResponse[StaffToolVerificationRead])
async def verify_staff_tool_grant(req: StaffToolGrantVerify, db: AsyncSession = Depends(get_db),
                                 actor: dict = Depends(get_current_staff)) -> dict:
    return {"success": True, "data": await staff_execution.consume(db, actor, req.token)}


@router.post("/staff/reports", response_model=APIResponse[StaffExecutionReportRead])
async def staff_report(req: RunnerExecutionReport, db: AsyncSession = Depends(get_db)) -> dict:
    return {"success": True, "data": await staff_execution.report(db, req.model_dump())}


@router.post("/staff/reconcile", response_model=APIResponse[ExecutionReportResult])
async def staff_reconcile(req: StaffExecutionReconcileRequest, db: AsyncSession = Depends(get_db),
                          actor: dict = Depends(get_current_staff)) -> dict:
    return {"success": True, "data": await staff_execution.reconcile(db, actor, req.model_dump())}
