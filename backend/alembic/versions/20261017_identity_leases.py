"""Add one-way external account leases and server-visible auth sessions.

No credentials, cookies, MFA codes or JWT values are stored.  The nullable
guard columns let released/expired rows remain as audit history while active
rows stay unique across processes and machines.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_identity_leases"
down_revision = "20261015_framework_commerce"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "external_account_bindings" not in tables:
        op.create_table(
            "external_account_bindings",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("auth_code_id", sa.Integer(), nullable=False),
            sa.Column("site_origin", sa.String(length=300), nullable=False),
            sa.Column("external_account_ref_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("active_guard", sa.String(length=16), nullable=True),
            sa.Column("bound_by_kind", sa.String(length=16), nullable=False),
            sa.Column("bound_by_id", sa.Integer(), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_by_staff_id", sa.Integer(), nullable=True),
            sa.Column("revoke_reason", sa.String(length=200), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('active','revoked')", name="ck_external_binding_status"),
            sa.CheckConstraint("bound_by_kind IN ('user','staff')", name="ck_external_binding_bound_by_kind"),
            sa.CheckConstraint("revision > 0", name="ck_external_binding_revision"),
            sa.ForeignKeyConstraint(["auth_code_id"], ["auth_codes.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("auth_code_id", "site_origin", "active_guard", name="ux_external_binding_auth_platform_guard"),
        )
        op.create_index("ix_external_binding_auth_code_id", "external_account_bindings", ["auth_code_id"], unique=False)
        op.create_index("ix_external_binding_identity", "external_account_bindings", ["site_origin", "external_account_ref_hash"], unique=False)
    if "external_account_leases" not in tables:
        op.create_table(
            "external_account_leases",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("owner_kind", sa.String(length=16), nullable=False),
            sa.Column("owner_id", sa.Integer(), nullable=False),
            sa.Column("auth_code_id", sa.Integer(), nullable=True),
            sa.Column("device_id", sa.String(length=200), nullable=False),
            sa.Column("workspace_id", sa.String(length=120), nullable=False),
            sa.Column("account_slot", sa.String(length=64), nullable=False),
            sa.Column("scene_id", sa.String(length=120), nullable=False),
            sa.Column("site_origin", sa.String(length=300), nullable=False),
            sa.Column("external_account_ref_hash", sa.String(length=64), nullable=False),
            sa.Column("auth_binding_guard", sa.String(length=16), nullable=True),
            sa.Column("binding_id", sa.Integer(), nullable=True),
            sa.Column("lease_token_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("active_guard", sa.String(length=16), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("last_heartbeat_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("released_at", sa.DateTime(), nullable=True),
            sa.Column("release_reason", sa.String(length=200), nullable=True),
            sa.Column("takeover_of_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("owner_kind IN ('user','staff')", name="ck_external_lease_owner_kind"),
            sa.CheckConstraint("status IN ('active','paused','needs_relogin','released','expired')", name="ck_external_lease_status"),
            sa.CheckConstraint("revision > 0", name="ck_external_lease_revision"),
            sa.ForeignKeyConstraint(["auth_code_id"], ["auth_codes.id"]),
            sa.ForeignKeyConstraint(["binding_id"], ["external_account_bindings.id"]),
            sa.ForeignKeyConstraint(["takeover_of_id"], ["external_account_leases.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("lease_token_hash", name="uq_external_lease_token_hash"),
            sa.UniqueConstraint("site_origin", "external_account_ref_hash", "active_guard", name="ux_external_lease_identity_guard"),
            sa.UniqueConstraint("owner_kind", "owner_id", "workspace_id", "account_slot", "active_guard", name="ux_external_lease_owner_slot_guard"),
            sa.UniqueConstraint("auth_code_id", "site_origin", "auth_binding_guard", name="ux_external_lease_auth_platform_guard"),
        )
        op.create_index("ix_external_lease_owner_id", "external_account_leases", ["owner_id"], unique=False)
        op.create_index("ix_external_lease_auth_code_id", "external_account_leases", ["auth_code_id"], unique=False)
        op.create_index("ix_external_lease_binding_id", "external_account_leases", ["binding_id"], unique=False)
        op.create_index("ix_external_lease_owner_status", "external_account_leases", ["owner_kind", "owner_id", "status"], unique=False)
        op.create_index("ix_external_lease_expiry", "external_account_leases", ["status", "expires_at"], unique=False)

    if "auth_sessions" not in tables:
        op.create_table(
            "auth_sessions",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("session_id", sa.String(length=80), nullable=False),
            sa.Column("session_token_hash", sa.String(length=64), nullable=False),
            sa.Column("principal_kind", sa.String(length=16), nullable=False),
            sa.Column("principal_id", sa.Integer(), nullable=False),
            sa.Column("auth_code_id", sa.Integer(), nullable=True),
            sa.Column("device_id", sa.String(length=200), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("active_guard", sa.String(length=16), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("revoke_reason", sa.String(length=200), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("principal_kind IN ('user','staff')", name="ck_auth_session_principal_kind"),
            sa.CheckConstraint("status IN ('active','revoked','expired')", name="ck_auth_session_status"),
            sa.ForeignKeyConstraint(["auth_code_id"], ["auth_codes.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("session_id", name="uq_auth_session_id"),
            sa.UniqueConstraint("session_token_hash", name="uq_auth_session_token_hash"),
            sa.UniqueConstraint("principal_kind", "principal_id", "active_guard", name="ux_auth_session_principal_guard"),
        )
        op.create_index("ix_auth_session_principal_id", "auth_sessions", ["principal_id"], unique=False)
        op.create_index("ix_auth_session_auth_code_id", "auth_sessions", ["auth_code_id"], unique=False)
        op.create_index("ix_auth_session_device", "auth_sessions", ["principal_kind", "principal_id", "device_id"], unique=False)
        op.create_index("ix_auth_session_expiry", "auth_sessions", ["status", "expires_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    # Refuse to drop security/audit history automatically.
    for name in ("auth_sessions", "external_account_leases", "external_account_bindings"):
        if name in existing and bind.execute(sa.text(f"SELECT COUNT(*) FROM {name}")).scalar_one():
            raise RuntimeError("identity lease/session data exists; export/reconcile before downgrade")
    if "auth_sessions" in existing:
        op.drop_table("auth_sessions")
    if "external_account_leases" in existing:
        op.drop_table("external_account_leases")
    if "external_account_bindings" in existing:
        op.drop_table("external_account_bindings")
