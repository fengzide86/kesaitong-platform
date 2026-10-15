"""Add opt-in framework and commerce tables without rewriting existing data.

Frozen schema; no seed prices, internal ratios or historical ledger backfill.
Downgrade refuses to discard any newly recorded operational or financial data.
"""
import sqlalchemy as sa

from alembic import op

revision = "20261015_framework_commerce"
down_revision = "20260922_agency_commission"
branch_labels = None
depends_on = None

TABLES = ["project_runtime_scopes","scenario_assignments","staff_runtime_permissions","staff_tool_grants","team_members","commercial_offer_versions","team_policies","team_ownerships","team_settlements","commercial_grants","commercial_order_snapshots","commercial_service_fulfillments","team_ledger_entries","team_order_allocations","team_refund_reviews","team_service_deliveries","commercial_service_fulfillment_events","commercial_trial_quotas","commercial_trial_reservations","commercial_refund_entitlement_reviews"]


def _create_table(name, *args, **kwargs):
    if name not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(name, *args, **kwargs)


def _create_index(name, table, columns, **kwargs):
    if name not in {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.create_index(name, table, columns, **kwargs)


def upgrade():
    _create_table('commercial_refund_entitlement_reviews',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('refund_amount_snapshot', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('retained_capabilities', sa.Text(), nullable=False),
    sa.Column('service_limits', sa.Text(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('reviewed_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('evidence_ref', sa.String(length=250), nullable=False),
    sa.Column('reviewed_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
    sa.ForeignKeyConstraint(['reviewed_by_staff_id'], ['staff_users.id']),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id')
    )
    _create_table('project_runtime_scopes',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('project_id', sa.String(length=128), nullable=False),
    sa.Column('site_origin', sa.String(length=300), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('course_refs', sa.JSON(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('updated_by', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'site_origin', name='uq_project_runtime_origin')
    )
    _create_table('scenario_assignments',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('subject_type', sa.String(length=16), nullable=False),
    sa.Column('subject_id', sa.Integer(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('entry_url', sa.String(length=2048), nullable=False),
    sa.Column('allowed_origins', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('updated_by', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('subject_type', 'subject_id', name='uq_scenario_subject')
    )
    _create_table('staff_runtime_permissions',
    sa.Column('staff_id', sa.Integer(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('max_scenes', sa.Integer(), nullable=False),
    sa.Column('allowed_origins', sa.JSON(), nullable=False),
    sa.Column('allowed_capabilities', sa.JSON(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('updated_by', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('staff_id')
    )
    _create_table('staff_tool_grants',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('staff_id', sa.Integer(), nullable=False),
    sa.Column('staff_token_version', sa.Integer(), nullable=False),
    sa.Column('policy_revision', sa.Integer(), nullable=False),
    sa.Column('device_id', sa.String(length=200), nullable=False),
    sa.Column('account_slot', sa.String(length=64), nullable=False),
    sa.Column('attempt_id', sa.String(length=128), nullable=False),
    sa.Column('tool_id', sa.String(length=128), nullable=False),
    sa.Column('target_profile_id', sa.String(length=128), nullable=False),
    sa.Column('target_profile_revision', sa.Integer(), nullable=False),
    sa.Column('site_origin', sa.String(length=300), nullable=False),
    sa.Column('capability', sa.String(length=128), nullable=False),
    sa.Column('context_hash', sa.String(length=64), nullable=False),
    sa.Column('input_hash', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('used_at', sa.DateTime(), nullable=True),
    sa.Column('report', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('staff_id', 'device_id', 'attempt_id', name='uq_staff_tool_attempt'),
    sa.UniqueConstraint('token_hash')
    )
    _create_index(op.f('ix_staff_tool_grants_staff_id'), 'staff_tool_grants', ['staff_id'], unique=False)
    _create_table('team_members',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('ledger_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    _create_table('commercial_offer_versions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('sku', sa.String(length=80), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('active_sku', sa.String(length=80), nullable=True),
    sa.Column('definition', sa.Text(), nullable=False),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('activated_by_staff_id', sa.Integer(), nullable=True),
    sa.Column('activated_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint("status IN ('draft','active','retired')", name='ck_commercial_offer_status'),
    sa.CheckConstraint('version > 0 AND revision > 0', name='ck_commercial_offer_version'),
    sa.ForeignKeyConstraint(['activated_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('active_sku'),
    sa.UniqueConstraint('sku', 'version', name='ux_commercial_offer_version')
    )
    _create_index(op.f('ix_commercial_offer_versions_sku'), 'commercial_offer_versions', ['sku'], unique=False)
    _create_table('team_policies',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('product_skus', sa.Text(), nullable=False),
    sa.Column('items', sa.Text(), nullable=False),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint("status IN ('draft', 'active')", name='ck_team_policy_status'),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_table('team_ownerships',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('policy_id', sa.Integer(), nullable=False),
    sa.Column('item_code', sa.String(length=80), nullable=False),
    sa.Column('product_sku', sa.String(length=80), nullable=False),
    sa.Column('starts_on', sa.Date(), nullable=False),
    sa.Column('ends_on', sa.Date(), nullable=True),
    sa.Column('members', sa.Text(), nullable=False),
    sa.Column('disputed', sa.Boolean(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['policy_id'], ['team_policies.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index('ix_team_ownership_scope', 'team_ownerships', ['policy_id', 'product_sku', 'item_code'], unique=False)
    _create_index(op.f('ix_team_ownerships_policy_id'), 'team_ownerships', ['policy_id'], unique=False)
    _create_table('team_settlements',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('policy_id', sa.Integer(), nullable=False),
    sa.Column('product_sku', sa.String(length=80), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('fingerprint', sa.String(length=64), nullable=False),
    sa.Column('inputs_snapshot', sa.Text(), nullable=False),
    sa.Column('lines_snapshot', sa.Text(), nullable=False),
    sa.Column('total_amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('confirmed_by_staff_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint("status IN ('preview', 'confirmed')", name='ck_team_settlement_status'),
    sa.ForeignKeyConstraint(['confirmed_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['policy_id'], ['team_policies.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index('ix_team_settlement_period', 'team_settlements', ['product_sku', 'period'], unique=False)
    _create_table('commercial_grants',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('auth_code_id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=True),
    sa.Column('offer_id', sa.Integer(), nullable=False),
    sa.Column('claim_key', sa.String(length=160), nullable=True),
    sa.Column('snapshot', sa.Text(), nullable=False),
    sa.Column('project_id', sa.String(length=120), nullable=False),
    sa.Column('site_origin', sa.String(length=255), nullable=False),
    sa.Column('ends_at', sa.DateTime(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint("status IN ('active','revoked')", name='ck_commercial_grant_status'),
    sa.ForeignKeyConstraint(['auth_code_id'], ['auth_codes.id'], ),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['offer_id'], ['commercial_offer_versions.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('auth_code_id'),
    sa.UniqueConstraint('claim_key'),
    sa.UniqueConstraint('order_id')
    )
    _create_table('commercial_order_snapshots',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('offer_id', sa.Integer(), nullable=False),
    sa.Column('sku', sa.String(length=80), nullable=False),
    sa.Column('offer_version', sa.Integer(), nullable=False),
    sa.Column('settlement_mode', sa.String(length=20), nullable=False),
    sa.Column('snapshot', sa.Text(), nullable=False),
    sa.Column('project_id', sa.String(length=120), nullable=True),
    sa.Column('site_origin', sa.String(length=255), nullable=True),
    sa.Column('ends_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['offer_id'], ['commercial_offer_versions.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id')
    )
    _create_index(op.f('ix_commercial_order_snapshots_sku'), 'commercial_order_snapshots', ['sku'], unique=False)
    _create_table('commercial_service_fulfillments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('service_code', sa.String(length=80), nullable=False),
    sa.Column('total_count', sa.Integer(), nullable=False),
    sa.Column('minutes_per_unit', sa.Integer(), nullable=False),
    sa.Column('completed_count', sa.Integer(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.CheckConstraint('total_count > 0 AND completed_count >= 0 AND completed_count <= total_count', name='ck_commercial_fulfillment_count'),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id', 'service_code', name='ux_commercial_fulfillment_service')
    )
    _create_table('team_ledger_entries',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('settlement_id', sa.Integer(), nullable=True),
    sa.Column('order_id', sa.Integer(), nullable=True),
    sa.Column('member_id', sa.Integer(), nullable=True),
    sa.Column('item_code', sa.String(length=80), nullable=True),
    sa.Column('bucket', sa.String(length=10), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('source_entry_id', sa.Integer(), nullable=True),
    sa.Column('idempotency_key', sa.String(length=100), nullable=True),
    sa.Column('note', sa.String(length=1000), nullable=False),
    sa.Column('evidence', sa.String(length=2000), nullable=True),
    sa.Column('snapshot', sa.Text(), nullable=False),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint("bucket IN ('due', 'held', 'paid')", name='ck_team_entry_bucket'),
    sa.CheckConstraint('amount != 0', name='ck_team_entry_nonzero'),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['member_id'], ['team_members.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['settlement_id'], ['team_settlements.id'], ),
    sa.ForeignKeyConstraint(['source_entry_id'], ['team_ledger_entries.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key')
    )
    _create_index(op.f('ix_team_ledger_entries_member_id'), 'team_ledger_entries', ['member_id'], unique=False)
    _create_index(op.f('ix_team_ledger_entries_order_id'), 'team_ledger_entries', ['order_id'], unique=False)
    _create_index(op.f('ix_team_ledger_entries_settlement_id'), 'team_ledger_entries', ['settlement_id'], unique=False)
    _create_index(op.f('ix_team_ledger_entries_source_entry_id'), 'team_ledger_entries', ['source_entry_id'], unique=False)
    _create_table('team_order_allocations',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('product_sku', sa.String(length=80), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('note', sa.String(length=1000), nullable=False),
    sa.Column('acquisition_member_id', sa.Integer(), nullable=True),
    sa.Column('closing_member_id', sa.Integer(), nullable=True),
    sa.Column('is_repeat_purchase', sa.Boolean(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('confirmed_settlement_id', sa.Integer(), nullable=True),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('updated_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint('amount >= 0', name='ck_team_allocation_nonnegative'),
    sa.ForeignKeyConstraint(['acquisition_member_id'], ['team_members.id'], ),
    sa.ForeignKeyConstraint(['closing_member_id'], ['team_members.id'], ),
    sa.ForeignKeyConstraint(['confirmed_settlement_id'], ['team_settlements.id'], ),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['updated_by_staff_id'], ['staff_users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id')
    )
    _create_index('ix_team_allocation_period', 'team_order_allocations', ['product_sku', 'period'], unique=False)
    _create_table('team_refund_reviews',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('refunded_total', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=1000), nullable=False),
    sa.Column('idempotency_key', sa.String(length=100), nullable=True),
    sa.Column('request_snapshot', sa.Text(), nullable=True),
    sa.Column('resolution_snapshot', sa.Text(), nullable=True),
    sa.Column('created_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('resolved_by_staff_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint("status IN ('pending', 'resolved')", name='ck_team_refund_status'),
    sa.ForeignKeyConstraint(['created_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['resolved_by_staff_id'], ['staff_users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key'),
    sa.UniqueConstraint('order_id', 'refunded_total', name='ux_team_refund_cumulative')
    )
    _create_index(op.f('ix_team_refund_reviews_order_id'), 'team_refund_reviews', ['order_id'], unique=False)
    _create_table('team_service_deliveries',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('service_code', sa.String(length=80), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('completed', sa.Boolean(), nullable=False),
    sa.Column('evidence', sa.String(length=2000), nullable=False),
    sa.Column('note', sa.String(length=1000), nullable=False),
    sa.Column('completed_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['completed_by_staff_id'], ['staff_users.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id', 'service_code', name='ux_team_service_delivery')
    )
    _create_index(op.f('ix_team_service_deliveries_order_id'), 'team_service_deliveries', ['order_id'], unique=False)
    _create_table('commercial_service_fulfillment_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('fulfillment_id', sa.Integer(), nullable=False),
    sa.Column('operation_id', sa.String(length=160), nullable=False),
    sa.Column('count', sa.Integer(), nullable=False),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('performed_by_staff_id', sa.Integer(), nullable=False),
    sa.Column('evidence_ref', sa.String(length=250), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['fulfillment_id'], ['commercial_service_fulfillments.id'], ),
    sa.ForeignKeyConstraint(['performed_by_staff_id'], ['staff_users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('operation_id')
    )
    _create_table('commercial_trial_quotas',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('grant_id', sa.Integer(), nullable=False),
    sa.Column('capability', sa.String(length=100), nullable=False),
    sa.Column('available', sa.Integer(), nullable=False),
    sa.Column('consumed', sa.Integer(), nullable=False),
    sa.CheckConstraint('available >= 0 AND consumed >= 0 AND available + consumed <= 1', name='ck_commercial_trial_balance'),
    sa.ForeignKeyConstraint(['grant_id'], ['commercial_grants.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('grant_id', 'capability', name='ux_commercial_trial_capability')
    )
    _create_table('commercial_trial_reservations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('quota_id', sa.Integer(), nullable=False),
    sa.Column('operation_id', sa.String(length=160), nullable=False),
    sa.Column('run_id', sa.String(length=120), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('evidence_ref', sa.String(length=250), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint("status IN ('reserved','unknown','consumed','released')", name='ck_commercial_trial_state'),
    sa.ForeignKeyConstraint(['quota_id'], ['commercial_trial_quotas.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('operation_id')
    )
    _create_index('ix_commercial_trial_reservations_run_id', 'commercial_trial_reservations', ['run_id'], unique=False)


def downgrade():
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    # Check every table before dropping any of them.
    for name in TABLES:
        if name in existing and bind.execute(sa.text(f"SELECT COUNT(*) FROM {name}")).scalar_one():
            raise RuntimeError("Framework or accounting data exists; export/reconcile before downgrade")
    for name in reversed(TABLES):
        if name in existing:
            op.drop_table(name)
