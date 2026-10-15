"""Versioned offers and immutable entitlements, separate from legacy plans."""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)

from models.base import Base


class CommercialOfferVersion(Base):
    __tablename__ = "commercial_offer_versions"
    id = Column(Integer, primary_key=True)
    sku = Column(String(80), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="draft")
    active_sku = Column(String(80), nullable=True, unique=True)
    definition = Column(Text, nullable=False)
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    activated_by_staff_id = Column(Integer, ForeignKey("staff_users.id"))
    activated_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("sku", "version", name="ux_commercial_offer_version"),
        CheckConstraint("version > 0 AND revision > 0", name="ck_commercial_offer_version"),
        CheckConstraint("status IN ('draft','active','retired')", name="ck_commercial_offer_status"),
    )


class CommercialOrderSnapshot(Base):
    __tablename__ = "commercial_order_snapshots"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, unique=True)
    offer_id = Column(Integer, ForeignKey("commercial_offer_versions.id"), nullable=False)
    sku = Column(String(80), nullable=False, index=True)
    offer_version = Column(Integer, nullable=False)
    settlement_mode = Column(String(20), nullable=False, default="manual")
    snapshot = Column(Text, nullable=False)
    project_id = Column(String(120))
    site_origin = Column(String(255))
    ends_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class CommercialGrant(Base):
    __tablename__ = "commercial_grants"
    id = Column(Integer, primary_key=True)
    auth_code_id = Column(Integer, ForeignKey("auth_codes.id"), nullable=False, unique=True)
    order_id = Column(Integer, ForeignKey("orders.id"), unique=True)
    offer_id = Column(Integer, ForeignKey("commercial_offer_versions.id"), nullable=False)
    # Only trials have a claim key; unique across all trial offer versions.
    claim_key = Column(String(160), unique=True)
    snapshot = Column(Text, nullable=False)
    project_id = Column(String(120), nullable=False)
    site_origin = Column(String(255), nullable=False)
    ends_at = Column(DateTime, nullable=False)
    status = Column(String(20), nullable=False, default="active")
    created_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (CheckConstraint("status IN ('active','revoked')", name="ck_commercial_grant_status"),)


class TrialQuota(Base):
    __tablename__ = "commercial_trial_quotas"
    id = Column(Integer, primary_key=True)
    grant_id = Column(Integer, ForeignKey("commercial_grants.id"), nullable=False)
    capability = Column(String(100), nullable=False)
    available = Column(Integer, nullable=False, default=1)
    consumed = Column(Integer, nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint("grant_id", "capability", name="ux_commercial_trial_capability"),
        CheckConstraint("available >= 0 AND consumed >= 0 AND available + consumed <= 1", name="ck_commercial_trial_balance"),
    )


class TrialReservation(Base):
    __tablename__ = "commercial_trial_reservations"
    id = Column(Integer, primary_key=True)
    quota_id = Column(Integer, ForeignKey("commercial_trial_quotas.id"), nullable=False)
    operation_id = Column(String(160), nullable=False, unique=True)
    run_id = Column(String(120), nullable=True, index=True)
    status = Column(String(24), nullable=False, default="reserved")
    evidence_ref = Column(String(250))
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    resolved_at = Column(DateTime)
    __table_args__ = (CheckConstraint("status IN ('reserved','unknown','consumed','released')", name="ck_commercial_trial_state"),)


class ServiceFulfillment(Base):
    __tablename__ = "commercial_service_fulfillments"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    service_code = Column(String(80), nullable=False)
    total_count = Column(Integer, nullable=False)
    minutes_per_unit = Column(Integer, nullable=False, default=0)
    completed_count = Column(Integer, nullable=False, default=0)
    revision = Column(Integer, nullable=False, default=1)
    __table_args__ = (
        UniqueConstraint("order_id", "service_code", name="ux_commercial_fulfillment_service"),
        CheckConstraint("total_count > 0 AND completed_count >= 0 AND completed_count <= total_count", name="ck_commercial_fulfillment_count"),
    )


class ServiceFulfillmentEvent(Base):
    __tablename__ = "commercial_service_fulfillment_events"
    id = Column(Integer, primary_key=True)
    fulfillment_id = Column(Integer, ForeignKey("commercial_service_fulfillments.id"), nullable=False)
    operation_id = Column(String(160), nullable=False, unique=True)
    count = Column(Integer, nullable=False)
    minutes = Column(Integer, nullable=False, default=0)
    performed_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    evidence_ref = Column(String(250), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class CommercialRefundEntitlementReview(Base):
    """Latest explicit rights decision; audit keeps prior decisions immutable."""
    __tablename__ = "commercial_refund_entitlement_reviews"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, unique=True)
    refund_amount_snapshot = Column(Numeric(10, 2), nullable=False)
    retained_capabilities = Column(Text, nullable=False)
    service_limits = Column(Text, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    reviewed_by_staff_id = Column(Integer, ForeignKey("staff_users.id"), nullable=False)
    evidence_ref = Column(String(250), nullable=False)
    reviewed_at = Column(DateTime, nullable=False)
