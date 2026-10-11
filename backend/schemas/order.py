"""Validated schemas for the internal order state machine."""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from core.response import APIResponse


class OrderCreate(BaseModel):
    plan_id: int = Field(gt=0)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    channel: str | None = Field(default=None, max_length=100)
    responsible: str | None = Field(default=None, max_length=100)
    platform_key: str | None = Field(default=None, max_length=50)

    model_config = ConfigDict(extra="forbid")


class OrderUpdate(BaseModel):
    plan_id: int | None = Field(default=None, gt=0)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    channel: str | None = Field(default=None, max_length=100)
    responsible: str | None = Field(default=None, max_length=100)
    platform_key: str | None = Field(default=None, max_length=50)

    model_config = ConfigDict(extra="forbid")


class OrderTransitionRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=500)

    model_config = ConfigDict(extra="forbid")


class OrderResponse(BaseModel):
    id: int
    order_no: str
    plan_id: int | None = None
    plan_name_snapshot: str
    plan_price_snapshot: float
    plan_duration_days_snapshot: int
    amount: float
    channel: str | None = None
    responsible: str | None = None
    status: str
    refund_amount: float
    platform_key: str | None = None
    refund_reason: str | None = None
    cancel_reason: str | None = None
    created_by_staff_id: int | None = None
    updated_by_staff_id: int | None = None
    created_at: str | None = None
    paid_at: str | None = None
    refunded_at: str | None = None
    cancelled_at: str | None = None
    updated_at: str | None = None
    agency_id: int | None = None
    customer_id: int | None = None
    agency_name: str | None = None
    customer_name: str | None = None
    auth_code_id: int | None = None
    auth_code_status: str | None = None

    model_config = ConfigDict(from_attributes=True)


class OrderPageResponse(APIResponse[list[OrderResponse]]):
    total: int
    page: int
    page_size: int


OrderEnvelope = APIResponse[OrderResponse]
