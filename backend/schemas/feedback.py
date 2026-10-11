"""
反馈/日志相关 Schema
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from core.response import APIResponse


class LogCreate(BaseModel):
    user_id: int | None = None
    device_id: str | None = None
    tool_name: str | None = None
    module: str | None = None
    status: str | None = None
    error_code: str | None = None
    detail: str | None = None


class LogResponse(BaseModel):
    id: int
    user_id: int | None = None
    device_id: str | None = None
    tool_name: str | None = None
    module: str | None = None
    status: str | None = None
    error_code: str | None = None
    detail: str | None = None
    created_at: datetime | None = None
    auth_code_id: int | None = None
    platform_key: str | None = None
    capability_key: str | None = None
    script_key: str | None = None
    tool_id: str | None = None
    verification_state: str = "legacy_unverified"

    model_config = ConfigDict(from_attributes=True)


class FeedbackCreate(BaseModel):
    user_id: int | None = None
    title: str | None = None
    content: str | None = None
    screenshot: str | None = None


class FeedbackUpdate(BaseModel):
    status: str | None = None
    admin_reply: str | None = None


class FeedbackResponse(BaseModel):
    id: int
    user_id: int | None = None
    title: str | None = None
    content: str | None = None
    screenshot: str | None = None
    status: str
    admin_reply: str | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class LogPageResponse(BaseModel):
    data: list[LogResponse]
    page: int
    page_size: int
    total: int


class FeedbackSummaryResponse(BaseModel):
    id: int
    user_id: int | None = None
    title: str
    content: str
    status: str
    priority: str
    admin_reply: str | None = None
    created_at: str | None = None
    replied_at: str | None = None
    updated_at: str | None = None
    platform_key: str | None = None
    capability_key: str | None = None
    tool_id: str | None = None


class FeedbackDetailResponse(FeedbackSummaryResponse):
    screenshot: str | None = None
    screenshots: str | None = None
    status_history: str | None = None
    run_log_id: int | None = None


class FeedbackStatsResponse(BaseModel):
    total: int
    pending: int
    processing: int
    resolved: int


class FeedbackListEnvelope(APIResponse[list[FeedbackSummaryResponse]]):
    error_code: int | None = None
    detail: Any | None = None


class FeedbackItemEnvelope(APIResponse[FeedbackSummaryResponse]):
    error_code: int | None = None
    detail: Any | None = None


class FeedbackDetailEnvelope(APIResponse[FeedbackDetailResponse]):
    error_code: int | None = None
    detail: Any | None = None


class FeedbackStatsEnvelope(APIResponse[FeedbackStatsResponse]):
    error_code: int | None = None
    detail: Any | None = None


class FeedbackDeleteEnvelope(APIResponse[None]):
    error_code: int | None = None
    detail: Any | None = None
