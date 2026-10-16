from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.response import APIResponse

Audience = Literal["all", "consumer", "business"]
Category = Literal["system", "update", "activity", "maintenance"]
Severity = Literal["info", "important", "critical"]
Presentation = Literal["banner", "modal"]
AnnouncementStatus = Literal["draft", "published", "expired"]


class AnnouncementWriteBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=10000)
    type: str | None = Field(default=None, max_length=20)
    audience: Audience | None = None
    category: Category | None = None
    severity: Severity | None = None
    presentation: Presentation | None = None
    app_version: str | None = Field(default=None, pattern=r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
    status: AnnouncementStatus | None = None
    priority: int | None = Field(default=None, ge=0, le=100)
    starts_at: datetime | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_business_rules(self) -> AnnouncementWriteBase:
        if self.starts_at and self.expires_at and self.starts_at >= self.expires_at:
            raise ValueError("生效时间必须早于到期时间")
        if self.severity == "critical" and self.presentation not in (None, "modal"):
            raise ValueError("关键公告必须使用确认弹窗")
        if (self.category == "update" or self.type == "update") and self.app_version == "":
            raise ValueError("版本公告需要有效版本号")
        return self


class AnnouncementCreate(AnnouncementWriteBase):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=10000)
    audience: Audience = "all"
    category: Category | None = None
    severity: Severity = "info"
    presentation: Presentation | None = None
    status: AnnouncementStatus = "draft"
    priority: int = Field(default=0, ge=0, le=100)


class AnnouncementUpdate(AnnouncementWriteBase):
    pass


class ReceiptAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int | None = Field(default=None, ge=1, strict=True)


class AnnouncementResponse(BaseModel):
    """Read-only announcement contract shared by admin and user feeds."""

    id: int
    title: str
    content: str
    type: str | None = None
    audience: str
    category: str | None = None
    severity: str
    presentation: str
    app_version: str | None = None
    status: str
    priority: int
    starts_at: str | None = None
    expires_at: str | None = None
    published_at: str | None = None
    revision: int
    created_at: str | None = None
    updated_at: str | None = None
    is_read: bool = False
    is_dismissed: bool = False


class LegacyAnnouncementResponse(BaseModel):
    id: int
    title: str
    content: str
    type: str | None = None
    created_at: str | None = None


class AnnouncementReceiptResponse(BaseModel):
    announcement_id: int
    revision: int
    action: str


AnnouncementListResponse = APIResponse[list[AnnouncementResponse]]
AnnouncementEnvelope = APIResponse[AnnouncementResponse]
LegacyAnnouncementListResponse = APIResponse[list[LegacyAnnouncementResponse]]
AnnouncementReceiptEnvelope = APIResponse[AnnouncementReceiptResponse]
AnnouncementDeleteResponse = APIResponse[None]
