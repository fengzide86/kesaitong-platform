"""
授权码相关 Schema
"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DeviceResponse(BaseModel):
    id: int
    device_id: str
    device_name: str | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AuthCodeGenerate(BaseModel):
    plan_id: int | None = Field(default=None, ge=1)
    count: int = Field(default=1, ge=1, le=1000)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    max_devices: int | None = Field(default=None, ge=1, le=1000)
    platform_scope: str | None = "amazon"
    scene_type: Literal["competition", "course", "operations"] | None = "competition"
    seat_limit: int | None = Field(default=None, ge=1, le=1000)

    @field_validator("platform_scope")
    @classmethod
    def validate_scope(cls, value: str | None) -> str | None:
        if value is None:
            return value
        platforms = list(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
        if not platforms or not set(platforms).issubset({"amazon", "aliexpress"}):
            raise ValueError("平台范围必须为 amazon 或 aliexpress")
        return ",".join(platforms)


class AuthCodeUpdate(BaseModel):
    status: Literal["unused", "active", "frozen", "expired", "deleted"] | None = None
    expires_at: str | None = None
    device_id: str | None = Field(default=None, max_length=200)
    device_name: str | None = Field(default=None, max_length=200)
    max_devices: int | None = Field(default=None, ge=1, le=1000)

    @field_validator("expires_at")
    @classmethod
    def validate_expiry(cls, value: str | None) -> str | None:
        if value is None:
            return value
        parsed = datetime.fromisoformat(value)
        # Existing terms use server-local wall time; offset-aware input is
        # converted, not stripped and silently reinterpreted.
        if parsed.tzinfo:
            parsed = parsed.astimezone().replace(tzinfo=None)
            return parsed.isoformat()
        return value


class AuthCodeExtend(BaseModel):
    days: int = Field(ge=1, le=3650)

    model_config = ConfigDict(extra="forbid")


class AuthCodeResponse(BaseModel):
    id: int
    code: str
    plan_id: int | None = None
    user_id: int | None = None
    device_id: str | None = None
    device_name: str | None = None
    max_devices: int | None = None
    status: str
    expires_at: datetime | None = None
    created_at: datetime | None = None
    devices: list[DeviceResponse] = []
    # 1.5 新增字段
    platform_scope: list[str] | None = None
    scene_type: str | None = None
    seat_limit: int | None = None
    seat_used: int | None = None
    device_used: int | None = None
    plan_name: str | None = None
    product_type: str = "consumer"
    entitlements: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class AuthCodePageResponse(BaseModel):
    data: list[AuthCodeResponse]
    page: int
    page_size: int
    total: int


class AuthCodeBatchGenerateResponse(BaseModel):
    success: bool
    codes: list[str]
    count: int


class AuthCodeDeleteResponse(BaseModel):
    success: bool


# ===== AuthSeat (席位) =====
class AuthSeatResponse(BaseModel):
    id: int
    auth_code_id: int
    user_id: int | None = None
    device_id: str | None = None
    device_name: str | None = None
    seat_no: int | None = None
    status: str
    activated_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
