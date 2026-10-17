"""The identity migration preserves downstream framework history on downgrade."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models import AuthCode, TeamMember


def migration(connection):
    path = Path(__file__).parents[1] / "alembic/versions/20261017_identity_leases.py"
    spec = importlib.util.spec_from_file_location("identity_migration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(connection))
    return module


def base_schema(engine):
    AuthCode.__table__.create(engine)
    TeamMember.__table__.create(engine)


def test_downgrade_refuses_when_framework_history_exists(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'identity-history.db'}")
    base_schema(engine)
    with engine.begin() as connection:
        connection.execute(TeamMember.__table__.insert().values(name="Protected framework history"))
        change = migration(connection)
        change.upgrade()
        with pytest.raises(RuntimeError, match="Framework or accounting data exists"):
            change.downgrade()
        assert "auth_sessions" in sa.inspect(connection).get_table_names()


def test_empty_identity_downgrade_is_allowed(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'identity-empty.db'}")
    base_schema(engine)
    with engine.begin() as connection:
        change = migration(connection)
        change.upgrade()
        change.downgrade()
        assert not {"auth_sessions", "external_account_leases", "external_account_bindings"} & set(sa.inspect(connection).get_table_names())
