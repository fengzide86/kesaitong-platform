"""Strict commercial contracts. Prices are decimal strings, not floating money."""

from datetime import datetime
from decimal import Decimal
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.order import OrderResponse


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class IncludedService(Contract):
    code: str = Field(pattern=r"^[a-z][a-z0-9-]{1,79}$")
    count: int = Field(ge=1, le=100)
    minutes_per_unit: int = Field(default=0, ge=0, le=480)


class OfferDefinition(Contract):
    name: str = Field(min_length=1, max_length=100)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    business_line: Literal["trial", "competition", "training", "single_tool", "service"]
    term_type: Literal["project_end", "service_fulfillment"]
    description: str = Field(default="", max_length=1000)
    allowed_capabilities: list[str] = Field(default_factory=list, max_length=50)
    services: list[IncludedService] = Field(default_factory=list, max_length=20)
    availability: Literal["consult", "limited", "available"] = "consult"

    @model_validator(mode="after")
    def validate_offer(self) -> Self:
        if self.business_line == "trial" and self.price != 0:
            raise ValueError("免费体验价格必须为 0")
        if self.business_line != "trial" and self.price <= 0:
            raise ValueError("付费商品价格必须大于 0")
        if (self.business_line == "service") != (self.term_type == "service_fulfillment"):
            raise ValueError("工具按项目结束，单独服务按履约计次")
        if len(self.allowed_capabilities) != len(set(self.allowed_capabilities)):
            raise ValueError("工具权益不能重复")
        if len(self.services) != len({item.code for item in self.services}):
            raise ValueError("服务权益不能重复")
        if self.business_line == "service" and (self.allowed_capabilities or not self.services):
            raise ValueError("单独服务不附带工具权限")
        return self


class OfferCreate(Contract):
    sku: str = Field(pattern=r"^[a-z][a-z0-9-]{1,79}$")
    definition: OfferDefinition


class OfferUpdate(Contract):
    expected_revision: int = Field(ge=1)
    definition: OfferDefinition


class RevisionRequest(Contract):
    expected_revision: int = Field(ge=1)


class ProjectScope(Contract):
    project_id: str | None = Field(default=None, min_length=1, max_length=120)
    site_origin: str | None = Field(default=None, max_length=255)
    ends_at: datetime | None = None
    platform_key: Literal["amazon", "aliexpress"] = "amazon"
    scene_type: Literal["training", "competition"] = "training"

    @field_validator("site_origin")
    @classmethod
    def exact_origin(cls, value: str | None) -> str | None:
        if value is None:
            return value
        parts = urlsplit(value)
        if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password or parts.path not in ("", "/") or parts.query or parts.fragment:
            raise ValueError("适用站点必须是完整 HTTP(S) origin，不含路径、账号或查询")
        port = parts.port
        hostname = f"[{parts.hostname.lower()}]" if ":" in parts.hostname else parts.hostname.lower()
        default_port = 443 if parts.scheme == "https" else 80
        return f"{parts.scheme}://{hostname}" + (f":{port}" if port and port != default_port else "")

    @field_validator("ends_at")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("结束时间必须包含时区")
        return value


class CommercialOrderCreate(ProjectScope):
    offer_id: int = Field(gt=0)
    channel: str | None = Field(default=None, max_length=100)
    responsible: str | None = Field(default=None, max_length=100)


class TrialGrantCreate(ProjectScope):
    offer_id: int = Field(gt=0)
    user_id: int = Field(gt=0)


class FulfillmentComplete(Contract):
    expected_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=8, max_length=160)
    count: int = Field(default=1, ge=1, le=100)
    minutes: int = Field(default=0, ge=0, le=48000)
    performed_by_staff_id: int = Field(gt=0)
    evidence_ref: str = Field(min_length=1, max_length=250)


class TrialReserve(Contract):
    capability: str = Field(min_length=1, max_length=100)
    operation_id: str = Field(min_length=8, max_length=160)


class TrialReconcile(Contract):
    outcome: Literal["verified_success", "not_submitted", "unknown"]
    evidence_ref: str = Field(min_length=1, max_length=250)


class RefundEntitlementReviewRequest(Contract):
    expected_revision: int = Field(ge=0)
    expected_refunded_total: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    retained_capabilities: list[str] = Field(max_length=50)
    service_limits: dict[str, int]
    evidence_ref: str = Field(min_length=1, max_length=250)


class OfferResponse(Contract):
    id: int
    sku: str
    version: int
    revision: int
    status: Literal["draft", "active", "retired"]
    definition: OfferDefinition
    activated_at: str | None


class PublicOffer(OfferDefinition):
    sku: str
    version: int


class PublicCatalogResponse(Contract):
    schema_version: Literal[1]
    catalog_version: str
    items: list[PublicOffer]


class CommercialSnapshot(Contract):
    schema_version: Literal[1]
    sku: str
    offer_version: int
    definition: OfferDefinition
    project_id: str | None
    site_origin: str | None
    ends_at: str | None
    platform_key: str
    scene_type: Literal["training", "competition"]


class CommercialOrderResponse(OrderResponse):
    commercial: CommercialSnapshot
    settlement_mode: Literal["manual"]


class CommercialGrantResponse(Contract):
    id: int
    auth_code_id: int
    order_id: int | None
    snapshot: CommercialSnapshot
    status: Literal["active", "revoked"]
    ends_at: str
    auth_code: str | None = None


class ServiceFulfillmentEventResponse(Contract):
    id: int
    count: int
    minutes: int
    performed_by_staff_id: int
    evidence_ref: str
    created_at: str | None


class ServiceFulfillmentResponse(Contract):
    id: int
    order_id: int
    service_code: str
    total_count: int
    purchased_count: int
    completed_count: int
    remaining_count: int
    refund_review_pending: bool
    minutes_per_unit: int
    revision: int
    events: list[ServiceFulfillmentEventResponse]


class FulfillmentCompleteResponse(Contract):
    event_id: int
    idempotent: bool


class ToolOptionResponse(Contract):
    tool_id: str | int | None
    name: str
    capability: str
    selectable: bool


class RefundEntitlementReviewResponse(Contract):
    order_id: int
    refund_amount: str
    revision: int
    current: bool
    retained_capabilities: list[str]
    service_limits: dict[str, int]
    evidence_ref: str | None
