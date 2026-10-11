"""
用户相关 Schema
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from core.response import APIResponse


class UserUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    total_seats: int | None = None
    extra_devices: int | None = None


class UserResponse(BaseModel):
    id: int
    name: str | None = None
    phone: str | None = None
    auth_code_id: int | None = None
    device_id: str | None = None
    device_name: str | None = None
    total_seats: int
    extra_devices: int
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class UserSummaryResponse(BaseModel):
    id: int
    auth_code_id: int | None = None
    name: str | None = None
    phone: str | None = None
    device_id: str | None = None
    device_name: str | None = None
    total_seats: int | None = None
    extra_devices: int | None = None
    is_active: bool | None = None
    created_at: str | None = None


class UserDetailResponse(UserSummaryResponse):
    last_active_at: str | None = None
    updated_at: str | None = None


class UserDeviceResponse(BaseModel):
    id: int
    device_id: str
    device_name: str | None = None
    created_at: str | None = None


class UserStatsResponse(BaseModel):
    total_users: int
    active_users: int
    today_new: int


class UserListEnvelope(APIResponse[list[UserSummaryResponse]]):
    error_code: int | None = None
    detail: Any | None = None


class UserItemEnvelope(APIResponse[UserSummaryResponse]):
    error_code: int | None = None
    detail: Any | None = None


class UserDetailEnvelope(APIResponse[UserDetailResponse]):
    error_code: int | None = None
    detail: Any | None = None


class UserStatsEnvelope(APIResponse[UserStatsResponse]):
    error_code: int | None = None
    detail: Any | None = None


class UserDevicesEnvelope(APIResponse[list[UserDeviceResponse]]):
    error_code: int | None = None
    detail: Any | None = None
