"""Staff-only company expense and recurring renewal endpoints."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from core.csv_export import csv_row as _csv_row
from core.dependencies import require_commerce_operator, require_super_admin
from core.response import APIResponse, PaginatedResponse, success_response
from database import get_db
from domains.commerce import ExpenseService
from schemas.expense import (
    ExpenseAttachmentResponse,
    ExpenseCategoryCreate,
    ExpenseCategoryResponse,
    ExpenseCategoryUpdate,
    ExpenseRecordCreate,
    ExpenseRecordResponse,
    ExpenseRecordUpdate,
    ExpenseRenewalConfirmRequest,
    ExpenseRenewalConfirmResponse,
    ExpenseRenewalCreate,
    ExpenseRenewalResponse,
    ExpenseRenewalResumeRequest,
    ExpenseRenewalSkipRequest,
    ExpenseRenewalUpdate,
    ExpenseSummaryResponse,
    ExpenseVoidRequest,
)

router = APIRouter()


async def _stream_expenses_csv(
    bind: Any,
    query: Any,
) -> AsyncIterator[str]:
    yield "\ufeff" + _csv_row(
        ["日期", "支出事项", "分类", "收款方", "金额", "币种", "状态", "记录人", "备注", "作废原因"]
    )
    status_labels = {"active": "有效", "voided": "已作废"}
    async with AsyncSession(bind=bind, expire_on_commit=False) as session:
        service = ExpenseService(session)
        result = await session.stream(
            query.execution_options(yield_per=500)
        )
        async for row in result:
            item = service.serialize_expense_row(row)
            yield _csv_row([
                item["expense_date"].isoformat(),
                item["title"],
                item["category_name"],
                item.get("payee") or "",
                item["amount"],
                item["currency"],
                status_labels.get(item["status"], item["status"]),
                item.get("created_by_name") or "",
                item.get("note") or "",
                item.get("void_reason") or "",
            ])


@router.get("/summary", response_model=APIResponse[ExpenseSummaryResponse])
async def get_expense_summary(
    month: str | None = None,
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> dict:
    return success_response(await ExpenseService(db).summary(month))


@router.get("/export", response_model=None)
async def export_expenses(
    month: str | None = None,
    category_id: int | None = Query(default=None, gt=0),
    expense_status: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=200),
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> StreamingResponse:
    query = ExpenseService(db).expense_export_query(month, category_id, expense_status, q)
    filename = f"company_expenses_{datetime.utcnow():%Y%m%d_%H%M%S}.csv"
    return StreamingResponse(
        _stream_expenses_csv(db.bind, query),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/categories", response_model=APIResponse[list[ExpenseCategoryResponse]])
async def get_expense_categories(
    include_archived: bool = True,
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> dict:
    return success_response(await ExpenseService(db).list_categories(include_archived))


@router.post("/categories", status_code=status.HTTP_201_CREATED, response_model=APIResponse[ExpenseCategoryResponse])
async def create_expense_category(
    payload: ExpenseCategoryCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_super_admin),
) -> dict:
    category = await ExpenseService(db).create_category(payload, actor, request)
    return success_response(category, "支出分类已创建")


@router.patch("/categories/{category_id}", response_model=APIResponse[ExpenseCategoryResponse])
async def update_expense_category(
    category_id: int,
    payload: ExpenseCategoryUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_super_admin),
) -> dict:
    category = await ExpenseService(db).update_category(category_id, payload, actor, request)
    return success_response(category, "支出分类已更新")


@router.get("/renewals", response_model=PaginatedResponse[ExpenseRenewalResponse])
async def get_expense_renewals(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    renewal_status: str | None = Query(default=None, alias="status"),
    due_state: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> dict:
    return await ExpenseService(db).list_renewals(page, page_size, renewal_status, due_state, q)


@router.post("/renewals", status_code=status.HTTP_201_CREATED, response_model=APIResponse[ExpenseRenewalResponse])
async def create_expense_renewal(
    payload: ExpenseRenewalCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    renewal = await ExpenseService(db).create_renewal(payload, actor, request)
    return success_response(renewal, "续费项目已创建")


@router.get("/renewals/{renewal_id}", response_model=APIResponse[ExpenseRenewalResponse])
async def get_expense_renewal(
    renewal_id: int,
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> dict:
    return success_response(await ExpenseService(db).get_renewal(renewal_id))


@router.patch("/renewals/{renewal_id}", response_model=APIResponse[ExpenseRenewalResponse])
async def update_expense_renewal(
    renewal_id: int,
    payload: ExpenseRenewalUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    renewal = await ExpenseService(db).update_renewal(renewal_id, payload, actor, request)
    return success_response(renewal, "续费项目已更新")


@router.post("/renewals/{renewal_id}/confirm", response_model=APIResponse[ExpenseRenewalConfirmResponse])
async def confirm_expense_renewal(
    renewal_id: int,
    payload: ExpenseRenewalConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    result = await ExpenseService(db).confirm_renewal(renewal_id, payload, actor, request)
    return success_response(result, "续费已确认并计入实际支出")


@router.post("/renewals/{renewal_id}/skip", response_model=APIResponse[ExpenseRenewalResponse])
async def skip_expense_renewal(
    renewal_id: int,
    payload: ExpenseRenewalSkipRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    renewal = await ExpenseService(db).skip_renewal(renewal_id, payload, actor, request)
    return success_response(renewal, "本期续费已跳过")


@router.post("/renewals/{renewal_id}/pause", response_model=APIResponse[ExpenseRenewalResponse])
async def pause_expense_renewal(
    renewal_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    renewal = await ExpenseService(db).pause_renewal(renewal_id, actor, request)
    return success_response(renewal, "续费项目已暂停")


@router.post("/renewals/{renewal_id}/resume", response_model=APIResponse[ExpenseRenewalResponse])
async def resume_expense_renewal(
    renewal_id: int,
    payload: ExpenseRenewalResumeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    renewal = await ExpenseService(db).resume_renewal(renewal_id, payload.next_due_on, actor, request)
    return success_response(renewal, "续费项目已恢复")


@router.post("/renewals/{renewal_id}/end", response_model=APIResponse[ExpenseRenewalResponse])
async def end_expense_renewal(
    renewal_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    renewal = await ExpenseService(db).end_renewal(renewal_id, actor, request)
    return success_response(renewal, "续费项目已结束")


@router.get("", response_model=PaginatedResponse[ExpenseRecordResponse])
async def get_expenses(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    month: str | None = None,
    category_id: int | None = Query(default=None, gt=0),
    expense_status: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=200),
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> dict:
    return await ExpenseService(db).list_expenses(page, page_size, month, category_id, expense_status, q)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=APIResponse[ExpenseRecordResponse])
async def create_expense(
    payload: ExpenseRecordCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    expense = await ExpenseService(db).create_expense(payload, actor, request)
    return success_response(expense, "支出已入账")


@router.get("/{expense_id}", response_model=APIResponse[ExpenseRecordResponse])
async def get_expense(
    expense_id: int,
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> dict:
    return success_response(await ExpenseService(db).get_expense(expense_id))


@router.patch("/{expense_id}", response_model=APIResponse[ExpenseRecordResponse])
async def update_expense(
    expense_id: int,
    payload: ExpenseRecordUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    expense = await ExpenseService(db).update_expense(expense_id, payload, actor, request)
    return success_response(expense, "支出记录已更新")


@router.post("/{expense_id}/void", response_model=APIResponse[ExpenseRecordResponse])
async def void_expense(
    expense_id: int,
    payload: ExpenseVoidRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    expense = await ExpenseService(db).void_expense(expense_id, payload.reason, actor, request)
    return success_response(expense, "支出记录已作废")


@router.post(
    "/{expense_id}/attachments",
    status_code=status.HTTP_201_CREATED,
    response_model=APIResponse[ExpenseAttachmentResponse],
)
async def add_expense_attachment(
    expense_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    attachment = await ExpenseService(db).add_attachment(expense_id, file, actor, request)
    return success_response(attachment, "支出凭证已上传")


@router.get("/{expense_id}/attachments/{attachment_id}", response_model=None)
async def download_expense_attachment(
    expense_id: int,
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    _actor: dict = Depends(require_commerce_operator),
) -> FileResponse:
    path, attachment = await ExpenseService(db).attachment_file(expense_id, attachment_id)
    return FileResponse(path, media_type=attachment.mime_type, filename=attachment.original_name)


@router.delete("/{expense_id}/attachments/{attachment_id}", response_model=APIResponse[None])
async def delete_expense_attachment(
    expense_id: int,
    attachment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: dict = Depends(require_commerce_operator),
) -> dict:
    await ExpenseService(db).delete_attachment(expense_id, attachment_id, actor, request)
    return success_response(None, "支出凭证已删除")
