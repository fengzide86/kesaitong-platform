"""The opt-in upgrade preserves legacy rows and never seeds live policies."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models import Base, Order, Plan, TeamMember


def migration(connection):
    path = Path(__file__).parents[1] / "alembic/versions/20261015_framework_commerce.py"
    spec = importlib.util.spec_from_file_location("framework_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(connection))
    return module


def test_upgrade_is_additive_retry_safe_and_draft_only(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'upgrade.db'}")
    with engine.begin() as conn:
        change = migration(conn)
        old_tables = [table for table in Base.metadata.tables.values() if table.name not in change.TABLES]
        Base.metadata.create_all(conn, tables=old_tables)
        conn.execute(Plan.__table__.insert().values(id=1, name="Legacy business", price=999, duration_days=30,
                                                 product_type="business", entitlements='{"batch_execution":true}'))
        conn.execute(Order.__table__.insert().values(id=1, order_no="legacy-order", plan_id=1, amount=999,
                                                  plan_name_snapshot="Legacy business", plan_price_snapshot=999))
        before = tuple(conn.execute(sa.text("SELECT * FROM orders")).one())
        change.upgrade()
        change.upgrade()
        assert tuple(conn.execute(sa.text("SELECT * FROM orders")).one()) == before
        assert conn.execute(sa.text("SELECT product_type FROM plans")).scalar_one() == "business"
        for name in change.TABLES:
            assert conn.execute(sa.text(f"SELECT COUNT(*) FROM {name}")).scalar_one() == 0
        inspector = sa.inspect(conn)
        for name in change.TABLES:
            actual = {column["name"] for column in inspector.get_columns(name)}
            assert actual == set(Base.metadata.tables[name].columns.keys()), name
        change.downgrade()
        assert tuple(conn.execute(sa.text("SELECT * FROM orders")).one()) == before
        assert not set(change.TABLES) & set(sa.inspect(conn).get_table_names())


def test_downgrade_refuses_before_deleting_any_new_history(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'history.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(TeamMember.__table__.insert().values(name="Fixture member"))
        change = migration(conn)
        with pytest.raises(RuntimeError, match="data exists"):
            change.downgrade()
        assert set(change.TABLES) <= set(sa.inspect(conn).get_table_names())
        assert conn.execute(sa.text("SELECT name FROM team_members")).scalar_one() == "Fixture member"
