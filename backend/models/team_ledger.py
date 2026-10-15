"""Private, manually confirmed team accounting; never a payment processor.

No commercial ratios or member identities are seeded in source. Policies are
imported as drafts through the restricted administration API.
"""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    func,
)

from core.exceptions import ConflictException
from models.base import Base


class TeamPolicy(Base):
    __tablename__ = "team_policies"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False, default="draft")
    version = Column(Integer, nullable=False, default=1)
    product_skus = Column(Text, nullable=False)
    items = Column(Text, nullable=False)
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (CheckConstraint("status IN ('draft', 'active')", name="ck_team_policy_status"),)


class TeamMember(Base):
    __tablename__ = "team_members"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    version = Column(Integer, nullable=False, default=1)
    ledger_version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class TeamOwnership(Base):
    __tablename__ = "team_ownerships"
    id = Column(Integer, primary_key=True, autoincrement=True)
    policy_id = Column(Integer, ForeignKey("team_policies.id"), nullable=False, index=True)
    item_code = Column(String(80), nullable=False)
    product_sku = Column(String(80), nullable=False)
    starts_on = Column(Date, nullable=False)
    ends_on = Column(Date, nullable=True)
    members = Column(Text, nullable=False)
    disputed = Column(Boolean, nullable=False, default=False)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_team_ownership_scope", "policy_id", "product_sku", "item_code"),)


class TeamOrderAllocation(Base):
    __tablename__ = "team_order_allocations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, unique=True)
    product_sku = Column(String(80), nullable=False)
    period = Column(String(7), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    note = Column(String(1000), nullable=False)
    acquisition_member_id = Column(Integer, ForeignKey("team_members.id"), nullable=True)
    closing_member_id = Column(Integer, ForeignKey("team_members.id"), nullable=True)
    is_repeat_purchase = Column(Boolean, nullable=False, default=False)
    version = Column(Integer, nullable=False, default=1)
    confirmed_settlement_id = Column(Integer, ForeignKey("team_settlements.id"), nullable=True)
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    updated_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_team_allocation_nonnegative"),
        Index("ix_team_allocation_period", "product_sku", "period"),
    )


class TeamSettlement(Base):
    __tablename__ = "team_settlements"
    id = Column(Integer, primary_key=True, autoincrement=True)
    policy_id = Column(Integer, ForeignKey("team_policies.id"), nullable=False)
    product_sku = Column(String(80), nullable=False)
    period = Column(String(7), nullable=False)
    status = Column(String(20), nullable=False, default="preview")
    version = Column(Integer, nullable=False, default=1)
    fingerprint = Column(String(64), nullable=False)
    inputs_snapshot = Column(Text, nullable=False)
    lines_snapshot = Column(Text, nullable=False)
    total_amount = Column(Numeric(12, 2), nullable=False)
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    confirmed_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    confirmed_at = Column(DateTime, nullable=True)
    __table_args__ = (
        CheckConstraint("status IN ('preview', 'confirmed')", name="ck_team_settlement_status"),
        Index("ix_team_settlement_period", "product_sku", "period"),
    )


class TeamLedgerEntry(Base):
    """Append-only signed changes to due/held/paid balances; no row deletion."""
    __tablename__ = "team_ledger_entries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    settlement_id = Column(Integer, ForeignKey("team_settlements.id"), nullable=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    member_id = Column(Integer, ForeignKey("team_members.id"), nullable=True, index=True)
    item_code = Column(String(80), nullable=True)
    bucket = Column(String(10), nullable=False)
    kind = Column(String(20), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    source_entry_id = Column(Integer, ForeignKey("team_ledger_entries.id"), nullable=True, index=True)
    idempotency_key = Column(String(100), nullable=True, unique=True)
    note = Column(String(1000), nullable=False)
    evidence = Column(String(2000), nullable=True)
    snapshot = Column(Text, nullable=False, default="{}")
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("bucket IN ('due', 'held', 'paid')", name="ck_team_entry_bucket"),
        CheckConstraint("amount != 0", name="ck_team_entry_nonzero"),
    )


class TeamRefundReview(Base):
    __tablename__ = "team_refund_reviews"
    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    refunded_total = Column(Numeric(12, 2), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    version = Column(Integer, nullable=False, default=1)
    reason = Column(String(1000), nullable=False)
    idempotency_key = Column(String(100), nullable=True, unique=True)
    request_snapshot = Column(Text, nullable=True)
    resolution_snapshot = Column(Text, nullable=True)
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    resolved_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)
    __table_args__ = (
        UniqueConstraint("order_id", "refunded_total", name="ux_team_refund_cumulative"),
        CheckConstraint("status IN ('pending', 'resolved')", name="ck_team_refund_status"),
    )


class TeamServiceDelivery(Base):
    """Evidence for internal delivery duties; never grants purchased services."""
    __tablename__ = "team_service_deliveries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    service_code = Column(String(80), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    completed = Column(Boolean, nullable=False, default=True)
    evidence = Column(String(2000), nullable=False)
    note = Column(String(1000), nullable=False)
    completed_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    completed_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint("order_id", "service_code", name="ux_team_service_delivery"),)


@event.listens_for(TeamLedgerEntry, "before_update")
@event.listens_for(TeamLedgerEntry, "before_delete")
def _prevent_ledger_rewrite(_mapper, _connection, _target):
    raise ConflictException("成员账本不可覆盖或删除，请追加有依据的调整记录")
