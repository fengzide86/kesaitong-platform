"""安全边界模型：外部账号占用和课赛通登录会话。

Only one-way hashes of external account references and ephemeral lease/session
tokens are persisted.  Passwords, cookies, MFA codes and access tokens are
intentionally not represented by this model.
"""

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func

from models.base import Base


class ExternalLeaseStatus:
    ACTIVE = "active"
    PAUSED = "paused"
    NEEDS_RELOGIN = "needs_relogin"
    RELEASED = "released"
    EXPIRED = "expired"

    HELD = frozenset({ACTIVE, PAUSED, NEEDS_RELOGIN})
    ALL = HELD | frozenset({RELEASED, EXPIRED})


class ExternalBindingStatus:
    ACTIVE = "active"
    REVOKED = "revoked"


class ExternalAccountBinding(Base):
    """Persistent customer-to-platform account binding.

    Releasing a browser lease does not clear this binding.  A different
    external account requires an explicit staff takeover, which revokes the
    previous binding and creates an auditable replacement.
    """

    __tablename__ = "external_account_bindings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    auth_code_id = Column(Integer, ForeignKey("auth_codes.id"), nullable=False, index=True)
    site_origin = Column(String(300), nullable=False)
    external_account_ref_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False, default=ExternalBindingStatus.ACTIVE)
    active_guard = Column(String(16), nullable=True, default="held")
    bound_by_kind = Column(String(16), nullable=False)
    bound_by_id = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by_staff_id = Column(Integer, nullable=True)
    revoke_reason = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("auth_code_id", "site_origin", "active_guard", name="ux_external_binding_auth_platform_guard"),
        CheckConstraint("status IN ('active','revoked')", name="ck_external_binding_status"),
        CheckConstraint("bound_by_kind IN ('user','staff')", name="ck_external_binding_bound_by_kind"),
        CheckConstraint("revision > 0", name="ck_external_binding_revision"),
        Index("ix_external_binding_identity", "site_origin", "external_account_ref_hash"),
    )


class ExternalAccountLease(Base):
    """Cross-process/machine lease for one external platform account.

    ``active_guard`` is ``held`` only while the lease is active, paused or
    waiting for manual re-login.  A nullable guard plus a unique constraint is
    portable across SQLite and MariaDB and prevents two held leases for the
    same ``site_origin + external_account_ref_hash``.
    """

    __tablename__ = "external_account_leases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_kind = Column(String(16), nullable=False)  # user / staff
    owner_id = Column(Integer, nullable=False, index=True)
    auth_code_id = Column(Integer, ForeignKey("auth_codes.id"), nullable=True, index=True)
    device_id = Column(String(200), nullable=False)
    workspace_id = Column(String(120), nullable=False)
    account_slot = Column(String(64), nullable=False)
    scene_id = Column(String(120), nullable=False)
    site_origin = Column(String(300), nullable=False)
    external_account_ref_hash = Column(String(64), nullable=False)
    # User/customer binding guard. It is held only for a customer lease so a
    # single authorization cannot switch between external accounts on one
    # platform. Staff leases leave this NULL and are governed by the global
    # identity guard plus explicit staff takeover.
    auth_binding_guard = Column(String(16), nullable=True, default=None)
    binding_id = Column(Integer, ForeignKey("external_account_bindings.id"), nullable=True, index=True)
    lease_token_hash = Column(String(64), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default=ExternalLeaseStatus.ACTIVE)
    active_guard = Column(String(16), nullable=True, default="held")
    revision = Column(Integer, nullable=False, default=1)
    last_heartbeat_at = Column(DateTime, nullable=False, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    released_at = Column(DateTime, nullable=True)
    release_reason = Column(String(200), nullable=True)
    takeover_of_id = Column(Integer, ForeignKey("external_account_leases.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "site_origin",
            "external_account_ref_hash",
            "active_guard",
            name="ux_external_lease_identity_guard",
        ),
        UniqueConstraint(
            "owner_kind",
            "owner_id",
            "workspace_id",
            "account_slot",
            "active_guard",
            name="ux_external_lease_owner_slot_guard",
        ),
        UniqueConstraint(
            "auth_code_id",
            "site_origin",
            "auth_binding_guard",
            name="ux_external_lease_auth_platform_guard",
        ),
        CheckConstraint("owner_kind IN ('user','staff')", name="ck_external_lease_owner_kind"),
        CheckConstraint(
            "status IN ('active','paused','needs_relogin','released','expired')",
            name="ck_external_lease_status",
        ),
        CheckConstraint("revision > 0", name="ck_external_lease_revision"),
        Index("ix_external_lease_owner_status", "owner_kind", "owner_id", "status"),
        Index("ix_external_lease_expiry", "status", "expires_at"),
    )


class AuthSessionStatus:
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class AuthSession(Base):
    """Server-visible login session, separate from the JWT itself.

    The current legacy login endpoints still issue JWTs without ``session_id``;
    this table/service is the safe contract for wiring session claims in the
    next auth rollout.  Keeping it separate lets the rollout reject a second
    device and revoke an old session without ever persisting a JWT/password.
    """

    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(80), nullable=False, unique=True, index=True)
    session_token_hash = Column(String(64), nullable=False, unique=True)
    principal_kind = Column(String(16), nullable=False)  # user / staff
    principal_id = Column(Integer, nullable=False, index=True)
    auth_code_id = Column(Integer, ForeignKey("auth_codes.id"), nullable=True, index=True)
    device_id = Column(String(200), nullable=False)
    status = Column(String(16), nullable=False, default=AuthSessionStatus.ACTIVE)
    active_guard = Column(String(16), nullable=True, default="held")
    last_seen_at = Column(DateTime, nullable=False, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    revoke_reason = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("principal_kind", "principal_id", "active_guard", name="ux_auth_session_principal_guard"),
        CheckConstraint("principal_kind IN ('user','staff')", name="ck_auth_session_principal_kind"),
        CheckConstraint("status IN ('active','revoked','expired')", name="ck_auth_session_status"),
        Index("ix_auth_session_device", "principal_kind", "principal_id", "device_id"),
        Index("ix_auth_session_expiry", "status", "expires_at"),
    )
