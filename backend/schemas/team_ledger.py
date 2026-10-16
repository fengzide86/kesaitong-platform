"""Strict private accounting contracts; decimal money stays exact on the wire."""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Ratio = Annotated[Decimal, Field(ge=0, le=1, max_digits=10, decimal_places=8)]
Code = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")]
Period = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PolicyItem(StrictModel):
    code: Code
    label: str = Field(min_length=1, max_length=100)
    group: str = Field(min_length=1, max_length=100)
    ratio: Ratio
    method: Literal["fixed", "acquisition", "closing"] = "fixed"
    service_code: Code | None = None
    purchased_service_codes: list[Code] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique_purchased_services(self):
        if len(set(self.purchased_service_codes)) != len(self.purchased_service_codes):
            raise ValueError("关联的已购服务编号不能重复")
        return self


class PolicyInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    product_skus: list[Code] = Field(min_length=1, max_length=100)
    items: list[PolicyItem] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def totals(self):
        if sum((item.ratio for item in self.items), Decimal(0)) != 1:
            raise ValueError("所有子项比例合计必须精确为 1；子项以总分配金额为基数")
        if len({item.code for item in self.items}) != len(self.items):
            raise ValueError("子项编号不能重复")
        if len(set(self.product_skus)) != len(self.product_skus):
            raise ValueError("商品编号不能重复")
        return self


class PolicyUpdate(PolicyInput):
    expected_version: int = Field(ge=1)


class VersionInput(StrictModel):
    expected_version: int = Field(ge=1)


class MemberInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)


class MemberUpdate(MemberInput):
    active: bool
    expected_version: int = Field(ge=1)


class MemberWeight(StrictModel):
    member_id: int = Field(ge=1)
    weight: Ratio


class OwnershipInput(StrictModel):
    policy_id: int = Field(ge=1)
    item_code: Code
    product_sku: Code
    starts_on: date
    ends_on: date | None = None
    members: list[MemberWeight] = Field(default_factory=list, max_length=100)
    disputed: bool = False

    @model_validator(mode="after")
    def check_members(self):
        if self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("结束日期不能早于开始日期")
        if len({item.member_id for item in self.members}) != len(self.members):
            raise ValueError("成员不能重复")
        if sum((item.weight for item in self.members), Decimal(0)) > 1:
            raise ValueError("承担人权重不能超过 1；不足 1 的子项整体暂留")
        return self


class OwnershipUpdate(OwnershipInput):
    expected_version: int = Field(ge=1)


class AllocationInput(StrictModel):
    expected_version: int = Field(ge=0)
    amount: Money
    period: Period
    note: str = Field(min_length=1, max_length=1000)
    acquisition_member_id: int | None = Field(default=None, ge=1)
    closing_member_id: int | None = Field(default=None, ge=1)
    is_repeat_purchase: bool = False


class PreviewInput(StrictModel):
    policy_id: int = Field(ge=1)
    product_sku: Code
    period: Period


class ConfirmInput(VersionInput):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class PaymentInput(StrictModel):
    member_id: int = Field(ge=1)
    amount: Money
    expected_ledger_version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=100)
    evidence: str = Field(min_length=1, max_length=2000)
    note: str = Field(min_length=1, max_length=1000)


class ReleaseInput(StrictModel):
    member_id: int = Field(ge=1)
    amount: Money
    expected_remaining: Money
    idempotency_key: str = Field(min_length=8, max_length=100)
    evidence: str = Field(min_length=1, max_length=2000)
    note: str = Field(min_length=1, max_length=1000)


class RefundReduction(StrictModel):
    entry_id: int = Field(ge=1)
    amount: Money
    expected_remaining: Money


class RefundResolveInput(VersionInput):
    reductions: list[RefundReduction] = Field(default_factory=list, max_length=300)
    note: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def unique_lines(self):
        if len({item.entry_id for item in self.reductions}) != len(self.reductions):
            raise ValueError("调整明细不能重复")
        return self


class PartialRefundInput(StrictModel):
    amount: Money
    expected_refunded_total: Money
    reason: str = Field(min_length=1, max_length=500)
    evidence: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=100)


class AdjustmentInput(StrictModel):
    amount: Money
    expected_remaining: Money
    target_member_id: int | None = Field(default=None, ge=1)
    target_bucket: Literal["due", "held"]
    note: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=100)

    @model_validator(mode="after")
    def due_needs_member(self):
        if self.target_bucket == "due" and self.target_member_id is None:
            raise ValueError("应分调账必须指定成员")
        return self


class ServiceDeliveryInput(StrictModel):
    expected_version: int = Field(ge=0)
    completed: Literal[True] = True
    evidence: str = Field(min_length=1, max_length=2000)
    note: str = Field(min_length=1, max_length=1000)


class PolicyResponse(PolicyInput):
    id: int
    status: Literal["draft", "active"]
    version: int
    created_by_staff_id: int
    created_at: str


class MemberResponse(MemberInput):
    id: int
    active: bool
    version: int
    ledger_version: int
    created_at: str


class OwnershipResponse(OwnershipInput):
    id: int
    version: int
    created_at: str


class AllocationResponse(StrictModel):
    id: int
    order_id: int
    product_sku: str
    period: str
    amount: str
    note: str
    acquisition_member_id: int | None
    closing_member_id: int | None
    is_repeat_purchase: bool
    version: int
    confirmed_settlement_id: int | None
    created_by_staff_id: int
    updated_by_staff_id: int
    created_at: str


class SettlementLine(StrictModel):
    order_id: int
    item_code: str
    label: str
    group: str
    member_id: int | None
    amount: str
    bucket: Literal["due", "held"]
    held_reasons: list[str]
    service_code: str | None
    purchased_service_codes: list[str] = Field(default_factory=list)


class SettlementResponse(StrictModel):
    id: int
    policy_id: int
    product_sku: str
    period: str
    status: Literal["preview", "confirmed"]
    version: int
    fingerprint: str
    inputs_snapshot: dict[str, JsonValue]
    lines_snapshot: list[SettlementLine]
    total_amount: str
    created_by_staff_id: int
    confirmed_by_staff_id: int | None
    created_at: str
    confirmed_at: str | None


class EntryResponse(StrictModel):
    id: int
    settlement_id: int | None
    order_id: int | None
    member_id: int | None
    item_code: str | None
    bucket: Literal["due", "held", "paid"]
    kind: str
    amount: str
    source_entry_id: int | None
    idempotency_key: str | None
    note: str
    evidence: str | None
    snapshot: dict[str, JsonValue]
    created_by_staff_id: int
    created_at: str


class EntryBalanceResponse(StrictModel):
    entry: EntryResponse
    remaining: str


class BalanceResponse(StrictModel):
    due: str
    held: str
    paid: str
    unpaid: str


class MemberBalanceResponse(MemberResponse, BalanceResponse):
    pass


class SummaryResponse(StrictModel):
    totals: BalanceResponse
    members: list[MemberBalanceResponse]


class RefundResponse(StrictModel):
    id: int
    order_id: int
    refunded_total: str
    status: Literal["pending", "resolved"]
    version: int
    reason: str
    idempotency_key: str | None
    request_snapshot: dict[str, JsonValue] | None
    resolution_snapshot: dict[str, JsonValue] | None
    created_by_staff_id: int
    resolved_by_staff_id: int | None
    created_at: str
    resolved_at: str | None


class ServiceDeliveryResponse(StrictModel):
    id: int
    order_id: int
    service_code: str
    version: int
    completed: bool
    evidence: str
    note: str
    completed_by_staff_id: int
    completed_at: str
