"""安全的桌面更新发布路由。"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_super_admin
from core.response import success_response
from database import get_db
from domains.updates.download import published_installer_location
from domains.updates.schemas import (
    UpdateDeleteResponse,
    UpdateFileListResponse,
    UpdateReleaseEnvelope,
    UpdateReleaseListResponse,
)
from domains.updates.service import UpdateReleaseService, get_update_releases_dir

router = APIRouter()
UPDATES_DIR = str(get_update_releases_dir())
release_service = UpdateReleaseService(UPDATES_DIR)


def get_static_files() -> StaticFiles:
    return StaticFiles(directory=UPDATES_DIR)


@router.api_route("/latest-installer", methods=["GET", "HEAD"], include_in_schema=False)
def latest_installer() -> RedirectResponse:
    """Public navigation endpoint, not a control-plane execution API."""
    return RedirectResponse(
        published_installer_location(release_service.releases_dir),
        status_code=302,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.post("/releases/stage", response_model=UpdateReleaseEnvelope, response_model_exclude_unset=True)
async def stage_release(
    request: Request,
    version: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, object] = Depends(require_super_admin),
) -> object:
    release = await release_service.stage_with_audit(
        db,
        version=version,
        files=files,
        actor=admin,
        request=request,
    )
    return success_response(data=release, message="更新版本已暂存并校验")


@router.post(
    "/releases/{version}/publish",
    response_model=UpdateReleaseEnvelope,
    response_model_exclude_unset=True,
)
async def publish_release(
    version: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, object] = Depends(require_super_admin),
) -> object:
    release = await release_service.publish_with_audit(
        db,
        version=version,
        actor=admin,
        request=request,
    )
    return success_response(data=release, message="更新版本已原子发布")


@router.get("/releases", response_model=UpdateReleaseListResponse, response_model_exclude_unset=True)
async def list_releases(_admin: dict[str, object] = Depends(require_super_admin)) -> object:
    return success_response(data=release_service.list_releases())


@router.delete(
    "/releases/{version}/staged",
    response_model=UpdateDeleteResponse,
    response_model_exclude_unset=True,
)
async def delete_staged_release(
    version: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, object] = Depends(require_super_admin),
) -> object:
    await release_service.delete_staged_with_audit(
        db,
        version=version,
        actor=admin,
        request=request,
    )
    return success_response(message="暂存版本已删除")


@router.get("/list", response_model=UpdateFileListResponse, response_model_exclude_unset=True)
async def list_updates(_admin: dict[str, object] = Depends(require_super_admin)) -> object:
    files = [
        {"name": name, "size": os.path.getsize(os.path.join(UPDATES_DIR, name))}
        for name in os.listdir(UPDATES_DIR)
        if os.path.isfile(os.path.join(UPDATES_DIR, name))
    ]
    return success_response(data=files)
